# Mates

A **mate** works the passengers and seats on a trotro while the driver handles the
vehicle, the route and the trip. This document is the contract for that model.

## The two relationships (never merge these)

| | Meaning | Lifetime | Stored as |
| --- | --- | --- | --- |
| **Connection** | "this mate may work with this driver" | months; survives trips | `mateConnections/{driverId}__{mateId}` |
| **Trip assignment** | "this mate is working *this* trip now" | one trip | `trips/{tripId}.mateId` + `.mateActive` |

A connection grants **no** access to any booking. Only an active assignment does,
and only for the bookings of that driver. That is the whole point of keeping them
apart: a mate can be available without being assigned, and a mate who leaves a
driver keeps every historical record of the trips they worked.

## Identity

Every driver and mate gets a permanent, public, non-credential code:

```
ET-DV-48291   driver
ET-MT-18432   mate
```

* Generated server-side (`supabase/functions/_shared/ids.ts`).
* Uniqueness is enforced by `idCodes/{code}` — the document is created with a
  **create-only** write, so a collision fails the write and another number is
  drawn (up to 6 attempts). ~1.6% of draws collide at 3,000 codes, which is why
  the ledger exists at all.
* A code identifies; it never authorises. It only lets someone *request* a
  connection, which the driver must approve.
* `idCodes` is backend-only. The app never resolves a code itself — it asks the
  backend, which also applies the rate limits.

## Collections

| Path | Written by | Read by | Purpose |
| --- | --- | --- | --- |
| `mates/{uid}` | backend | the mate, admin | name, phone, `mateCode`, status |
| `mateConnections/{driverId}__{mateId}` | backend | the driver, that mate, admin | the connection + its end reason |
| `mateJoinRequests/{id}` | backend | the driver, that mate, admin | pending/accepted/rejected requests |
| `idCodes/{code}` | backend | backend only | code → profile mapping |
| `trips/{tripId}` | backend | any signed-in user | carries `mateId`, `mateName`, `mateCode`, `mateActive`, `mateAssignedAt`, `mateUnassignedAt` |
| `drivers/{uid}.driverCode` | backend | any signed-in user | the driver's own Driver ID |

`mateId` is **never cleared** from a trip. When a trip ends the mate becomes
unassigned (`mateActive: false`), and the trip keeps their identity forever.

## Backend actions

All of these live in the existing `payments` function — one authenticated
entrypoint, no second verification path.

| Action | Who | What it does |
| --- | --- | --- |
| `ensureIds` | anyone | gives the caller the ID their role needs (idempotent; safe on every app start) |
| `mateDriverPreview` | mate | resolves a Driver ID to first name + plate + route, before sending anything |
| `mateJoinRequest` | mate | creates a request. Repeat taps return the pending one instead of creating another |
| `mateJoinDecide` | driver | accepts (creates the connection) or rejects. Compare-and-swap on the request |
| `mateLeaveDriver` | mate | ends the connection; blocked while assigned to that driver's live trip |
| `driverRemoveMate` | driver | ends the connection; same active-trip guard |
| `assignMate` | driver | puts a *connected* mate on a live trip |
| `unassignMate` | driver | takes them off; blocked while the trip still has passengers |

### Anti-spam

* At most **3** pending requests per mate.
* At most **5** requests to the same driver in 24 hours.
* A pending request for the same pair is reused, never duplicated.

## Booking authority

`resolveBookingActor()` in `supabase/functions/_shared/mates.ts` is the single
answer to "may this caller decide this booking?":

1. **The mate assigned to that driver's live trip** — and only while assigned.
   A connected mate with no assignment is refused here.
2. **Nobody else.** There is **no driver fallback**: a driver who tries to accept,
   reject, pick up or complete a passenger booking is refused with
   `mate_required` — *“Assign a Mate before accepting passenger bookings.”*
   (the wording follows the action: pick up and complete name themselves).
   Passenger decisions are the mate's job; the driver keeps the vehicle, the
   route, going online/offline, the trip, and mate management.

Trip-level actions do **not** come through this function — `startTrip`,
`endTrip` (which cancels the ride and refunds anyone who paid), `setDriverOnline`,
`setDriverCapacity` and the mate endpoints all authorise the driver directly.
The backend cancel endpoint (`cancelBookingCore`, `by: "driver"`) also stays with
the driver: it is the ride-level cancellation that raises refunds, not a
per-request decision.

