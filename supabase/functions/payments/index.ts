// ---------------------------------------------------------------------------
// POST /payments — the single authenticated backend entrypoint.
//
// Every money or seat decision the app can request lands here. The caller's
// Firebase ID token decides who they are; nothing in the body is trusted for
// identity, ownership or price.
// ---------------------------------------------------------------------------

import { authenticate } from "../_shared/firebaseAuth.ts";
import { errorResponse, json, preflight, readJson, requireLatLng, requireNumber, requireString } from "../_shared/http.ts";
import { ApiError } from "../_shared/errors.ts";
import { commit, createWrite, getDocument, newId, nowIso, queryDocuments, updateWrite } from "../_shared/firestore.ts";
import { createBookingRequest, completeBooking, driverDecide, markPickedUp } from "../_shared/bookings.ts";
import { confirmChargeCore, initiateChargeCore, submitChargeOtpCore } from "../_shared/paymentFlow.ts";
import { cancelBookingCore } from "../_shared/cancelFlow.ts";
import { endTripCore, runMaintenance, setDriverCapacityCore, setDriverOnlineCore, startTripCore } from "../_shared/tripFlow.ts";
import { driverResumedCore } from "../_shared/resumeFlow.ts";
import { requestPayoutCore, resolvePayoutCore } from "../_shared/payoutFlow.ts";
import {
  assignMate,
  decideJoin,
  driverPreview,
  ensureIds,
  leaveDriver,
  removeMate,
  requestJoin,
  setSeatsOfferedCore,
  unassignMate,
} from "../_shared/mates.ts";
import { writeAudit } from "../_shared/audit.ts";
import { isAdminUser, requireAdminUser, setUserRoleCore, setVehicleCapacityCore } from "../_shared/admin.ts";

/** Let background housekeeping finish even after the response is sent. */
function background(work: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(work.catch((error) => console.error("[maintenance] failed", error)));
  } else {
    work.catch((error) => console.error("[maintenance] failed", error));
  }
}

// Admin authority lives in _shared/admin.ts: a verified token claim, or the
// `role` field the security rules no longer let a client write.

