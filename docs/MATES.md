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

1. **The booking's own driver** — always. This is the fallback from decision 3:
   a driver with no mate that morning can still run their trotro.
2. **The mate assigned to that driver's live trip** — and only while assigned.
   A connected mate with no assignment is refused here.

Every accept, reject, pickup and completion records **both identities**: the
booking carries `lastActionBy` / `lastActionByRole`, and `auditLogs` gets
`actorId` (the person who tapped), `actorRole` (`driver` or `mate`) plus a `meta`
block with `driverId`, `tripId`, `mateId` and `mateCode`. The driver's identity is
never replaced by the mate's.

Booking decisions write `BOOKING_ACCEPTED` / `BOOKING_REJECTED` /
`BOOKING_PICKED_UP`, with `actorRole` naming who acted.
`DRIVER_ACCEPTED` / `DRIVER_REJECTED` are the historical names and are no longer
written.

Guards that deliberately say no:

| Situation | Error | Why |
| --- | --- | --- |
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
  Backend only — no screens are wired yet.
- **Phase 1 — mate app:** `(mate-tabs)` Home / Passengers / My Driver, join flow,
  role plumbing across the auth screens, Driver ID shown to the driver.
- **Phase 2 — driver app:** My Mates section (Driver ID + Copy/Share, requests,
  assign/remove), attribution on the bookings list.
- **Phase 3 — security:** extend `bookings` reads to the mate assigned to the
  trip (via a `get()` on the trip), deploy.
- **Phase 4 — seats:** dropping a passenger off returns their seats to the trip
  (reusing the existing release-once guard), mate seat adjustment within
  vehicle capacity, mate notifications.

## Not yet built (so nobody assumes it works)

* No mate screens and no routing for the `mate` role — a mate account lands on the
  passenger tabs until Phase 1.
* No in-app notification inbox exists for any role; the backend writes
  `notifications/{id}` and mate events use the same path.
* Seats are not returned on drop-off yet (Phase 4).
