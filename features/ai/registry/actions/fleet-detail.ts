import { z } from "zod";

import { getVehicleActivityAction } from "@/features/fleet-reports/actions/activity-actions";
import {
  listShipmentsAction,
  listShipmentsByTripAction,
} from "@/features/shipments/actions/shipments-actions";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_STATUS_LABELS,
} from "@/features/shipments/schema";
import {
  getTripAction,
  listTripsAction,
} from "@/features/trips/actions/trips-actions";
import { TRIP_STATUS_LABELS, type Trip } from "@/features/trips/schema";
import { userCan } from "@/lib/auth/permissions";
import { round2 } from "@/lib/format";
import { IsoDateSchema, UuidSchema } from "@/lib/validation/common";

import { defineAiAction } from "../define";
import { errResult, okResult, reachedCap } from "../result";

import { capNote } from "./fleet";
import { resolveVehicle } from "./fleet-refs";

// One vehicle over a period, one trip, and the cargas list: each wraps the
// feature's own read action (trips:read / shipments:read) and its RLS.

/** Trips of one vehicle a usage read takes (one PostgREST page). */
const USAGE_TRIP_CAP = 1000;

type DriverUsage = {
  driver_id: string | null;
  driver: string;
  trips: number;
  km: number;
  trips_without_km: number;
  first_trip: string;
  last_trip: string;
};

/** Who drove the vehicle, from its trips that are not cancelled: one row per
 *  driver (null = trips without a driver), most trips first. */
export function driversOf(trips: readonly Trip[]): DriverUsage[] {
  const byDriver = new Map<string, DriverUsage>();
  for (const t of trips) {
    if (t.status === "cancelled") continue;
    const key = t.driver_id ?? "none";
    const row = byDriver.get(key) ?? {
      driver_id: t.driver_id,
      driver: t.driver?.full_name ?? "Sin chofer",
      trips: 0,
      km: 0,
      trips_without_km: 0,
      first_trip: t.trip_date,
      last_trip: t.trip_date,
    };
    row.trips += 1;
    if (t.km === null) row.trips_without_km += 1;
    else row.km = round2(row.km + t.km);
    if (t.trip_date < row.first_trip) row.first_trip = t.trip_date;
    if (t.trip_date > row.last_trip) row.last_trip = t.trip_date;
    byDriver.set(key, row);
  }
  return [...byDriver.values()].sort(
    (a, b) => b.trips - a.trips || b.km - a.km,
  );
}