Every accept, reject, pickup and completion records **both identities**: the
booking carries `lastActionBy` / `lastActionByRole`, and `auditLogs` gets
`actorId` (the person who tapped), `actorRole` (now always `mate` for these
actions — `driver` remains in the vocabulary because historic records use it)
plus a `meta` block with `driverId`, `tripId`, `mateId` and `mateCode`. The
driver's identity is never replaced by the mate's.

Booking decisions write `BOOKING_ACCEPTED` / `BOOKING_REJECTED` /
`BOOKING_PICKED_UP`, with `actorRole` naming who acted.
`DRIVER_ACCEPTED` / `DRIVER_REJECTED` are the historical names and are no longer
written.

Guards that deliberately say no:

| Situation | Error | Why |
| --- | --- | --- |
| A **driver** trying to accept, reject, pick up or complete | `mate_required` | passenger decisions are the mate's; assign one first |
| Accepting as a mate while not assigned | `not_your_trip` | connection ≠ assignment |
| Accepting a booking that belongs to a different trip | `not_your_trip` | assignment scopes the authority |
| Leaving / removing while on a live trip | `mate_assigned_to_trip` | never strand passengers without an authorised mate |
| Unassigning a trip that still has passengers | `trip_has_passengers` | same reason |
| Assigning a mate already on another trip | `mate_busy` | one trotro at a time |
| Assigning to a trip that isn't running | `trip_not_running` | assignment needs a live trip |
| Asking a driver too often | `too_many_requests` | anti-spam |

## Phases

- **Phase 0 — foundation (done):** role union, IDs, `mates` profile, connection,
  join requests, trip assignment, booking authority, audit vocabulary, rules.
- **Phase 1 — mate app (done):** `(mate-tabs)` Home / Passengers / My Driver,
  the Join a Driver flow, role plumbing across every auth screen, the driver's
  My Mates card (Driver ID + Copy/Share, requests, assign/remove).
- **Phase 2 — the Mate as real-time operator (done):** the unmissable in-app
  request alert mounted across the mate tabs, notifications addressed to the
  Mate, plain-worded refusals when an assignment ends mid-action, and the driver
  seeing who is handling the trip.
- **Phase 3 — Driver + Mate + trip coordination (done):** assignment fields on a
  trip locked to the backend, the driver's trip card completed (vehicle, Mate
  identity, passenger progress), the Mate's trip card completed (live trip
  status, booking progress), and the whole coordination matrix executed against
  a stubbed Firestore.
- **Phase 4 — seats (done):** dropping a passenger off returns their seats to the
  trip so they can be sold again further along the route, mate seat control
  bounded by what is already held, one seat authority, and three real bugs the
  seat tests exposed. See *Seats* below. Still open: attribution wording in the
  driver's booking history list, and a security review on a real device to
  confirm the shipped rules match intent.
- **Phase 5 — authority closure (done):** the audit's Critical finding fixed —
  `role` is no longer something a client can write, so authority can no longer
  be minted from a phone — plus the vehicle's capacity made backend-authoritative,
  live bookings protected from client deletion, refunds claimed by exactly one
  caller, housekeeping taken away from ordinary users, and the Mate-only
  passenger wording. See *Authority (Phase 5)* below.

## Authority (Phase 5)

The system audit found that any signed-in account could write
`role: "admin"` onto its own `users/{uid}` document and inherit every rule and
backend action that trusts that field. Each fix below is covered by
`supabase/tests/rules.check.cjs` (rules, through the official Rules API) and
`supabase/tests/seats.check.ts` (backend, through the real entrypoint).

| What | Before | Now |
| --- | --- | --- |
| `users/{uid}.role` | any owner could write any value | self-serve roles only (`passenger`, `driver`, `mate`); `admin` is granted out-of-band or by the backend |
| Who may change a role | the client (`updateDoc`) | the backend only, via the admin-only `adminSetRole` action |
| `drivers/{id}.vehicleCapacity` | owner-writable | declared once at registration, admin-only afterwards |
| `startTrip` capacity | taken from the request body | clamped to the registered capacity, audited, true value returned |
| Booking deletion | any booking, by its passenger | finished bookings only (`completed` / `cancelled` / `expired`) |
| Refunding | check → call Paystack → write | claim (compare-and-swap) → only the claimant calls Paystack |
| `reap-expired` | public | shared secret in `x-reap-secret` (fails closed if unset) |
| `runMaintenance` action | any signed-in user | admin only; the backend still runs it as a side effect of real work |

