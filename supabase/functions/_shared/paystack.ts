// ---------------------------------------------------------------------------
// Paystack client
//
// Only ever called from the backend: the secret key stays in function secrets.
// Endpoints used (verified against the official API reference):
//   POST /charge                       collect from Ghana mobile money
//   POST /charge/submit_otp            finish an OTP-gated charge
//   GET  /transaction/verify/:ref      source of truth for "was this paid?"
//   GET  /charge/:ref                  in-flight charge state
//   POST /refund                       refund a paid transaction
//   GET  /refund/:id                   refund progress
//   POST /transferrecipient            reusable MoMo payout recipient
//   POST /transfer                     pay a driver out
//   POST /transfer/finalize_transfer   finish an OTP-gated transfer
// ---------------------------------------------------------------------------

import { PAYSTACK_SECRET_KEY } from "./env.ts";
import { ApiError } from "./errors.ts";
import type { MomoProvider } from "./money.ts";

const BASE_URL = "https://api.paystack.co";

export type PaystackEnvelope<T> = {
  status: boolean;
  message: string;
  data: T;
};

async function call<T>(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; label: string }
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY()}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    console.error(`[paystack:${init.label}] network failure`, error);
    throw new ApiError("charge_failed", "We couldn't reach the payment network. Please try again.", 502);
  }

  let payload: PaystackEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as PaystackEnvelope<T>;
  } catch {
    console.error(`[paystack:${init.label}] non-JSON response`, response.status);
    throw new ApiError("charge_failed", "The payment network returned an unexpected response.", 502);
  }

  if (!response.ok || !payload?.status) {
    // Log the provider's wording for us; never surface it to the passenger.
    console.error(`[paystack:${init.label}] failed`, response.status, payload?.message);
    const message = String(payload?.message || "");
    const code = response.status === 429 ? "rate_limited" : "charge_failed";
    throw new ApiError(
      code,
      /amount/i.test(message)
        ? "The payment amount was rejected. Please try again."
        : "We couldn't start the payment. Please try again.",
      response.status === 429 ? 429 : 502
    );
  }

  return payload.data;
}

// ─── Collections ──────────────────────────────────────────────────────────

export type ChargeState = "pay_offline" | "send_otp" | "pending" | "success" | "failed" | string;

export type ChargeData = {
  reference: string;
  status: ChargeState;
  display_text?: string;
  amount?: number;
  currency?: string;
  message?: string | null;
};

/**
 * Collect from a Ghana mobile money wallet. The customer approves on their
 * phone (`pay_offline`) or we hand back the OTP prompt (`send_otp`).
 */
export async function chargeMobileMoney(input: {
  email: string;
  amountPesewas: number;
  reference: string;
  phone: string;
  provider: MomoProvider;
  metadata?: Record<string, unknown>;
}): Promise<ChargeData> {
  return call<ChargeData>("/charge", {
    method: "POST",
    label: "charge",
    body: {
      email: input.email,
      amount: input.amountPesewas,
      currency: "GHS",
      reference: input.reference,
      // Only mobile money is offered: fares are paid from a MoMo wallet.
      mobile_money: { phone: input.phone, provider: input.provider },
      metadata: input.metadata,
    },
  });
}

export async function submitChargeOtp(reference: string, otp: string): Promise<ChargeData> {
  return call<ChargeData>("/charge/submit_otp", {
    method: "POST",
    label: "charge/submit_otp",
    body: { otp, reference },
  });
}

export async function checkCharge(reference: string): Promise<ChargeData> {
  return call<ChargeData>(`/charge/${encodeURIComponent(reference)}`, {
    method: "GET",
    label: "charge/status",
  });
}

// ─── Verification ─────────────────────────────────────────────────────────

