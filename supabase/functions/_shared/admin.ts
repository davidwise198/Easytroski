// ---------------------------------------------------------------------------
// Administrative authority
//
// Who counts as an admin, and the small set of actions only an admin may take.
//
// The question has exactly two server-side answers, and neither of them is
// something a client can write:
//
//   · a custom claim on the caller's VERIFIED Firebase ID token, or
//   · `role: "admin"` on their own `users/{uid}` document.
//
// The second one only became trustworthy once the security rules stopped
// letting a user write `role` on their own document (see the `users` block in
// firestore.rules): it can now only be set in the Firebase console, with the
// Admin SDK, or by `setUserRoleCore` below — which is itself admin-only. Before
// that, any signed-in account could make itself an admin with one client write
// and inherit every rule that reads `isAdmin()`.
// ---------------------------------------------------------------------------

import { commit, getDocument, nowIso, updateWrite } from "./firestore.ts";
import { ApiError } from "./errors.ts";
import { notify, writeAudit } from "./audit.ts";
import { readSeatUsage, writeSeatsOffered } from "./seats.ts";

/** Every role a user document may carry. */
export type UserRole = "passenger" | "driver" | "mate" | "admin";

const ROLES: UserRole[] = ["passenger", "driver", "mate", "admin"];

/** Roles a person may hold without an administrator granting them. */
export const SELF_SERVE_ROLES: UserRole[] = ["passenger", "driver", "mate"];

/**
 * The largest passenger count a tro-tro can be registered with.
 *
 * A typo in a capacity field used to be the whole seat ceiling, so this keeps
 * "600" from ever becoming a vehicle you can sell 600 seats on.
 */
export const MAX_VEHICLE_CAPACITY = 60;

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && ROLES.includes(value as UserRole);
}

/**
 * Is this caller an administrator?
 *
 * `tokenRole` comes from the verified token claims — the only client-supplied
 * value in the whole backend that carries authority, because it is signed.
 * Anything else the caller claims about their role is ignored.
 */
export async function isAdminUser(uid: string, tokenRole?: string): Promise<boolean> {
  if (tokenRole === "admin") return true;
  const profile = await getDocument(`users/${uid}`);
  return profile?.data.role === "admin";
}

/** Same question, but throws with the wording the admin screens expect. */
export async function requireAdminUser(uid: string, tokenRole?: string): Promise<void> {
  if (!(await isAdminUser(uid, tokenRole))) {
    throw new ApiError("not_authorised", "Admins only", 403);
  }
}

/**
 * Change a user's role. Admin-only, always.
 *
 * This exists because the client can no longer write `role` at all: granting
 * authority is a server decision, it is recorded, and the person it happens to
 * is told. A no-op change writes nothing.
 */
export async function setUserRoleCore(input: {
  actorId: string;
  /** Role from the caller's VERIFIED token claims, if present. */
  actorTokenRole?: string;
  userId: string;
  role: string;
}): Promise<{ userId: string; role: UserRole; changed: boolean }> {
  await requireAdminUser(input.actorId, input.actorTokenRole);

  if (!isUserRole(input.role)) {
    throw new ApiError("invalid_request", "That isn't a role we recognise.", 400);
  }
  const role = input.role;

  const user = await getDocument(`users/${input.userId}`);
  if (!user) {
    throw new ApiError("invalid_request", "We couldn't find that account.", 404);
  }

  const before = typeof user.data.role === "string" ? user.data.role : null;
  if (before === role) return { userId: input.userId, role, changed: false };

  await commit([
    updateWrite(
      `users/${input.userId}`,
      { role, updatedAt: nowIso() },
      ["role", "updatedAt"],
      user.updateTime
    ),
  ]);

  await writeAudit({
    event: "ADMIN_ACTION",
    entityType: "user",
    entityId: input.userId,
    actorId: input.actorId,
    actorRole: "admin",
    meta: { action: "set_role", from: before, to: role },
  });

  await notify({
    recipientId: input.userId,
    type: "role_changed",
    title: "Your account role changed",
    body: `An administrator set your role to ${role}.`,
  });

  return { userId: input.userId, role, changed: true };
}

