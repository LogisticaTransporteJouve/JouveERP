import {
  parsePeriodParams,
  resolvePeriod,
  type PeriodSelection,
} from "@/lib/list-period";
import { UuidSchema } from "@/lib/validation/common";

import {
  SHIPMENT_STATUSES,
  isShipmentKind,
  type ShipmentKind,
  type ShipmentListFilter,
  type ShipmentStatus,
} from "../schema";

/** The «Viaje» filter: on a trip or without one. */
export const SHIPMENT_TRIP_FILTERS = ["asignada", "sin"] as const;
export type ShipmentTripFilter = (typeof SHIPMENT_TRIP_FILTERS)[number];

function isTripFilter(v: unknown): v is ShipmentTripFilter {
  return (
    typeof v === "string" &&
    (SHIPMENT_TRIP_FILTERS as readonly string[]).includes(v)
  );
}

/** The cargas list's URL state:
 *  `?q&estado&period&from&to&cliente&viaje&tipo` (`estado` is a
 *  comma-separated list, e.g. `not_started,in_progress`; `viaje` is
 *  `asignada` or `sin`; `tipo` one of retiro, carga, mudanza). */
export interface ShipmentListParams {
  query: string;
  statuses: ShipmentStatus[];
  period: PeriodSelection;
  clientId: string | null;
  trip: ShipmentTripFilter | null;
  kind: ShipmentKind | null;
}

/** Distinct known statuses in canonical order, so equal selections share a
 *  query key and a URL. */
export function normalizeShipmentStatuses(
  values: readonly string[],
): ShipmentStatus[] {
  return SHIPMENT_STATUSES.filter((s) => values.includes(s));
}

export function parseShipmentListParams(
  params: Record<string, string | undefined>,
): ShipmentListParams {
  const client = UuidSchema.safeParse(params.cliente);
  return {
    query: (params.q ?? "").slice(0, 120),
    statuses: normalizeShipmentStatuses(params.estado?.split(",") ?? []),
    period: parsePeriodParams(params),
    clientId: client.success ? client.data : null,
    trip: isTripFilter(params.viaje) ? params.viaje : null,
    kind: isShipmentKind(params.tipo) ? params.tipo : null,
  };
}

export function shipmentListParamsToUrl(
  params: ShipmentListParams,
): Record<string, string | null> {
  return {
    q: params.query.trim() || null,
    estado: params.statuses.length > 0 ? params.statuses.join(",") : null,
    period: params.period.preset,
    from: params.period.from,
    to: params.period.to,
    cliente: params.clientId,
    viaje: params.trip,
    tipo: params.kind,
  };
}

/** The server-side filter of `params` (the text search stays on the client,
 *  over the filtered rows). */
export function shipmentListFilter(
  params: ShipmentListParams,
  today?: string,
): ShipmentListFilter {
  const range = resolvePeriod(params.period, today);
  return {
    ...(params.statuses.length > 0 && { statuses: params.statuses }),
    ...(range && { from: range.from, to: range.to }),
    ...(params.clientId && { clientId: params.clientId }),
    ...(params.trip && { assigned: params.trip === "asignada" }),
    ...(params.kind && { kinds: [params.kind] }),
  };
}

/** The list with no filter (the «Limpiar» target). */
export const DEFAULT_SHIPMENT_LIST_PARAMS: ShipmentListParams = {
  query: "",
  statuses: [],
  period: { preset: null, from: null, to: null },
  clientId: null,
  trip: null,
  kind: null,
};