**Being an admin** has exactly two sources, both server-side: a custom claim on
the verified ID token, or `role: "admin"` on the profile document — which only
the Firebase console, the Admin SDK, or `setUserRoleCore` can now set. The first
admin is still created the same way it always was: set the role in the Firebase
console (or `firebase auth:import`/Admin SDK for a claim). After that, the
People tab of the admin screen hands roles out through the backend, and every
change is audited as `ADMIN_ACTION` (`set_role`, with `from` and `to`) and
notified to the person it happened to.

**Capacity** is the registered `vehicleCapacity` on the driver document. A trip
cannot advertise more than that, `setSeatsOffered`/`setDriverCapacity` cannot
offer more than that, and a driver whose profile never recorded one is held to
the app's default (12) rather than to whatever arrived in the request.

**Refunds** are claimed before Paystack is called: the claim is a compare-and-
swap on `bookings/{id}.refund`, so of two callers racing — a passenger
cancelling while the driver ends the trip, say — exactly one becomes the caller
and the other reports what is already happening. A claim left unanswered for two
minutes (the function died mid-call) can be taken over, and a failed attempt
still lands in `needs_attention` for a human.

**Housekeeping** is no longer something an app can trigger. It runs from the
schedule (`reap-expired`, with its secret), as a side effect of booking and
payment calls, and deliberately by an admin. The app's "clean up on open" call
was removed with it.

**Mate notification** delivery is unchanged and its limit is now written down:
`expo-notifications` is not a dependency, so there is no OS push — a push would
need a native build (not an OTA update) plus a permission flow and token
registration. What the app does instead: the in-app alert now treats a request
it finds on opening as answerable while its hold is still running, so a request
that arrived while the phone was in a pocket still interrupts the Mate.

## Seats (Phase 4)

`supabase/functions/_shared/seats.ts` owns one counter and one invariant:

```
offered   = drivers/{id}.availableSeats        — what a new booking can take
committed = Σ seats of live, unreleased bookings — held, paid or on board
capacity  = drivers/{id}.vehicleCapacity

INVARIANT:  offered + committed <= capacity, and neither is ever negative
```

A seat leaves `offered` in the same commit that creates the booking
(compare-and-swap on the driver document, so two passengers can never take the
same last seat) and comes back **exactly once, ever** through
`releaseSeatsOnce()`, which stamps `seatReleasedAt` in the same commit as the
increment. There is deliberately no second flag and no second increment path:
rejection, hold expiry, payment expiry, passenger cancellation, driver
cancellation, trip end, ghost-driver cleanup and now drop-off all reuse that one
guard, so no path can return a seat twice or lose one.

**Drop-off returns the seats.** `completeBooking` (the mate-only drop-off) now
releases the booking's seats, recording `droppedOffBy` / `droppedOffByRole`
beside `completedAt`. The booking is never deleted — passenger, seats, driver,
mate, trip, pickup and getting-off points, both timestamps and the payment ride
along with it — because releasing a seat is an accounting change, not an erasure
of history. Getting off at an intermediate stop (Lapaz on an Omanjor → Accra run)
releases those seats for someone boarding further along; nothing restricts a
drop-off to the final destination.

**Two bugs the seat tests found, both fixed here:**

| Bug | Effect | Fix |
| --- | --- | --- |
| `endTripCore` zeroed the seat counter *before* cancelling the trip's bookings | each cancellation handed its seats back afterwards, so an offline driver ended up advertising seats | zero the counter last |
| `releaseSeatsOnce` incremented the counter whatever the driver's state | any offline path (end trip, go offline, app killed) could leave seats advertised for a vehicle that was not on the road | only return seats to the counter when the driver is online; the release itself always happens |

**Who may change the seats on offer.** `setSeatsOffered` resolves the caller
against the live trip: the **mate working it**, or **its driver** (a vehicle with
no mate must still be able to stop selling when it is full). This is *not* a
booking decision, so the driver is allowed here — accepting, rejecting, pickup
and drop-off remain mate-only. Every change is attributed
(`SEATS_OFFERED_SET` with `actorRole`, plus `previousOffered`/`offered`) and
refused with `seats_over_capacity` if it would offer a seat a passenger already
holds. The driver's own `setDriverCapacity` goes through the same authority, so
neither of them can overbook a vehicle.

The seat tests live in `supabase/tests/seats.check.ts` — deliberately outside
`supabase/functions/`, so the harness is never uploaded as a function asset:

```bash
deno run --allow-env --allow-net=127.0.0.1 supabase/tests/seats.check.ts
```