async function userProfile(uid: string): Promise<Record<string, unknown> | null> {
  const profile = await getDocument(`users/${uid}`);
  return profile?.data ?? null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "POST") return json({ error: "invalid_request", message: "POST only" }, 405);

  try {
    const user = await authenticate(request);
    const body = await readJson<Record<string, unknown>>(request);
    const action = String(body.action || "");
    if (!action) throw new ApiError("invalid_request", "Missing action", 400);

    switch (action) {
      // ─── Passenger: request seats ───────────────────────────────────────
      case "createBookingRequest": {
        const profile = await userProfile(user.uid);
        const result = await createBookingRequest({
          passengerId: user.uid,
          passengerName: String(profile?.name || profile?.displayName || "Passenger"),
          passengerPhone: typeof profile?.phone === "string" ? profile.phone : undefined,
          driverId: requireString(body.driverId, "driverId"),
          routeId: requireString(body.routeId, "routeId"),
          seats: requireNumber(body.seats, "seats"),
          pickupLocation: requireLatLng(body.pickupLocation, "pickupLocation"),
          dropOffLocation: requireLatLng(body.dropOffLocation, "dropOffLocation"),
        });
        background(runMaintenance());
        return json(result);
      }

      // ─── Driver: approve or reject ──────────────────────────────────────
      case "driverDecide": {
        const bookingId = requireString(body.bookingId, "bookingId");
        const decision = requireString(body.decision, "decision");
        if (decision !== "accept" && decision !== "reject") {
          throw new ApiError("invalid_request", "decision must be accept or reject", 400);
        }
        const result = await driverDecide(bookingId, user.uid, decision);
        return json({ bookingId, ...result });
      }

      // ─── Payment ────────────────────────────────────────────────────────
      case "initiateCharge": {
        const profile = await userProfile(user.uid);
        const email = user.email || String(profile?.email || "");
        if (!email) throw new ApiError("invalid_request", "Your account has no email for the payment receipt.", 400);

        const result = await initiateChargeCore({
          bookingId: requireString(body.bookingId, "bookingId"),
          passengerId: user.uid,
          email,
          momoProvider: requireString(body.momoProvider, "momoProvider"),
          momoNumber: requireString(body.momoNumber, "momoNumber"),
        });
        return json(result);
      }

      case "submitChargeOtp": {
        const result = await submitChargeOtpCore({
          bookingId: requireString(body.bookingId, "bookingId"),
          passengerId: user.uid,
          otp: requireString(body.otp, "otp"),
        });
        return json(result);
      }

      case "checkPayment": {
        const bookingId = requireString(body.bookingId, "bookingId");
        const booking = await getDocument(`bookings/${bookingId}`);
        if (!booking) throw new ApiError("booking_not_found", "We couldn't find that booking.", 404);
        if (booking.data.passengerId !== user.uid && booking.data.driverId !== user.uid) {
          const admin = await isAdminUser(user.uid, user.role);
          if (!admin) throw new ApiError("not_your_booking", "That booking isn't yours.", 403);
        }
        const result = await confirmChargeCore({ bookingId, source: "client_poll" });
        background(runMaintenance());
        return json(result);
      }

      // ─── Cancellation ───────────────────────────────────────────────────
      case "cancelBooking": {
        const by = requireString(body.by, "by");
        if (by !== "passenger" && by !== "driver") {
          throw new ApiError("invalid_request", "by must be passenger or driver", 400);
        }
        const result = await cancelBookingCore({
          bookingId: requireString(body.bookingId, "bookingId"),
          by,
          actorId: user.uid,
        });
        return json(result);
      }

      // ─── Ride progress ──────────────────────────────────────────────────
      case "markPickedUp": {
        const bookingId = requireString(body.bookingId, "bookingId");
        await markPickedUp(bookingId, user.uid);
        return json({ bookingId, status: "picked_up" });
      }

      case "completeBooking": {
        const bookingId = requireString(body.bookingId, "bookingId");
        await completeBooking(bookingId, user.uid);
        return json({ bookingId, status: "completed" });
      }

      // ─── Driver availability / trip ─────────────────────────────────────
      case "setDriverOnline": {
        const result = await setDriverOnlineCore(user.uid, body.online === true);
        return json(result);
      }

      case "startTrip": {
        const direction = String(body.direction || "going") === "returning" ? "returning" : "going";
        const result = await startTripCore({
          driverId: user.uid,
          routeId: requireString(body.routeId, "routeId"),
          direction,
          capacity: requireNumber(body.capacity, "capacity"),
        });
        return json(result);
      }

      case "endTrip": {
        const result = await endTripCore(user.uid, requireString(body.tripId, "tripId"));
        return json(result);
      }

      case "setDriverCapacity": {
        const result = await setDriverCapacityCore(user.uid, requireNumber(body.seats, "seats"));
        return json(result);
      }

      case "driverResumed": {
        // Called on driver app start: ends any trip that survived an app kill.
        const result = await driverResumedCore(user.uid);
        return json(result);
      }

      case "rateDriver": {
        const tripId = requireString(body.tripId, "tripId");
        const driverId = requireString(body.driverId, "driverId");
        const rating = requireNumber(body.rating, "rating");
        if (rating < 1 || rating > 5) throw new ApiError("invalid_request", "Rating must be 1-5", 400);

        await commit([
          createWrite(`ratings/${newId()}`, {
            tripId,
            driverId,
            passengerId: user.uid,
            rating,
            createdAt: nowIso(),
          }),
        ]);

        const ratings = await queryDocuments({
          collection: "ratings",
          filters: [{ field: "driverId", value: driverId }],
          limit: 100,
        });
        const average =
          ratings.reduce((sum, row) => sum + Number(row.data.rating || 0), 0) / Math.max(1, ratings.length);
        const rounded = Math.round(average * 10) / 10;

        const driver = await getDocument(`drivers/${driverId}`);
        if (driver) {
          await commit([
            updateWrite(
              `drivers/${driverId}`,
              { rating: rounded, updatedAt: nowIso() },
              ["rating", "updatedAt"],
              driver.updateTime
            ),
          ]);
        }

        return json({ rating: rounded });
      }

      // ─── Driver wallet ──────────────────────────────────────────────────
      case "requestPayout": {
        const result = await requestPayoutCore(user.uid);
        return json(result);
      }

      // ─── Mate identity ──────────────────────────────────────────────────
      case "ensureIds": {
        const profile = await userProfile(user.uid);
        return json(await ensureIds(user.uid, profile?.role));
      }

      // ─── Mate connection: request, preview, decide ──────────────────────
      case "mateDriverPreview": {
        return json(await driverPreview(user.uid, requireString(body.driverCode, "driverCode")));
      }

      case "mateJoinRequest": {
        const result = await requestJoin(user.uid, requireString(body.driverCode, "driverCode"));
        return json(result);
      }

      case "mateJoinDecide": {
        const decision = requireString(body.decision, "decision");
        if (decision !== "accept" && decision !== "reject") {
          throw new ApiError("invalid_request", "decision must be accept or reject", 400);
        }
        const result = await decideJoin(
          requireString(body.requestId, "requestId"),
          user.uid,
          decision
        );
        return json(result);
      }

      case "mateLeaveDriver": {
        return json(await leaveDriver(user.uid, requireString(body.driverId, "driverId")));
      }

      case "driverRemoveMate": {
        return json(await removeMate(user.uid, requireString(body.mateId, "mateId")));
      }

      // ─── Trip assignment ────────────────────────────────────────────────
      case "assignMate": {
        const result = await assignMate(
          user.uid,
          requireString(body.tripId, "tripId"),
          requireString(body.mateId, "mateId")
        );
        return json(result);
      }

      case "unassignMate": {
        return json(await unassignMate(user.uid, requireString(body.tripId, "tripId")));
      }

      // ─── Seats on offer (mate, or the driver of the running trip) ───────
      case "setSeatsOffered": {
        const usage = await setSeatsOfferedCore(user.uid, requireNumber(body.seats, "seats"));
        return json(usage);
      }

      // ─── Maintenance (admin only) ───────────────────────────────────────
      //
      // Housekeeping writes: it can end a trip, cancel held bookings and take a
      // stale driver offline, so it is not something any signed-in account may
      // trigger. The two legitimate triggers do not come through here — the
      // schedule calls `reap-expired` with its secret, and the booking/payment
      // paths run it server-side as a side effect of the work they were already
      // doing.
      case "runMaintenance": {
        await requireAdminUser(user.uid, user.role);
        const result = await runMaintenance();
        return json(result);
      }

      // ─── Admin ──────────────────────────────────────────────────────────
      //
      // `requireAdminUser` never looks at the request body: a caller who claims
      // a role in the payload is still just whoever their verified token says
      // they are.
      case "adminSetRole": {
        const result = await setUserRoleCore({
          actorId: user.uid,
          actorTokenRole: user.role,
          userId: requireString(body.userId, "userId"),
          role: requireString(body.role, "role"),
        });
        return json(result);
      }

      // Correct a vehicle's registered seat count. This is the ceiling the seat
      // authority measures against, so it is an administrator's decision and
      // never the driver's own — a driver who could raise it could sell more
      // seats than the vehicle physically holds.
      case "adminSetVehicleCapacity": {
        const result = await setVehicleCapacityCore({
          actorId: user.uid,
          actorTokenRole: user.role,
          driverId: requireString(body.driverId, "driverId"),
          capacity: requireNumber(body.capacity, "capacity"),
          vehicleId: body.vehicleId ? requireString(body.vehicleId, "vehicleId") : null,
        });
        return json(result);
      }

      case "adminResolveRefund": {
        await requireAdminUser(user.uid, user.role);
        const bookingId = requireString(body.bookingId, "bookingId");
        const outcome = requireString(body.outcome, "outcome");
        const booking = await getDocument(`bookings/${bookingId}`);
        if (!booking) throw new ApiError("booking_not_found", "We couldn't find that booking.", 404);

        const currentRefund = (booking.data.refund as Record<string, unknown> | null) || {};
        await commit([
          updateWrite(
            `bookings/${bookingId}`,
            {
              refund: {
                ...currentRefund,
                status: outcome === "processed" ? "processed" : "failed",
                resolvedAt: nowIso(),
                resolvedBy: user.uid,
                resolutionNote: typeof body.note === "string" ? body.note : null,
              },
              updatedAt: nowIso(),
            },
            ["refund", "updatedAt"],
            booking.updateTime
          ),
        ]);

        await writeAudit({
          event: "ADMIN_ACTION",
          entityType: "refund",
          entityId: bookingId,
          actorId: user.uid,
          actorRole: "admin",
          amountPesewas: Number((currentRefund as { amountPesewas?: number }).amountPesewas || 0),
          meta: { action: `refund_${outcome}`, note: body.note ?? null },
        });

        return json({ bookingId, refundStatus: outcome === "processed" ? "processed" : "failed" });
      }

      case "adminResolvePayout": {
        await requireAdminUser(user.uid, user.role);
        const result = await resolvePayoutCore({
          payoutId: requireString(body.payoutId, "payoutId"),
          actorId: user.uid,
          otp: typeof body.otp === "string" ? body.otp : undefined,
          outcome: body.outcome === "success" || body.outcome === "failed" ? body.outcome : undefined,
        });
        return json(result);
      }

      default:
        throw new ApiError("invalid_request", `Unknown action: ${action}`, 400);
    }
  } catch (error) {
    return errorResponse(error, "payments");
  }
});

