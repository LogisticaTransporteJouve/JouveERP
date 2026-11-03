"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { formatArgentineDate } from "@/lib/format";
import { runAction } from "@/lib/query/run-action";

import { findShipmentsByRemitoAction } from "@/features/shipments/actions/shipments-remito-search";
import { scannedRemitoLabel } from "@/features/shipments/lib/format";
import { shipmentsKeys } from "@/features/shipments/lib/shipments-keys";
import {
  SHIPMENT_STATUS_LABELS,
  isShipmentStatus,
} from "@/features/shipments/schema";

import { RemitoExtractionSchema } from "../schemas";

/** A scanned remito against the cargas: the ones that carry its number (the
 *  client's remito), or how to find it in Cargas. */
export function RemitoShipments({ payload }: { payload: unknown }) {
  const parsed = RemitoExtractionSchema.safeParse(payload);
  const number = parsed.success ? (parsed.data.number ?? null) : null;
  const salesPoint = parsed.success ? (parsed.data.sales_point ?? null) : null;
  const scanned = number === null ? null : { sales_point: salesPoint, number };
  const matches = useQuery({
    queryKey: [
      ...shipmentsKeys.all,
      "byRemito",
      salesPoint ?? "-",
      number ?? "-",
    ] as const,
    queryFn: () =>
      runAction(() =>
        findShipmentsByRemitoAction({
          sales_point: salesPoint,
          number: number ?? 0,
        }),
      ),
    enabled: number !== null,
  });

  if (scanned === null) {
    return (
      <p className="border-t pt-3 text-xs text-muted-foreground">
        No se leyó el número del remito: no se puede buscar su carga.
      </p>
    );
  }
  const label = scannedRemitoLabel(scanned);
  return (
    <div className="space-y-1 border-t pt-3 text-sm">
      <p className="font-medium">Carga del remito {label}</p>
      {matches.isLoading ? (
        <p className="text-xs text-muted-foreground">Buscando…</p>
      ) : matches.isError ? (
        <p className="text-xs text-muted-foreground">
          No se pudo buscar: {matches.error.message}
        </p>
      ) : (matches.data ?? []).length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Ninguna carga tiene este remito.{" "}
          <Link
            href={`/cargas?q=${encodeURIComponent(label)}`}
            className="underline underline-offset-4"
          >
            Ir a Cargas
          </Link>
        </p>
      ) : (
        <ul className="space-y-1 text-xs">
          {(matches.data ?? []).map((s) => (
            <li key={s.id}>
              <Link
                href={`/cargas?q=${encodeURIComponent(s.remito_number)}`}
                className="underline underline-offset-4"
              >
                {s.remito_number}
              </Link>{" "}
              · {s.client_name ?? "Sin cliente"}
              {s.scheduled_date
                ? ` · ${formatArgentineDate(s.scheduled_date)}`
                : ""}
              {isShipmentStatus(s.status)
                ? ` · ${SHIPMENT_STATUS_LABELS[s.status]}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
