"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatArgentineDate } from "@/lib/format";

import { useTripsOnDate } from "../hooks/use-trips";
import type { Trip } from "../schema";

const NO_TRIP = "__none__";

/** «dd-mm-yyyy · chofer · patente» of a trip. */
export function tripOptionLabel(trip: Trip): string {
  return [
    formatArgentineDate(trip.trip_date),
    trip.driver?.full_name ?? "Sin chofer",
    trip.vehicle?.patente ?? "Sin vehículo",
  ].join(" · ");
}

/** «Asignar a viaje»: the live (not cancelled) trips of `date`, re-read when
 *  the date changes, plus «Sin viaje (asignar después)», the default. */
export function TripOnDateSelect({
  id,
  date,
  value,
  onChange,
}: {
  id: string;
  date: string;
  value: string | null;
  onChange: (tripId: string | null) => void;
}) {
  const { data, isFetching, isError } = useTripsOnDate(date, true);
  const trips = (data ?? []).filter((t) => t.status !== "cancelled");
  const current = value && trips.some((t) => t.id === value) ? value : NO_TRIP;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Asignar a viaje</Label>
      <Select
        value={current}
        onValueChange={(v) => onChange(v === NO_TRIP ? null : v)}
        disabled={date === ""}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TRIP}>Sin viaje (asignar después)</SelectItem>
          {trips.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {tripOptionLabel(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isError ? (
        <p className="text-xs text-muted-foreground">
          No se pudieron leer los viajes de esa fecha.
        </p>
      ) : (
        date !== "" &&
        !isFetching &&
        trips.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No hay viajes para esa fecha.
          </p>
        )
      )}
    </div>
  );
}
