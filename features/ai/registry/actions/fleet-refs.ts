import { listDriversAction } from "@/features/drivers/actions/drivers-actions";
import { listTripCompanionOptionsAction } from "@/features/trips/actions/trips-actions";
import { listVehiclesAction } from "@/features/vehicles/actions/vehicles-actions";
import { type Access, userCan } from "@/lib/auth/permissions";
import { UuidSchema } from "@/lib/validation/common";

// How the model names a truck, a driver or an Acompañante ("AB123CD", "el
// Scania", "Pérez") → its id, through the vehicles, drivers and trip
// companion read actions (their own gates).
// A UUID passes as is, so a user without those modules can still filter by
// the id another result gave.

const MAX_OPTIONS = 5;

export type FleetRef =
  { ok: true; id: string; label: string | null } | { ok: false; error: string };

/** Letters and digits only, upper case: "ab 123 cd" and "AB-123-CD" →
 *  "AB123CD". */
export function refKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** The one option whose key equals `said`, else the one that contains it;
 *  otherwise an error naming the candidates. */
function pickOne<T>(
  said: string,
  options: readonly T[],
  keys: (o: T) => string[],
  label: (o: T) => string,
  what: string,
): { ok: true; option: T } | { ok: false; error: string } {
  const q = refKey(said);
  if (!q) return { ok: false, error: `Indicá ${what}.` };
  const exact = options.filter((o) => keys(o).some((k) => refKey(k) === q));
  const close = options.filter((o) =>
    keys(o).some((k) => refKey(k).includes(q)),
  );
  const pick =
    exact.length === 1 ? exact[0] : close.length === 1 ? close[0] : undefined;
  if (pick !== undefined) return { ok: true, option: pick };
  const many = exact.length > 1 ? exact : close;
  return {
    ok: false,
    error:
      many.length === 0
        ? `No hay ${what} que coincida con "${said}".`
        : `"${said}" coincide con varios: ${many
            .slice(0, MAX_OPTIONS)
            .map(label)
            .join(", ")}. Pedile al usuario cuál.`,
  };
}

/** A vehicle by UUID, plate (patente) or alias. Needs vehicles:read unless
 *  the id is given. */
export async function resolveVehicle(
  access: Access,
  said: string,
): Promise<FleetRef> {
  const ref = said.trim();
  if (UuidSchema.safeParse(ref).success) {
    return { ok: true, id: ref, label: null };
  }
  if (!userCan(access, "vehicles:read")) {
    return {
      ok: false,
      error:
        "Para buscar un vehículo por patente hace falta permiso para ver vehículos: pasá su id (vehicle_id de otro resultado).",
    };
  }
  const res = await listVehiclesAction({ onlyActive: false });
  if (!res.ok) return { ok: false, error: res.error };
  const found = pickOne(
    ref,
    res.data,
    (v) => [v.patente, ...(v.alias ? [v.alias] : [])],
    (v) => (v.alias ? `${v.patente} (${v.alias})` : v.patente),
    "un vehículo",
  );
  if (!found.ok) return found;
  return { ok: true, id: found.option.id, label: found.option.patente };
}

/** A driver by UUID or name. Needs drivers:read unless the id is given. */
export async function resolveDriver(
  access: Access,
  said: string,
): Promise<FleetRef> {
  const ref = said.trim();
  if (UuidSchema.safeParse(ref).success) {
    return { ok: true, id: ref, label: null };
  }
  if (!userCan(access, "drivers:read")) {
    return {
      ok: false,
      error:
        "Para buscar un chofer por nombre hace falta permiso para ver choferes: pasá su id (driver_id de otro resultado).",
    };
  }
  const res = await listDriversAction({ onlyActive: false });
  if (!res.ok) return { ok: false, error: res.error };
  const found = pickOne(
    ref,
    res.data,
    (d) => [d.full_name],
    (d) => d.full_name,
    "un chofer",
  );
  if (!found.ok) return found;
  return { ok: true, id: found.option.id, label: found.option.full_name };
}

/** A trip's Acompañante by name, among the active employees the trip form
 *  offers (trips:write, no hr:read). A UUID passes as is: creating the trip
 *  still refuses one that is not an active employee. */
export async function resolveCompanion(said: string): Promise<FleetRef> {
  const ref = said.trim();
  if (UuidSchema.safeParse(ref).success) {
    return { ok: true, id: ref, label: null };
  }
  const res = await listTripCompanionOptionsAction();
  if (!res.ok) return { ok: false, error: res.error };
  const found = pickOne(
    ref,
    res.data,
    (e) => [e.legal_name],
    (e) => e.legal_name,
    "un empleado activo",
  );
  if (!found.ok) return found;
  return { ok: true, id: found.option.id, label: found.option.legal_name };
}

/** Resolves the optional vehicle and driver of a fleet filter. */
export async function resolveFleetRefs(
  access: Access,
  input: { vehicle?: string | null; driver?: string | null },
): Promise<
  | {
      ok: true;
      vehicleId: string | null;
      driverId: string | null;
      labels: string[];
    }
  | { ok: false; error: string }
> {
  const [vehicle, driver] = await Promise.all([
    input.vehicle ? resolveVehicle(access, input.vehicle) : null,
    input.driver ? resolveDriver(access, input.driver) : null,
  ]);
  if (vehicle && !vehicle.ok) return vehicle;
  if (driver && !driver.ok) return driver;
  return {
    ok: true,
    vehicleId: vehicle?.id ?? null,
    driverId: driver?.id ?? null,
    labels: [
      ...(vehicle ? [`vehículo ${vehicle.label ?? vehicle.id}`] : []),
      ...(driver ? [`chofer ${driver.label ?? driver.id}`] : []),
    ],
  };
}