/**
 * Correct a vehicle's physical seat count. Admin-only, always.
 *
 * `drivers/{id}.vehicleCapacity` is the ceiling the seat authority measures
 * everything against (offered + committed <= capacity). Drivers declare it once
 * when they register their vehicle and cannot touch it afterwards, so this is
 * the only way to fix a wrong one — which also means the admin dashboard's
 * "Capacity (seats)" field has to come through here rather than writing a
 * separate `vehicles` document nobody measures against.
 *
 * Two refusals matter:
 *   · a capacity below what live bookings already hold would strand
 *     passengers, so it is rejected rather than quietly overbooked; and
 *   · the seats on offer are brought down to fit the new ceiling, never up.
 */
export async function setVehicleCapacityCore(input: {
  actorId: string;
  /** Role from the caller's VERIFIED token claims, if present. */
  actorTokenRole?: string;
  driverId: string;
  capacity: number;
  /** The `vehicles` document to keep in step, when the dashboard knows it. */
  vehicleId?: string | null;
}): Promise<{
  driverId: string;
  capacity: number;
  previousCapacity: number;
  offered: number;
  changed: boolean;
}> {
  await requireAdminUser(input.actorId, input.actorTokenRole);

  const capacity = Math.round(Number(input.capacity));
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > MAX_VEHICLE_CAPACITY) {
    throw new ApiError(
      "invalid_request",
      `A vehicle takes between 1 and ${MAX_VEHICLE_CAPACITY} passengers.`,
      400
    );
  }

  const driver = await getDocument(`drivers/${input.driverId}`);
  if (!driver) {
    throw new ApiError("invalid_request", "That vehicle has no driver profile to measure against.", 404);
  }

  const usage = await readSeatUsage(input.driverId);
  if (capacity < usage.committed) {
    throw new ApiError(
      "seats_over_capacity",
      `This vehicle already has ${usage.committed} seat${
        usage.committed > 1 ? "s" : ""
      } taken on live bookings, so it cannot be reduced to ${capacity} right now.`,
      409,
      { ...usage, requested: capacity }
    );
  }

  if (capacity !== usage.capacity) {
    const writes = [
      updateWrite(
        `drivers/${input.driverId}`,
        { vehicleCapacity: capacity, updatedAt: nowIso() },
        ["vehicleCapacity", "updatedAt"],
        driver.updateTime
      ),
    ];

    if (input.vehicleId) {
      const vehicle = await getDocument(`vehicles/${input.vehicleId}`);
      if (vehicle) {
        writes.push(
          updateWrite(
            `vehicles/${input.vehicleId}`,
            { capacity, updatedAt: nowIso() },
            ["capacity", "updatedAt"],
            vehicle.updateTime
          )
        );
      }
    }

    await commit(writes);

    await writeAudit({
      event: "VEHICLE_CAPACITY_CHANGED",
      entityType: "driver",
      entityId: input.driverId,
      actorId: input.actorId,
      actorRole: "admin",
      meta: {
        from: usage.capacity,
        to: capacity,
        committed: usage.committed,
        vehicleId: input.vehicleId ?? null,
      },
    });

    await notify({
      recipientId: input.driverId,
      type: "vehicle_capacity_changed",
      title: "Your vehicle's seat count was corrected",
      body: `An administrator set your vehicle to ${capacity} passengers.`,
    });
  }

  // A smaller vehicle cannot keep advertising seats it no longer has. This only
  // ever lowers the offer, and never below what is already committed.
  let offered = usage.offered;
  const ceiling = Math.max(0, capacity - usage.committed);
  if (usage.offered > ceiling) {
    const next = await writeSeatsOffered(input.driverId, ceiling, {
      actorId: input.actorId,
      actorRole: "driver",
      driverId: input.driverId,
      tripId: null,
    });
    offered = next.offered;
  }

  return {
    driverId: input.driverId,
    capacity,
    previousCapacity: usage.capacity,
    offered,
    changed: capacity !== usage.capacity,
  };
}
