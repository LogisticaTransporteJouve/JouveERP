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

import { useCreateVehicle, useUpdateVehicle } from "../hooks/use-vehicles";
import {
  VEHICLE_TYPES,
  VEHICLE_TYPE_LABELS,
  type Vehicle,
  type VehicleType,
} from "../schema";

const FormSchema = z.object({
  patente: z.string().trim().min(1, "Patente requerida.").max(20),
  vehicle_type: z.enum(VEHICLE_TYPES),
  alias: z.string().trim().max(120),
  brand: z.string().trim().max(60),
  model: z.string().trim().max(60),
  year: z.string().trim(),
  fleet: z.string().trim().max(60),
  capacity_kg: z.string().trim(),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(vehicle?: Vehicle): FormValues {
  return {
    patente: vehicle?.patente ?? "",
    vehicle_type: vehicle?.vehicle_type ?? "camion",
    alias: vehicle?.alias ?? "",
    brand: vehicle?.brand ?? "",
    model: vehicle?.model ?? "",
    year: vehicle?.year != null ? String(vehicle.year) : "",
    fleet: vehicle?.fleet ?? "",
    capacity_kg: vehicle?.capacity_kg != null ? String(vehicle.capacity_kg) : "",
    notes: vehicle?.notes ?? "",
  };
}

export function VehicleDialog({
  mode,
  vehicle,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  vehicle?: Vehicle;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateVehicle();
  const updateMut = useUpdateVehicle();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(vehicle),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(vehicle));
  }, [open, vehicle, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      patente: values.patente,
      vehicle_type: values.vehicle_type,
      alias: values.alias,
      brand: values.brand,
      model: values.model,
      year: values.year,
      fleet: values.fleet,
      capacity_kg: values.capacity_kg,
      notes: values.notes,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Vehículo creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (vehicle) {
      updateMut.mutate(
        { id: vehicle.id, ...payload },
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
          <DialogTitle>
            {isEdit ? "Editar vehículo" : "Nuevo vehículo"}
          </DialogTitle>
          <DialogDescription>
            Vehículo de la flota. La documentación vencible (VTV, seguro) se carga
            aparte.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="patente"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Patente</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="AB123CD" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="vehicle_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as VehicleType)
                      }
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VEHICLE_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {VEHICLE_TYPE_LABELS[t]}
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
              name="alias"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Alias</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Chasis 1" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Marca</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Scania" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Modelo</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="R450" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Año</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" placeholder="2020" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="capacity_kg"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacidad (kg)</FormLabel>
                    <FormControl>
                      <Input {...field} type="number" placeholder="30000" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="fleet"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Flota</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Logística Jouve" />
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
