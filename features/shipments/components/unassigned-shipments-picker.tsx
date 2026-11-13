"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

import { useUnassignedShipments } from "../hooks/use-shipments";
import { formatArgentineDate } from "@/lib/format";

/** Checkbox list of the cargas without a trip that can still go on one
 *  (pendientes o reprogramadas); read while `enabled`. */
export function UnassignedShipmentsPicker({
  enabled,
  selected,
  onToggle,
}: {
  enabled: boolean;
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const { data: items, isLoading, isError } = useUnassignedShipments(enabled);

  return (
    <div className="max-h-80 space-y-1 overflow-y-auto">
      {isLoading ? (
        <>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          No se pudieron cargar las cargas sin viaje.
        </p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay cargas sin viaje. Creálas en Cargas.
        </p>
      ) : (
        items.map((s) => (
          <label
            key={s.id}
            className="flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm hover:bg-muted/50"
          >
            <Checkbox
              className="mt-0.5"
              checked={selected.has(s.id)}
              onCheckedChange={(v) => onToggle(s.id, v === true)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                {s.client?.legal_name ?? "Sin cliente"}
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[
                  s.destination,
                  s.scheduled_date && formatArgentineDate(s.scheduled_date),
                  s.description,
                ]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </span>
            </span>
          </label>
        ))
      )}
    </div>
  );
}
