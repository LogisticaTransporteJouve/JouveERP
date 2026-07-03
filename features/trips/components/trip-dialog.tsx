"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useScope } from "@/components/providers/scope-provider";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { useCreateTrip, useUpdateTrip } from "../hooks/use-trips";
import {
  TRIP_STATUSES,
  TRIP_STATUS_LABELS,
  type Trip,
} from "../schema";

const NONE = "__none__";

const FormSchema = z.object({
  trip_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  driver_id: z.string(),
  vehicle_id: z.string(),
  channel_id: z.string(),
  origin: z.string().trim().max(160),
  destination: z.string().trim().max(160),
  cargo_description: z.string().trim().max(500),
  status: z.enum(TRIP_STATUSES),
  km: z.string(),
  revenue: z.string(),
  cost: z.string(),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(trip?: Trip): FormValues {
  return {
    trip_date: trip?.trip_date ?? "",
    driver_id: trip?.driver_id ?? "",
    vehicle_id: trip?.vehicle_id ?? "",
    channel_id: trip?.channel_id ?? "",
    origin: trip?.origin ?? "",
    destination: trip?.destination ?? "",
    cargo_description: trip?.cargo_description ?? "",
    status: trip?.status ?? "planned",
    km: trip?.km != null ? String(trip.km) : "",
    revenue: trip?.revenue != null ? String(trip.revenue) : "",
    cost: trip?.cost != null ? String(trip.cost) : "",
    notes: trip?.notes ?? "",
  };
}

export function TripDialog({
  mode,
  trip,
  driverOptions,
  vehicleOptions,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  trip?: Trip;
  driverOptions: { id: string; full_name: string }[];
  vehicleOptions: { id: string; patente: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const createMut = useCreateTrip();
  const updateMut = useUpdateTrip();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(trip),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(trip));
  }, [open, trip, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      trip_date: values.trip_date,
      driver_id: values.driver_id,
      vehicle_id: values.vehicle_id,
      channel_id: values.channel_id,
      origin: values.origin,
      destination: values.destination,
      cargo_description: values.cargo_description,
      status: values.status,
      km: values.km,
      revenue: values.revenue,
      cost: values.cost,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Viaje creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (trip) {
      updateMut.mutate(
        { id: trip.id, ...payload },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            onOpenChange(false);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar viaje" : "Nuevo viaje"}</DialogTitle>
          <DialogDescription>
            Viaje de la flota: chofer, vehículo, origen/destino y resultado
            económico.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="trip_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
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
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="driver_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Chofer</FormLabel>
                    <Select
                      value={field.value === "" ? NONE : field.value}
                      onValueChange={(v) =>
                        field.onChange(v === NONE ? "" : v)
                      }
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
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehículo</FormLabel>
                    <Select
                      value={field.value === "" ? NONE : field.value}
                      onValueChange={(v) =>
                        field.onChange(v === NONE ? "" : v)
                      }
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
            </div>
            <FormField
              control={form.control}
              name="channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal (opcional)</FormLabel>
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
                      {activeChannels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="origin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Origen</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Buenos Aires" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="destination"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Destino</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Córdoba" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="cargo_description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Carga</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Materiales de obra" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="km"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Km</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="revenue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ingreso</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="cost"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Costo</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notas</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving || (isEdit && !form.formState.isDirty)}
              >
                {isEdit ? "Guardar" : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