export const getVehicleUsage = defineAiAction({
  name: "getVehicleUsage",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips", "ai_vehicle_activity", "vehicle_km_daily"],
  description:
    "Uso de UN vehículo (por patente, alias o UUID) en un rango de fechas. Los km RECORRIDOS son los del GPS de Strix (km_recorridos: suma de los km por día del rango; necesita permiso de km de flota): respondé '¿cuántos km hizo el camión X?' con ese número. Los km cargados en los viajes (trip_km) son la distancia declarada de cada viaje y se usan para el extra por km de los choferes; mencionalos solo como referencia o si no hay km de Strix, aclarando que son los de los viajes. Trae también los litros cargados (permiso de combustible) y quién lo manejó: cada chofer con sus viajes, km de viajes y primera y última fecha. Para '¿cuántos km hizo el camión X en octubre?' o '¿quién manejó el camión X el último mes?'.",
  input: z
    .object({
      vehicle: z
        .string()
        .trim()
        .min(1)
        .max(60)
        .describe(
          "Vehículo: patente (ej. AB123CD; se ignoran espacios y guiones), alias o UUID.",
        ),
      from: IsoDateSchema.describe("Fecha desde, YYYY-MM-DD."),
      to: IsoDateSchema.describe("Fecha hasta, YYYY-MM-DD (inclusive)."),
    })
    .refine(
      (v) => v.from <= v.to,
      "La fecha desde es posterior a la fecha hasta.",
    ),
  run: async (ctx, input) => {
    const ref = await resolveVehicle(ctx.access, input.vehicle);
    if (!ref.ok) return errResult(ref.error);
    const range = { from: input.from, to: input.to };
    const [tripsRes, activityRes] = await Promise.all([
      listTripsAction({
        vehicleId: ref.id,
        ...range,
        limit: USAGE_TRIP_CAP,
      }),
      getVehicleActivityAction(range),
    ]);
    if (!tripsRes.ok) return errResult(tripsRes.error);
    if (!activityRes.ok) return errResult(activityRes.error);
    const activity = activityRes.data.find((a) => a.vehicle_id === ref.id);
    const plate =
      ref.label ??
      activity?.patente ??
      tripsRes.data.find((t) => t.vehicle)?.vehicle?.patente ??
      ref.id;
    const drivers = driversOf(tripsRes.data);
    const live = tripsRes.data.filter((t) => t.status !== "cancelled");
    const tripKm = round2(live.reduce((s, t) => s + (t.km ?? 0), 0));
    const withoutKm = live.filter((t) => t.km === null).length;
    const odometer =
      activity?.odometer_km === null || activity?.odometer_km === undefined
        ? null
        : Number(activity.odometer_km);
    const liters =
      activity?.fuel_liters === null || activity?.fuel_liters === undefined
        ? null
        : Number(activity.fuel_liters);
    const notes: string[] = [];
    if (!userCan(ctx.access, "fleet_km:read")) {
      notes.push("Km de Strix omitidos: hace falta permiso de km de flota.");
    } else if (odometer === null) {
      notes.push(
        "Sin km de Strix para ese rango: no hay km recorridos medidos; solo los km cargados en los viajes, que son una referencia.",
      );
    }
    if (!userCan(ctx.access, "fuel:read")) {
      notes.push("Litros omitidos: hace falta permiso de combustible.");
    }
    if (withoutKm > 0) {
      notes.push(
        `${withoutKm} viaje(s) sin km cargados: los km de viajes no los cuentan.`,
      );
    }
    const cut = reachedCap(tripsRes.data.length, USAGE_TRIP_CAP);
    if (cut) {
      notes.push(
        `Se leyeron los ${USAGE_TRIP_CAP} viajes más recientes: acotá el rango.`,
      );
    }
    return okResult(
      `${plate} ${input.from}→${input.to}: ` +
        (odometer === null
          ? "km recorridos sin datos de Strix"
          : `${odometer.toLocaleString("es-AR")} km recorridos (Strix)`) +
        ` · ${live.length} viajes con ${tripKm.toLocaleString("es-AR")} km cargados` +
        (liters === null ? "" : ` · ${liters.toLocaleString("es-AR")} L`) +
        ` · ${drivers.length} chofer(es): ${
          drivers
            .slice(0, 5)
            .map((d) => `${d.driver} (${d.trips})`)
            .join(", ") || "ninguno"
        }.`,
      {
        vehicle_id: ref.id,
        vehicle: plate,
        from: input.from,
        to: input.to,
        km_recorridos: odometer,
        trips: live.length,
        cancelled_trips: tripsRes.data.length - live.length,
        trip_km: tripKm,
        trips_without_km: withoutKm,
        odometer_km: odometer,
        odometer_start:
          activity?.odometer_start === null ||
          activity?.odometer_start === undefined
            ? null
            : Number(activity.odometer_start),
        odometer_end:
          activity?.odometer_end === null ||
          activity?.odometer_end === undefined
            ? null
            : Number(activity.odometer_end),
        fuel_liters: liters,
        drivers,
      },
      { partial: cut, ...(notes.length ? { note: notes.join(" ") } : {}) },
    );
  },
});