export type VerifiedTransaction = {
  id: number;
  status: "success" | "failed" | "abandoned" | "ongoing" | "pending" | "reversed" | string;
  reference: string;
  amount: number;
  currency: string;
  channel?: string;
  gateway_response?: string;
  paid_at?: string | null;
  customer?: { email?: string };
};

/** The authoritative answer to "did this charge succeed?" */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction | null> {
  try {
    return await call<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`, {
      method: "GET",
      label: "transaction/verify",
    });
  } catch (error) {
    // An unknown reference means Paystack has no such charge yet — not an
    // error for the caller, just "not paid".
    if (error instanceof ApiError && /couldn't start the payment/i.test(error.message)) return null;
    throw error;
  }
}

// ─── Refunds ──────────────────────────────────────────────────────────────

export type RefundData = {
  id: number;
  status: "pending" | "processing" | "processed" | "failed" | "needs_attention" | string;
  amount: number;
  currency: string;
  transaction?: number | { id?: number };
};

/**
 * Refund all or part of a paid transaction. Paystack may return
 * `needs_attention` when the original instrument can't accept a reversal —
 * the caller routes those to the admin queue.
 */
export async function createRefund(input: {
  transactionReference: string;
  amountPesewas?: number;
  customerNote: string;
  merchantNote: string;
}): Promise<RefundData> {
  return call<RefundData>("/refund", {
    method: "POST",
    label: "refund",
    body: {
      transaction: input.transactionReference,
      ...(input.amountPesewas ? { amount: input.amountPesewas } : {}),
      currency: "GHS",
      customer_note: input.customerNote,
      merchant_note: input.merchantNote,
    },
  });
}

export async function fetchRefund(refundId: number): Promise<RefundData> {
  return call<RefundData>(`/refund/${refundId}`, { method: "GET", label: "refund/fetch" });
}

// ─── Payouts ──────────────────────────────────────────────────────────────

export type RecipientData = {
  recipient_code: string;
  details?: { account_number?: string; bank_name?: string };
};

export async function createMobileMoneyRecipient(input: {
  name: string;
  phone: string;
  provider: MomoProvider;
}): Promise<RecipientData> {
  return call<RecipientData>("/transferrecipient", {
    method: "POST",
    label: "transferrecipient",
    body: {
      type: "mobile_money",
      name: input.name,
      account_number: input.phone,
      bank_code: input.provider,
      currency: "GHS",
    },
  });
}

export type TransferData = {
  transfer_code: string;
  reference: string;
  status: string; // pending | success | otp | failed | reversed
  amount: number;
  currency: string;
  recipient?: unknown;
};

export async function initiateTransfer(input: {
  amountPesewas: number;
  recipientCode: string;
  reference: string;
  reason: string;
}): Promise<TransferData> {
  return call<TransferData>("/transfer", {
    method: "POST",
    label: "transfer",
    body: {
      source: "balance",
      amount: input.amountPesewas,
      recipient: input.recipientCode,
      reference: input.reference,
      reason: input.reason,
      currency: "GHS",
    },
  });
}

export async function verifyTransfer(reference: string): Promise<TransferData> {
  return call<TransferData>(`/transfer/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
    label: "transfer/verify",
  });
}

export async function finalizeTransfer(transferCode: string, otp: string): Promise<TransferData> {
  return call<TransferData>("/transfer/finalize_transfer", {
    method: "POST",
    label: "transfer/finalize",
    body: { transfer_code: transferCode, otp },
  });
}

// ─── Webhook signature ────────────────────────────────────────────────────

/**
 * Paystack signs every webhook with HMAC-SHA512 of the raw body using the
 * secret key, in the `x-paystack-signature` header. Anything that doesn't match
 * is rejected before we look at its contents.
 */
export async function verifyWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY()),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time-ish comparison: same length before comparing contents.
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Paystack sends webhooks from these addresses; an extra signal, not the only one. */
export const PAYSTACK_WEBHOOK_IPS = ["52.31.139.75", "52.49.173.169", "52.214.14.220"];
