# EasyTroski payments & booking approval

How money moves through EasyTroski: who approves a booking, who takes the money,
who verifies it, and what happens when a ride is cancelled.

The short version: **the mobile app never decides anything about money.** It asks
our backend; the backend asks Paystack; the backend writes the result. A tampered
or modified app can make a booking request, but it cannot make a seat paid.

---

## 1. The flow

```text
Passenger requests seats on a driver's trip
        │
        ▼
seats HELD, booking = pending            (driver has 5 min to answer)
        │
   ┌────┴─────┐
   ▼          ▼
REJECT       ACCEPT
   │          │
seats        booking = awaiting_payment  (passenger has 5 min to pay)
released     │
   │         ▼
passenger    passenger pays with Mobile Money
notified     │
             ▼
        backend verifies with Paystack (amount + currency must match)
             │
      ┌──────┴───────┐
      ▼              ▼
   not paid       verified
   seats           booking = confirmed, seats reserved permanently,
   released        driver's earnings credited (pending until ride completes)
   booking =            │
   expired              ▼
                   ride happens → driver marks picked up → completed
                        │
                        ▼
                   earnings become withdrawable → end-of-day payout
```

### Booking status

| Status | Meaning |
| --- | --- |
| `pending` | Requested, seats held, driver hasn't answered |
| `awaiting_payment` | Driver accepted; passenger must pay inside the window |
| `confirmed` | Payment verified. Seats permanently reserved |
| `picked_up` | Passenger is on board |
| `completed` | Ride finished; driver earnings become withdrawable |
| `cancelled` | Closed without a ride — see `cancelReason` |
| `expired` | Payment window closed with no verified payment |

`cancelReason` keeps cancellations honest: `rejected_by_driver`,
`cancelled_by_passenger`, `cancelled_by_driver`, `driver_no_response`,
`payment_expired`, `payment_failed`, `trip_ended`, `driver_offline`.

### Money status

`paymentStatus`: `not_started` → `pending` → `processing` → `paid`, or `failed` / `expired`.

`refund.status`: `none` → `pending` → `processing` → `processed`, or
`failed` / `needs_attention` (needs a human — see the admin console).

Ride state and money state are stored separately, so one fact never lives in two
places and can never disagree with itself.

---

## 2. Amounts and fares

Every amount is an **integer number of pesewas** (1 GHS = 100 pesewas). Floating
point is never used for money.

The price comes from the route document (`routes/{id}.farePesewas`), read by the
backend. The app displays the total but cannot change it: when a charge is
verified, the backend compares what Paystack reports against its **own**
calculation and refuses to confirm a mismatch (`PAYMENT_VERIFICATION_FAILED`).

> **A route with no `farePesewas` cannot be booked.** Set it in the admin
> console → Routes → edit → "Fare per seat in GHS".

---

## 3. Seats

Seats are a single number on the trip (`availableSeats`) and are moved **only** by
the backend, inside Firestore transactions with compare-and-swap guards:

- requesting seats holds them (`seatHoldExpiresAt`)
- driver rejection releases them
- the payment window closing releases them
- a verified payment makes the hold permanent
- `seatReleasedAt` is stamped exactly once, so seats can never be credited twice

