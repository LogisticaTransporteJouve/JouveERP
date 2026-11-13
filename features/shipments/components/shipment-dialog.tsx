"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { isIvaCondition } from "@/features/clients/schema";
import {
  ClientPicker,
  type PickedClient,
} from "@/features/invoices/components/client-picker";

import { useCreateShipment, useUpdateShipment } from "../hooks/use-shipments";
import {
  SHIPMENT_KIND_LABELS,
  SHIPMENT_KINDS,
  UNLOAD_BEFORE_LOAD_MESSAGE,
  isShipmentKind,
  type Shipment,
} from "../schema";

// Plain string form, validated/coerced into the action schemas server-side.
const FormSchema = z
  .object({
    client_id: z.string(),
    description: z.string().trim().max(500),
    kind: z.enum(SHIPMENT_KINDS),
    origin: z.string().trim().max(160),
    destination: z.string().trim().max(160),
    scheduled_date: z.string(),
    unload_date: z.string(),
    time_window: z.string().trim().max(60),
    notes: z.string().trim().max(1000),
  })
  .refine(
    (v) =>
      !v.scheduled_date || !v.unload_date || v.unload_date >= v.scheduled_date,
    { message: UNLOAD_BEFORE_LOAD_MESSAGE, path: ["unload_date"] },
  );

type FormValues = z.infer<typeof FormSchema>;

function pickedFrom(shipment?: Shipment): PickedClient | null {
  if (!shipment?.client_id || !shipment.client) return null;
  const c = shipment.client;
  return {
    id: shipment.client_id,
    legal_name: c.legal_name,
    display_name: c.display_name,
    cuit: c.cuit,
    iva_condition: isIvaCondition(c.iva_condition) ? c.iva_condition : null,
    is_fiscal: c.is_fiscal,
  };
}

function toDefaults(shipment?: Shipment): FormValues {
  return {
    client_id: shipment?.client_id ?? "",
    description: shipment?.description ?? "",
    kind: shipment?.kind ?? "carga",
    origin: shipment?.origin ?? "",
    destination: shipment?.destination ?? "",
    scheduled_date: shipment?.scheduled_date ?? "",
    unload_date: shipment?.unload_date ?? "",
    time_window: shipment?.time_window ?? "",
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
  const createMut = useCreateShipment();
  const updateMut = useUpdateShipment();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(shipment),
  });

  // The unload day picker starts at the load day.
  const loadDate = useWatch({ control: form.control, name: "scheduled_date" });

  const [client, setClient] = useState<PickedClient | null>(() =>
    pickedFrom(shipment),
  );

  useEffect(() => {
    if (!open) return;
    form.reset(toDefaults(shipment));
    setClient(pickedFrom(shipment));
  }, [open, shipment, form]);

  function onSubmit(values: FormValues) {
    if (mode === "create") {
      createMut.mutate(values, {
        onSuccess: () => {
          toast.success("Carga creada.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (shipment) {
      updateMut.mutate(
        { id: shipment.id, ...values },
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar carga" : "Nueva carga"}</DialogTitle>
          <DialogDescription>
            Carga a transportar: cliente, tipo, direcciones, fechas y horario.
            El viaje se asigna después, desde el viaje.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="client_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <ClientPicker
                    value={client}
                    onChange={(picked) => {
                      setClient(picked);
                      field.onChange(picked?.id ?? "");
                    }}
                    isFiscal={null}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
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
            <FormField
              control={form.control}
              name="kind"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      if (isShipmentKind(v)) field.onChange(v);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SHIPMENT_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {SHIPMENT_KIND_LABELS[k]}
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
              name="origin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dirección de carga</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Depósito, Av. Mitre 500, Avellaneda"
                      maxLength={160}
                      autoComplete="off"
                    />
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
                  <FormLabel>Dirección de descarga</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Av. Corrientes 1234, CABA"
                      maxLength={160}
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="scheduled_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de carga</FormLabel>
                    <FormControl>
                      <DatePicker {...field} clearable />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="unload_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fecha de descarga</FormLabel>
                    <FormControl>
                      <DatePicker
                        {...field}
                        clearable
                        min={loadDate || undefined}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="time_window"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Horario</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="8 a 12 hs"
                      maxLength={60}
                      autoComplete="off"
                    />
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
                  <FormLabel>Observaciones</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={2} maxLength={1000} />
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
              <DisabledHint
                reason={
                  isEdit && !form.formState.isDirty ? NO_CHANGES_REASON : null
                }
              >
                <Button
                  type="submit"
                  disabled={isSaving || (isEdit && !form.formState.isDirty)}
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
