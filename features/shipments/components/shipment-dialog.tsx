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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import {
  useCreateShipment,
  useShipmentOptions,
  useUpdateShipment,
} from "../hooks/use-shipments";
import { type Shipment } from "../schema";

const NONE = "__none__";

// Plain string form, validated/coerced into the action schemas server-side.
const FormSchema = z.object({
  client_id: z.string(),
  trip_id: z.string(),
  channel_id: z.string(),
  origin: z.string().trim().max(160),
  destination: z.string().trim().max(160),
  description: z.string().trim().max(500),
  scheduled_date: z.string(),
  freight_amount: z.string(),
  notes: z.string().trim().max(2000),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(shipment?: Shipment): FormValues {
  return {
    client_id: shipment?.client_id ?? "",
    trip_id: shipment?.trip_id ?? "",
    channel_id: shipment?.channel_id ?? "",
    origin: shipment?.origin ?? "",
    destination: shipment?.destination ?? "",
    description: shipment?.description ?? "",
    scheduled_date: shipment?.scheduled_date ?? "",
    freight_amount:
      shipment?.freight_amount != null ? String(shipment.freight_amount) : "",
    notes: shipment?.notes ?? "",
  };
}

export function ShipmentDialog({
  mode,
  shipment,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  shipment?: Shipment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: options, isLoading: optionsLoading } = useShipmentOptions();
  const createMut = useCreateShipment();
  const updateMut = useUpdateShipment();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(shipment),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(shipment));
  }, [open, shipment, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      client_id: values.client_id,
      trip_id: values.trip_id,
      channel_id: values.channel_id,
      origin: values.origin,
      destination: values.destination,
      description: values.description,
      scheduled_date: values.scheduled_date,
      freight_amount: values.freight_amount,
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
    } else if (shipment) {
      updateMut.mutate(
        { id: shipment.id, ...payload },
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
            Carga a transportar: cliente, viaje, ruta y flete.
          </DialogDescription>
        </DialogHeader>
        {optionsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="client_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cliente</FormLabel>
                    <Select
                      value={field.value === "" ? NONE : field.value}
                      onValueChange={(v) => field.onChange(v === NONE ? "" : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin asignar" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NONE}>Sin asignar</SelectItem>
                        {(options?.clients ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.legal_name}
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
                  name="trip_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Viaje</FormLabel>
                      <Select
                        value={field.value === "" ? NONE : field.value}
                        onValueChange={(v) =>
                          field.onChange(v === NONE ? "" : v)
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sin asignar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>Sin asignar</SelectItem>
                          {(options?.trips ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.trip_date}
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
                  name="channel_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Canal</FormLabel>
                      <Select
                        value={field.value === "" ? NONE : field.value}
                        onValueChange={(v) =>
                          field.onChange(v === NONE ? "" : v)
                        }
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Sin asignar" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={NONE}>Sin asignar</SelectItem>
                          {(options?.channels ?? []).map((c) => (
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
              </div>
              <div className="grid grid-cols-2 gap-3">
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
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descripción</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={2}
                        placeholder="Materiales de obra"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="scheduled_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fecha programada</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="freight_amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Flete</FormLabel>
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
        )}
      </DialogContent>
    </Dialog>
  );
}
