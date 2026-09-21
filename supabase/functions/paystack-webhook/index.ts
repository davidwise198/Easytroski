// ---------------------------------------------------------------------------
// POST /paystack-webhook — public, but only Paystack can make it mean anything.
//
// Security: every request must carry a valid `x-paystack-signature`, which is
// an HMAC-SHA512 of the raw body using our secret key. We then confirm the
// transaction against Paystack's API before touching a booking — a forged
// payload can neither mark a booking paid nor trigger a refund.
//
// Delivery is at-least-once, so each event is recorded in `webhookEvents` keyed
// by Paystack's event id: duplicates are acknowledged and ignored.
// ---------------------------------------------------------------------------

import { errorResponse, json, preflight } from "../_shared/http.ts";
import { commit, createWrite, getDocument, queryDocuments, toMillis, updateWrite } from "../_shared/firestore.ts";
import { verifyWebhookSignature } from "../_shared/paystack.ts";
import { applyRefundWebhook, confirmChargeCore } from "../_shared/paymentFlow.ts";
import { applyPayoutWebhook } from "../_shared/payoutFlow.ts";
import { getBooking } from "../_shared/bookings.ts";

type PaystackEvent = {
  event?: string;
  data?: Record<string, unknown>;
};

/** Look up our booking from a Paystack transaction payload. */
async function bookingIdFromTransaction(data: Record<string, unknown>): Promise<string | null> {
  const metadata = data.metadata as Record<string, unknown> | undefined;
  if (metadata && typeof metadata.bookingId === "string") return metadata.bookingId;

  const reference = typeof data.reference === "string" ? data.reference : null;
  if (!reference) return null;

  const matches = await queryDocuments({
    collection: "bookings",
    filters: [{ field: "paymentRef", value: reference }],
    limit: 1,
  });
  return matches[0]?.id ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return json({ error: "invalid_request" }, 405);

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    if (!(await verifyWebhookSignature(rawBody, signature))) {
      console.error("[paystack-webhook] rejected: bad signature");
      return json({ error: "not_authorised" }, 401);
    }

    let event: PaystackEvent;
    try {
      event = JSON.parse(rawBody) as PaystackEvent;
    } catch {
      return json({ error: "invalid_request" }, 400);
    }

    const eventType = String(event.event || "");
    const data = (event.data || {}) as Record<string, unknown>;
    const reference = typeof data.reference === "string" ? data.reference : "";

    // ── Idempotency ledger ───────────────────────────────────────────────
    const eventId = String(data.id ?? `${eventType}:${reference}`);
    if (eventId) {
      const existing = await getDocument(`webhookEvents/${encodeURIComponent(eventId)}`);
      if (existing) {
        // Already handled (Paystack retries for up to 10 hours in test mode).
        return json({ status: true, duplicate: true });
      }
      try {
        await commit([
          createWrite(`webhookEvents/${encodeURIComponent(eventId)}`, {
            event: eventType,
            reference,
            receivedAt: new Date().toISOString(),
            processed: false,
          }),
        ]);
      } catch {
        // Lost the race with a concurrent delivery — treat as duplicate.
        return json({ status: true, duplicate: true });
      }
    }

    switch (eventType) {
      case "charge.success": {
        const bookingId = await bookingIdFromTransaction(data);
        if (bookingId) {
          const booking = await getBooking(bookingId);
          const deadline = toMillis(booking?.data.paymentDeadlineAt);
          // A late-but-real payment still counts: the passenger paid.
          await confirmChargeCore({ bookingId, source: "webhook" });
          if (booking && deadline !== null && Date.now() > deadline) {
            console.warn(`[paystack-webhook] payment arrived after the window for ${bookingId}`);
          }
        } else {
          console.error(`[paystack-webhook] charge.success with no booking for ${reference}`);
        }
        break;
      }

      case "refund.pending":
      case "refund.processing":
      case "refund.processed":
      case "refund.failed": {
        const transaction = data.transaction as Record<string, unknown> | undefined;
        const refundReference =
          (typeof transaction?.reference === "string" ? transaction.reference : "") || reference;
        const refundId = typeof data.id === "number" ? data.id : undefined;
        // "needs_attention" only comes back from the API response, not a webhook.
        const status = eventType.replace("refund.", "");
        if (refundReference) {
          await applyRefundWebhook({ reference: refundReference, providerRefundId: refundId, status });
        }
        break;
      }

      case "transfer.success":
      case "transfer.failed":
      case "transfer.reversed": {
        await applyPayoutWebhook({
          reference,
          status: eventType.replace("transfer.", ""),
          transferCode: typeof data.transfer_code === "string" ? data.transfer_code : undefined,
        });
        break;
      }

      default:
        // Unhandled event types are recorded and acknowledged.
        break;
    }

    // Mark the event processed (best effort).
    if (eventId) {
      try {
        const record = await getDocument(`webhookEvents/${encodeURIComponent(eventId)}`);
        if (record) {
          await commit([
            updateWrite(
              `webhookEvents/${encodeURIComponent(eventId)}`,
              { processed: true, processedAt: new Date().toISOString(), event: eventType },
              ["processed", "processedAt", "event"],
              record.updateTime
            ),
          ]);
        }
      } catch (error) {
        console.error("[paystack-webhook] could not mark event processed", error);
      }
    }

    return json({ status: true });
  } catch (error) {
    // Paystack retries anything that isn't a 200, which is what we want for a
    // transient failure — but not for a bad signature (handled above).
    return errorResponse(error, "paystack-webhook");
  }
});