They run the real backend code over an in-memory Firestore that speaks the REST
protocol — queries, update masks, creates, deletes, increments and, critically,
`currentDocument` preconditions — which is what makes the "two passengers, one
last seat" case a genuine race rather than an assertion about one. 85 checks.

## Booking read visibility (shipped in Phase 1)

A security rule cannot follow a trip assignment, so the backend stamps `mateId`
and `mateName` on a trip's live bookings when a mate is assigned, and clears
them when the mate comes off (`stampBookingsMate` in `_shared/mates.ts`). The
rule `resource.data.mateId == request.auth.uid` then grants that one mate read
access. This is **visibility only** — authority is re-resolved server-side by
`resolveBookingActor()` on every accept, reject, pickup and completion, and by
the action endpoints for joins, assignment and leaving.

## How a request reaches the Mate (Phase 2)

Three things, in this order of importance:

1. **The live listener.** The Mate's screens read `bookings` where
   `mateId == their uid` (stamped by the backend, see above) and `trips` where
   `mateId == their uid`. A request appears with no refresh, and disappears the
   moment the assignment or the trip ends.
2. **The alert.** `src/components/mate/MateRequestAlert.tsx` is mounted by
   `app/(mate-tabs)/_layout.tsx`, so it reaches the Mate on any mate tab. It
   watches the same two streams, treats the *first* payload as already-seen (so
   opening the app never fires a backlog), and then takes over the screen with a
   repeating vibration for a genuinely new request. It steps away on its own, and
   immediately if the assignment ends or somebody else answers first. It decides
   nothing: Accept and Reject call the same backend actions as the Passengers
   screen, so the server stays the authority.
3. **Notification documents.** `booking_request` is addressed to the Mate when one
   is assigned (to the driver only when nobody is, which is the prompt to assign
   one), and a confirmed payment tells the Mate the seat is paid. These are
   records for a future inbox — the rules already let a recipient read their own
   and mark it read — but nothing displays them yet, and no push token is
   registered (there is no native notification module), so **the alert is the
   delivery mechanism today.**

## Trip coordination (Phase 3)

**A trip never starts with a Mate on it.** `startTripCore` writes driver, route,
status and start time — nothing else — and the security rules now reject a
client-created trip that carries `mateId`, `mateActive` or `mateAssignedAt`. A
Mate is named only by `assignMate`, after the connection, the running trip and
the "already on another trip" checks.

**The assignment fields are backend-only.** `resolveBookingActor()` decides who
may answer a booking by trusting `mateId` + `mateActive` on the trip, so the
rules treat them like money: on update, a driver may edit their own trip but
`mateId`, `mateName`, `mateCode`, `mateActive`, `mateAssignedAt`,
`mateUnassignedAt`, `status`, `startTime`, `endTime` and `endReason` must be
untouched (`backendOnlyTripFieldsUnchanged()`). Before this, a driver could have
written those fields from a phone: naming a Mate who was never approved,
skipping the busy check, or reviving a finished trip. Admins keep full access.

**What each side sees.** The driver's trip card shows the route, the vehicle
(plate · colour, read from their own driver document), the trip status, who is
handling passenger requests with the Mate ID beneath it — or *"No Mate assigned
— passenger booking requests cannot be handled."* — plus an at-a-glance booking
progress line. The Mate's card shows the same trip from their side: route,
driver, vehicle, the trip's live status in words, and their own booking
progress. Both are read-only monitoring; no driver button touches a booking.

**Coming off a trip.** Unassigning, leaving, or being removed while anyone is
still travelling is refused (`trip_has_passengers` / `mate_assigned_to_trip`).
Ending the trip clears the assignment, cancels the ride, refunds whoever paid,
and takes the driver offline — while leaving `mateId` on the trip as the record
of who worked it.

## Not yet built (so nobody assumes it works)

* No in-app notification inbox exists for any role; the backend writes
  `notifications/{id}` but nothing reads it, so a new request reaches the mate
  through the live listener on their Passengers screen rather than a push.
* With no Mate assigned, a driver can start a trip and take requests, but nobody
  can answer them — requests expire after the seat-hold window. That is the
  intended pressure to assign a Mate before driving.
* A vehicle's `vehicleCapacity` is still declared by the driver at onboarding,
  so it is the driver's own claim about their trotro. `availableSeats` is
  backend-only, but capacity itself is not independently verified.
* Nothing records *where along the route* a seat was freed, so reselling is
  first-come-first-served rather than restricted to passengers boarding after
  the drop-off point.