Two passengers booking the last two seats at the same moment can never both win:
the second transaction re-reads the fresh count and fails with `no_seats` ("This
tro-tro is already full").

---

## 4. Backend

Supabase Edge Functions (Deno), authenticated with the caller's Firebase ID token.
There is no Firestore Admin SDK in the app, and no secret key in the client.

| Function | Purpose |
| --- | --- |
| `payments` | One authenticated endpoint; `action` selects the operation |
| `paystack-webhook` | Paystack → us, signature-verified |
| `reap-expired` | Cron: releases expired holds and windows |

Actions the app can call: `createBookingRequest`, `driverDecide`,
`initiateCharge`, `submitChargeOtp`, `checkPayment`, `cancelBooking`,
`markPickedUp`, `completeBooking`, `setDriverOnline`, `startTrip`, `endTrip`,
`setDriverCapacity`, `driverResumed`, `rateDriver`, `requestPayout`,
`runMaintenance`, `adminResolveRefund`, `adminResolvePayout`.

Notable guards:

- **Duplicate payments** — if a charge for a booking is still `pending`/`processing`
  the backend returns that charge instead of creating a second one, and the app
  says "We're still checking your payment. Please don't pay again yet."
- **Refunds are idempotent** — once a refund is pending/processing/processed,
  further calls are no-ops. `raiseRefundCore` checks the current status first.
- **Webhook trust** — every delivery is rejected unless its
  `x-paystack-signature` (HMAC-SHA512 of the raw body, using the secret key) matches,
  then the status is re-verified with Paystack before anything is written.
- **Weak networks** — the app polls `checkPayment`; closing the app mid-payment is
  harmless because the backend, not the screen, decides. Reopening the app shows the
  real status.

---

## 5. Firestore structure

```text
routes/{routeId}          farePesewas  ← the price, admin-set
trips/{tripId}            availableSeats, status, routeId
bookings/{bookingId}      status, cancelReason, paymentStatus, paymentRef,
                          farePerSeatPesewas, totalPesewas, seatHoldExpiresAt,
                          paymentDeadlineAt, seatReleasedAt, refund{...},
                          passengerName (embedded at creation)
payments/{paymentId}      bookingId, amountPesewas, currency, provider, reference,
                          providerTransactionId, status, lastStatusPayload
driverLedger/{entryId}    append-only credits/reversals for the driver wallet
payouts/{payoutId}        end-of-day withdrawal to the driver's MoMo wallet
notifications/{id}        in-app messages per recipient
auditLogs/{logId}         every money event, for disputes
webhookEvents/{eventId}   raw Paystack deliveries, for replay/debug
```

A booking is traceable to passenger, driver, route, pickup, destination, seats,
fare, payment and timestamps. A payment is traceable to booking, amount, currency,
provider reference and both transaction ids. **No credentials are ever stored in
Firestore.**

---

## 6. Security rules

`firestore.rules` makes the backend's authority real:

- `bookings` — read: the passenger, the driver, or an admin. **create/update: nobody.**
  (Delete: the passenger can clear their own history.)
- `payments`, `webhookEvents`, `auditLogs`, `driverLedger`, `payouts` — read by the
  owner/admin where relevant, **written by the backend only**.
- `drivers` — the driver may update contact, vehicle, route and payout details, but
  `availableSeats`, wallet balances and `rating` are immutable from the client.
- `routes` — admin-only writes (`farePesewas` included).

So even with a modified app, a passenger cannot mark a booking paid, change an
amount, issue a refund, or give themselves extra seats.

---

## 7. Driver wallet

Each completed ride credits the driver's wallet:

```text
gross            = the fare the passenger paid
commission       = 10% (COMMISSION_RATE)
driver earnings  = gross − commission
```

Earnings sit in `pendingEarningsPesewas` while the ride is in progress and move to
`walletBalancePesewas` when it completes. Withdrawals open at `PAYOUT_CUTOFF_HOUR`
(8:00 PM by default) and pay out to the driver's Mobile Money number via a Paystack
transfer. Balances are backend-owned; the app only reads them.

Refunds reverse the driver's earning for that booking, so nobody keeps money for a
ride that was refunded.

---

## 8. Cancellation policy

| When | Refund |
| --- | --- |
| Passenger cancels before the driver accepts | No payment was taken — nothing to refund |
| Passenger cancels after accepting, before paying | No payment was taken — seats released |
| Passenger cancels after paying | Refund raised in full (seats released) |
| Driver cancels or rejects after payment | **Full refund**, automatically |
| Booking expires unpaid | No payment — seats released |
| Driver ends the trip with paid passengers aboard | Not cancellable — the trip completes instead |

A driver cannot cancel a completed ride to trigger a refund; the backend checks the
ride state before refunding.

---

## 9. Notifications

Written by the backend into `notifications/{id}` (and pushed to the device when a
push token exists):

*Passenger* — booking request submitted, driver accepted, driver rejected, payment
successful, payment failed, payment expired, driver cancelled, refund pending,
refund completed.

*Driver* — new booking request, passenger paid, passenger cancelled.

---

## 10. Environment & deployment

### App (`.env`, copied from `.env.example`)

```text
EXPO_PUBLIC_PAYMENTS_API_URL=https://<project-ref>.supabase.co/functions/v1
EXPO_PUBLIC_PAYMENTS_ENV=test        # "live" in production
```

No Paystack key ever goes in the app or the repo.

### Backend (`supabase/.env.local`, gitignored — never paste these into a chat)

```text
PAYSTACK_SECRET_KEY=sk_test_...      # or sk_live_... in production
PAYSTACK_ENV=test
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
COMMISSION_RATE=0.10
HOLD_MINUTES=5
PAYMENT_WINDOW_MINUTES=5
PAYOUT_CUTOFF_HOUR=20
MIN_PAYOUT_PESEWAS=100
DRIVER_STALE_MINUTES=5
```

Deploy:

```bash
supabase login
supabase link --project-ref <project-ref>
supabase secrets set --env-file supabase/.env.local
supabase functions deploy payments
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy reap-expired --no-verify-jwt
firebase deploy --only firestore:rules,firestore:indexes
```

Then set the Paystack webhook URL to
`https://<project-ref>.supabase.co/functions/v1/paystack-webhook` in the Paystack
dashboard, and schedule `reap-expired` (Supabase Cron or any scheduler) every minute.

---

## 11. Testing (Paystack test mode)

Test-mode cards/numbers are in Paystack's docs; MTN test number `0551234987`
authorises without a PIN or OTP. Test mode can also simulate refund `failed` and
`needs_attention`.

| # | Scenario | Expected |
| --- | --- | --- |
| 1 | Driver rejects | No payment, seats released, passenger notified |
| 2 | Driver accepts, passenger pays | Verified, booking confirmed, seats permanent, both notified |
| 3 | Driver accepts, passenger never pays | `expired`, seats released |
| 4 | Payment fails | Not confirmed, seats released when the window closes |
| 5 | Passenger loses internet mid-payment | Backend still verifies; reopening shows the truth; no double charge |
| 6 | Driver cancels after payment | Refund initiated and tracked, passenger notified |
| 7 | Refund webhook delivered twice | Only one refund processed |
| 8 | Two passengers, last seat | Only one succeeds; the other sees "already full" |
| 9 | Tampered amount | Backend refuses to confirm; `PAYMENT_VERIFICATION_FAILED` logged |
| 10 | App tries to mark itself paid | Firestore rules reject the write |

`payments/{id}.lastStatusPayload` and `auditLogs` are the place to look when
investigating a real dispute.

---

## 12. Audit log events

`BOOKING_CREATED`, `DRIVER_ACCEPTED`, `DRIVER_REJECTED`, `SEAT_HOLD_RELEASED`,
`PAYMENT_INITIALIZED`, `PAYMENT_SUCCESSFUL`, `PAYMENT_FAILED`,
`PAYMENT_VERIFICATION_FAILED`, `PAYMENT_EXPIRED`, `BOOKING_CONFIRMED`,
`DRIVER_CANCELLED`, `REFUND_REQUESTED`, `REFUND_STATUS_CHANGED`,
`PAYOUT_REQUESTED`, `PAYOUT_*`, `BOOKING_COMPLETED`, `ADMIN_ACTION`.

Each entry records the event, entity, actor, amount in pesewas, provider reference
and a timestamp. No credentials are ever logged.
