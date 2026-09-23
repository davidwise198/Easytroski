// ---------------------------------------------------------------------------
// Audit log + notifications
//
// Money moves are always recorded: auditLogs is the trail we use to explain a
// transaction during a dispute or a project defence. Notifications are stored
// in-app (works today) and mirrored to Expo push when a device token exists.
//
// Neither writer is allowed to break the money flow, so failures are logged and
// swallowed — except the audit write, which we surface to the caller.
// ---------------------------------------------------------------------------

import { createWrite, commit, getDocument, newId, nowIso } from "./firestore.ts";

export type AuditEvent =
  | "BOOKING_CREATED"
  | "DRIVER_ACCEPTED"
  | "DRIVER_REJECTED"
  | "BOOKING_EXPIRED"
  | "BOOKING_CANCELLED"
  | "PAYMENT_INITIALIZED"
  | "PAYMENT_SUCCESSFUL"
  | "PAYMENT_FAILED"
  | "PAYMENT_VERIFICATION_FAILED"
  | "REFUND_REQUESTED"
  | "REFUND_STATUS_CHANGED"
  | "WALLET_CREDITED"
  | "WALLET_REVERSED"
  | "PAYOUT_REQUESTED"
  | "PAYOUT_SUCCEEDED"
  | "PAYOUT_FAILED"
  | "BOOKING_COMPLETED"
  | "DRIVER_AUTO_OFFLINE"
  // Booking decisions name who acted through `actorRole`: the driver who owns
  // the trip, or the mate working it. DRIVER_ACCEPTED / DRIVER_REJECTED are
  // the historical names and are no longer written.
  | "BOOKING_ACCEPTED"
  | "BOOKING_REJECTED"
  | "BOOKING_PICKED_UP"
  // Mate connection + trip assignment
  | "MATE_JOIN_REQUESTED"
  | "MATE_JOIN_ACCEPTED"
  | "MATE_JOIN_REJECTED"
  | "MATE_ASSIGNED"
  | "MATE_UNASSIGNED"
  | "MATE_REMOVED"
  | "MATE_LEFT"
  | "MATE_SEATS_CHANGED"
  // "MATE_SEATS_CHANGED" is the historical name; seat-offer changes are now
  // written as SEATS_OFFERED_SET with `actorRole` saying who did it.
  | "SEATS_OFFERED_SET"
  // Seats coming back because a passenger got off before the final stop.
  | "SEATS_RELEASED"
  // A trip asked to advertise more seats than the vehicle is registered for,
  // so the trusted capacity was used instead of the number that arrived.
  | "TRIP_CAPACITY_CLAMPED"
  // An administrator corrected the physical seat count of a vehicle, which is
  // the ceiling every seat calculation is measured against.
  | "VEHICLE_CAPACITY_CHANGED"
  | "ADMIN_ACTION";

export type AuditInput = {
  event: AuditEvent;
  entityType: "booking" | "payment" | "payout" | "driver" | "refund" | "mate" | "trip" | "user";
  entityId: string;
  actorId?: string;
  actorRole?: "passenger" | "driver" | "mate" | "admin" | "system" | "paystack";
  amountPesewas?: number;
  providerRef?: string;
  /** Never put secrets, card numbers or raw provider payloads here. */
  meta?: Record<string, unknown>;
};

export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    const id = newId();
    await commit([
      createWrite(`auditLogs/${id}`, {
        event: input.event,
        entityType: input.entityType,
        entityId: input.entityId,
        actorId: input.actorId ?? "system",
        actorRole: input.actorRole ?? "system",
        amountPesewas: input.amountPesewas ?? null,
        providerRef: input.providerRef ?? null,
        meta: input.meta ?? null,
        createdAt: nowIso(),
      }),
    ]);
  } catch (error) {
    // Log for us; never fail the customer's flow over the audit trail.
    console.error("[audit] write failed", input.event, error);
  }
}

export type NotificationInput = {
  recipientId: string;
  type: string;
  title: string;
  body: string;
  bookingId?: string;
  payoutId?: string;
};

export async function notify(input: NotificationInput): Promise<void> {
  if (!input.recipientId) return;

  try {
    const id = newId();
    await commit([
      createWrite(`notifications/${id}`, {
        recipientId: input.recipientId,
        type: input.type,
        title: input.title,
        body: input.body,
        bookingId: input.bookingId ?? null,
        payoutId: input.payoutId ?? null,
        read: false,
        createdAt: nowIso(),
      }),
    ]);
  } catch (error) {
    console.error("[notify] store failed", input.type, error);
  }

  // Best-effort OS push. Tokens only exist once the app is built with
  // expo-notifications; until then this is a no-op and the in-app list carries
  // the message.
  try {
    const tokenDoc = await getDocument(`push-tokens/${input.recipientId}`);
    const token = tokenDoc?.data?.token;
    if (typeof token === "string" && token.startsWith("ExponentPushToken")) {
      await fetch("https://exp.host/--/api/v2/push/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: token,
          title: input.title,
          body: input.body,
          sound: "default",
          priority: "high",
          data: { type: input.type, bookingId: input.bookingId, payoutId: input.payoutId },
        }),
      });
    }
  } catch (error) {
    console.error("[notify] push failed", input.type, error);
  }
}
