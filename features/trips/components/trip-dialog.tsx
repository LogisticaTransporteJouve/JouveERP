"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { DisabledHint, NO_CHANGES_REASON } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { UnassignedShipmentsPicker } from "@/features/shipments/components/unassigned-shipments-picker";

import {
  useCreateTrip,
  useTripCompanionOptions,
  useUpdateTrip,
} from "../hooks/use-trips";
import {
  TRIP_SHIPMENTS_MAX,
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  type Trip,
} from "../schema";

const NONE = "__none__";

const FormSchema = z.object({
  trip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  driver_id: z.string(),
  companion_employee_id: z.string(),
  vehicle_id: z.string(),
  status: z.enum(TRIP_STATUSES),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(trip?: Trip): FormValues {
  return {
    trip_date: trip?.trip_date ?? "",
    driver_id: trip?.driver_id ?? "",
    companion_employee_id: trip?.companion_employee_id ?? "",
    vehicle_id: trip?.vehicle_id ?? "",
    status: trip?.status ?? "planned",
  };
}

/** «Nuevo viaje» / «Editar viaje». `canAssign` (shipments:read + write)
 *  shows, on create, the cargas without a trip to put on it. */
export function TripDialog({
  mode,
  trip,
  driverOptions,
  vehicleOptions,
  canAssign,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  trip?: Trip;
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
  canAssign: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateTrip();
  const updateMut = useUpdateTrip();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";
  const showShipments = !isEdit && canAssign;
  const companions = useTripCompanionOptions(open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tooMany = selected.size > TRIP_SHIPMENTS_MAX;
  // The trip's own Acompañante stays selectable after they stop being active.
  const companionChoices = useMemo(() => {
    const list = companions.data ?? [];
    const currentId = trip?.companion_employee_id;
    if (!currentId || !trip?.companion) return list;
    if (list.some((e) => e.id === currentId)) return list;
    return [{ id: currentId, legal_name: trip.companion.legal_name }, ...list];
  }, [companions.data, trip]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(trip),
  });

  useEffect(() => {
    if (open) {
      form.reset(toDefaults(trip));
      setSelected(new Set());
    }
  }, [open, trip, form]);

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      const shipmentIds = showShipments ? [...selected] : [];
      createMut.mutate(
        { ...values, shipment_ids: shipmentIds },
        {
          onSuccess: ({ assigned, requested, assignError, warning }) => {
            if (assignError) {
              toast.warning(
                `Viaje creado; no se pudieron asignar las cargas: ${assignError}`,
              );
            } else if (assigned < requested) {
              toast.warning(
                `Viaje creado con ${assigned} de ${requested} cargas: las demás ya estaban en otro viaje.`,
              );
            } else if (warning) {
              toast.warning(`Viaje creado. ${warning}`);
            } else {
              toast.success("Viaje creado.");
            }
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    } else if (trip) {
      updateMut.mutate(
        { id: trip.id, ...values },
        {
          onSuccess: ({ warning }) => {
            if (warning) toast.warning(warning);
            else toast.success("Cambios guardados.");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={showShipments ? "sm:max-w-lg" : undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar viaje" : "Nuevo viaje"}</DialogTitle>
          <DialogDescription>
            {showShipments
              ? "Viaje de la flota: chofer, acompañante y vehículo; elegí las cargas que lleva."
              : "Viaje de la flota: fecha, estado, chofer, acompañante y vehículo."}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="trip_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <DatePicker {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estado</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {TRIP_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {TRIP_STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="driver_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chofer</FormLabel>
                    <Select
                      value={field.value === "" ? NONE : field.value}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Ninguno" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Ninguno</SelectItem>
                        {driverOptions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="companion_employee_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Acompañante</FormLabel>
                    <Select
                      value={field.value === "" ? NONE : field.value}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                      disabled={companions.isError}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Ninguno" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Ninguno</SelectItem>
                        {companionChoices.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.legal_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {companions.isError && (
                      <p className="text-sm text-muted-foreground">
                        No se pudieron cargar los empleados.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="vehicle_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehículo</FormLabel>
                  <Select
                    value={field.value === "" ? NONE : field.value}
                    onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Ninguno" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NONE}>Ninguno</SelectItem>
                      {vehicleOptions.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.patente}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {showShipments && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Cargas sin viaje</p>
                <UnassignedShipmentsPicker
                  enabled={open}
                  selected={selected}
                  onToggle={toggle}
                />
                {tooMany && (
                  <p className="text-sm text-muted-foreground">
                    Elegí hasta {TRIP_SHIPMENTS_MAX} cargas por vez.
                  </p>
                )}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <DisabledHint
                reason={
                  isEdit && !form.formState.isDirty ? NO_CHANGES_REASON : null
                }
              >
                <Button
                  type="submit"
                  disabled={
                    isSaving || tooMany || (isEdit && !form.formState.isDirty)
                  }
                >
                  {isEdit ? "Guardar" : "Crear"}
                </Button>
              </DisabledHint>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
