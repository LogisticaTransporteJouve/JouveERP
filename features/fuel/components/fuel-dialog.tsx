"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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

import { useCreateFuelLoad, useUpdateFuelLoad } from "../hooks/use-fuel";
import type { FuelLoad } from "../schema";

const NONE = "__none__";

const FormSchema = z.object({
  vehicle_id: z.string().min(1, "Vehículo requerido."),
  trip_id: z.string(),
  load_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  liters: z.string(),
  amount: z.string(),
  odometer_km: z.string(),
  station: z.string().trim().max(120),
  card: z.string().trim().max(120),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(fuelLoad?: FuelLoad): FormValues {
  return {
    vehicle_id: fuelLoad?.vehicle_id ?? "",
    trip_id: fuelLoad?.trip_id ?? "",
    load_date: fuelLoad?.load_date ?? "",
    liters: fuelLoad?.liters != null ? String(fuelLoad.liters) : "",
    amount: fuelLoad?.amount != null ? String(fuelLoad.amount) : "",
    odometer_km:
      fuelLoad?.odometer_km != null ? String(fuelLoad.odometer_km) : "",
    station: fuelLoad?.station ?? "",
    card: fuelLoad?.card ?? "",
    notes: fuelLoad?.notes ?? "",
  };
}

function tripLabel(t: {
  trip_date: string;
  origin: string | null;
  destination: string | null;
}) {
  return `${t.trip_date} ${t.origin ?? ""}→${t.destination ?? ""}`;
}

export function FuelDialog({
  mode,
  fuelLoad,
  vehicleOptions,
  tripOptions,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  fuelLoad?: FuelLoad;
  vehicleOptions: { id: string; patente: string }[];
  tripOptions: {
    id: string;
    trip_date: string;
    origin: string | null;
    destination: string | null;
  }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateFuelLoad();
  const updateMut = useUpdateFuelLoad();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(fuelLoad),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(fuelLoad));
  }, [open, fuelLoad, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      vehicle_id: values.vehicle_id,
      trip_id: values.trip_id,
      load_date: values.load_date,
      liters: values.liters,
      amount: values.amount,
      odometer_km: values.odometer_km,
      station: values.station,
      card: values.card,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Carga creada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (fuelLoad) {
      updateMut.mutate(
        { id: fuelLoad.id, ...payload },
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
          <DialogTitle>{isEdit ? "Editar carga" : "Nueva carga"}</DialogTitle>
          <DialogDescription>
            Carga de combustible de la flota: vehículo, litros e importe.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="vehicle_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Vehículo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Elegí un vehículo" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
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
              <FormField
                control={form.control}
                name="load_date"
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
            </div>
            <FormField
              control={form.control}
              name="trip_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Viaje (opcional)</FormLabel>
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
                      {tripOptions.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {tripLabel(t)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="liters"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Litros</FormLabel>
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
                name="amount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Importe</FormLabel>
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
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="odometer_km"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Odómetro (km)</FormLabel>
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
                name="station"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Estación</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="YPF" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="card"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tarjeta</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