export const getTripDetail = defineAiAction({
  name: "getTripDetail",
  domain: "flota",
  permission: "trips:read",
  sideEffect: "read",
  sources: ["trips", "shipments"],
  description:
    "Detalle de UN viaje por su UUID (de getTrips): fecha, vehículo, chofer, acompañante y estado (ruta y km solo en viajes viejos que los tienen), y sus cargas (cliente, dirección, fecha, estado y remito si tiene; necesita permiso de cargas).",
  input: z.object({ tripId: UuidSchema.describe("UUID del viaje.") }),
  run: async (ctx, input) => {
    const withShipments = userCan(ctx.access, "shipments:read");
    const [tripRes, shipmentsRes] = await Promise.all([
      getTripAction(input.tripId),
      withShipments ? listShipmentsByTripAction(input.tripId) : null,
    ]);
    if (!tripRes.ok) return errResult(tripRes.error);
    if (!tripRes.data)
      return errResult("No existe ese viaje o no podés verlo.");
    if (shipmentsRes && !shipmentsRes.ok) return errResult(shipmentsRes.error);
    const t = tripRes.data;
    const shipments = shipmentsRes?.data ?? null;
    return okResult(
      `Viaje ${t.trip_date} · ${t.vehicle?.patente ?? "sin vehículo"} · ${
        t.driver?.full_name ?? "sin chofer"
      }` +
        (t.companion ? ` · acompañante ${t.companion.legal_name}` : "") +
        (t.origin || t.destination
          ? ` · ${t.origin ?? "?"}→${t.destination ?? "?"}`
          : "") +
        ` · ${TRIP_STATUS_LABELS[t.status]}` +
        (t.km === null ? "" : ` · ${t.km.toLocaleString("es-AR")} km`) +
        (shipments === null
          ? ". Cargas omitidas: hace falta permiso de cargas."
          : ` · ${shipments.length} carga(s).`),
      { trip: t, shipments },
    );
  },
});

const SHIPMENTS_DEFAULT = 100;
const SHIPMENTS_MAX = 500;

export const getShipments = defineAiAction({
  name: "getShipments",
  domain: "flota",
  permission: "shipments:read",
  sideEffect: "read",
  sources: ["shipments"],
  description:
    "Listado de cargas (envíos), las más recientes primero, filtrable por fecha programada, cliente (UUID de searchClients), viaje, estados, asignada o no a un viaje y número de remito: cliente, dirección, fecha, estado, viaje y remito si tiene. Una carga en un viaje pasa sola a En curso el día del viaje. Para encontrar una carga puntual; los totales por estado y cliente están en getShipmentsSummary.",
  input: z.object({
    from: IsoDateSchema.nullish().describe(
      "Fecha programada desde, YYYY-MM-DD.",
    ),
    to: IsoDateSchema.nullish().describe("Fecha programada hasta, YYYY-MM-DD."),
    clientId: UuidSchema.nullish().describe("UUID del cliente."),
    tripId: UuidSchema.nullish().describe("UUID del viaje."),
    statuses: z
      .array(z.enum(SHIPMENT_STATUSES))
      .min(1)
      .max(SHIPMENT_STATUSES.length)
      .nullish()
      .describe("Cualquiera de estos estados."),
    assigned: z
      .boolean()
      .nullish()
      .describe("true: solo cargas en un viaje; false: solo sin viaje."),
    remito: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .nullish()
      .describe("Número de remito (o parte)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(SHIPMENTS_MAX)
      .nullish()
      .describe(
        `Máximo de filas (default ${SHIPMENTS_DEFAULT}, máx ${SHIPMENTS_MAX}).`,
      ),
  }),
  run: async (_ctx, input) => {
    if (input.from && input.to && input.from > input.to) {
      return errResult("La fecha desde es posterior a la fecha hasta.");
    }
    const cap = input.limit ?? SHIPMENTS_DEFAULT;
    const res = await listShipmentsAction({ ...input, limit: cap + 1 });
    if (!res.ok) return errResult(res.error);
    const rows = res.data.slice(0, cap);
    const byStatus = SHIPMENT_STATUSES.flatMap((st) => {
      const n = rows.filter((r) => r.status === st).length;
      return n > 0 ? [`${n} ${SHIPMENT_STATUS_LABELS[st].toLowerCase()}`] : [];
    });
    return okResult(
      `${rows.length} cargas` +
        (byStatus.length > 0 ? ` (${byStatus.join(", ")})` : "") +
        "." +
        capNote(res.data.length, cap),
      rows,
      { partial: res.data.length > cap },
    );
  },
});
