"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatArgentineDate } from "@/lib/format";

import { isIvaCondition } from "@/features/clients/schema";
import {
  ClientPicker,
  type PickedClient,
} from "@/features/invoices/components/client-picker";

import {
  useCreateShipment,
  useShipmentOptions,
  useShipmentRemitoConflict,
  useUpdateShipment,
} from "../hooks/use-shipments";
import { formatRoute } from "../lib/format";
import {
  REMITO_NUMBER_MAX,
  SHIPMENT_STATUS_LABELS,
  isShipmentStatus,
  type Shipment,
  type ShipmentRemitoConflict,
} from "../schema";

const NONE = "__none__";

function remitoConflictLabel(c: ShipmentRemitoConflict): string {
  const parts = [
    c.scheduled_date ? formatArgentineDate(c.scheduled_date) : "sin fecha",
    formatRoute(c.origin, c.destination),
  ];
  if (isShipmentStatus(c.status)) {
    parts.push(SHIPMENT_STATUS_LABELS[c.status].toLowerCase());
  }
  return parts.join(" · ");
}

// Plain string form, validated/coerced into the action schemas server-side.
const FormSchema = z.object({
  client_id: z.string(),
  trip_id: z.string(),
  remito_number: z.string().trim().max(REMITO_NUMBER_MAX),
  origin: z.string().trim().max(160),
  destination: z.string().trim().max(160),
  description: z.string().trim().max(500),
  scheduled_date: z.string(),
  freight_amount: z.string(),
  notes: z.string().trim().max(2000),
});

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
    trip_id: shipment?.trip_id ?? "",
    remito_number: shipment?.remito_number ?? "",
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

  const [client, setClient] = useState<PickedClient | null>(() =>
    pickedFrom(shipment),
  );

  useEffect(() => {
    if (!open) return;
    form.reset(toDefaults(shipment));
    setClient(pickedFrom(shipment));
  }, [open, shipment, form]);

  // Duplicate remito: checked against the client's live cargas as the user
  // types; the unique index refuses it anyway.
  const watchedClientId = form.watch("client_id");
  const typedRemito = form.watch("remito_number");
  const debouncedRemito = useDebouncedValue(typedRemito, 400);
  const remitoCheck = useShipmentRemitoConflict({
    clientId: open ? watchedClientId : "",
    remitoNumber: debouncedRemito,
    excludeId: shipment?.id ?? null,
  });
  // Only for the number on screen: while the debounce runs the last answer
  // belongs to the previous one.
  const remitoConflict =
    debouncedRemito.trim() === typedRemito.trim()
      ? (remitoCheck.data ?? null)
      : null;

  function onSubmit(values: FormValues) {
    const payload = {
      client_id: values.client_id,
      trip_id: values.trip_id,
      remito_number: values.remito_number,
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
            Carga a transportar: cliente, ruta y flete. El viaje se asigna
            después, desde el viaje.
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
                name="remito_number"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Remito del cliente</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="0001-00012345"
                        maxLength={REMITO_NUMBER_MAX}
                        autoComplete="off"
                      />
                    </FormControl>
                    {remitoConflict && (
                      <p
                        role="alert"
                        className="flex items-start gap-2 text-sm text-muted-foreground"
                      >
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <span>
                          Ese remito ya está en otra carga del cliente (
                          {remitoConflictLabel(remitoConflict)}). Cambiá el
                          número o cancelá esa carga para usarlo.
                        </span>
                      </p>
                    )}
                    {remitoCheck.isError && (
                      <p className="text-sm text-muted-foreground">
                        No se pudo verificar si el remito está repetido.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              {/* A new carga waits unassigned; trips pick their cargas from
                  the trip page. Editing can still move or unassign it. */}
              {isEdit && (
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
              )}
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
                  disabled={
                    isSaving ||
                    remitoConflict !== null ||
                    (isEdit && !form.formState.isDirty)
                  }
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
