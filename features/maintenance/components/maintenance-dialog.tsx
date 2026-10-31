"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
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
import { CostVoucherFields } from "@/features/fleet-reports/components/cost-voucher-fields";
import type { CostVoucherAccess } from "@/lib/cost-vouchers";

import {
  useCreateMaintenance,
  useUpdateMaintenance,
} from "../hooks/use-maintenance";
import {
  MAINTENANCE_KINDS,
  MAINTENANCE_KIND_LABELS,
  type MaintenanceRecord,
} from "../schema";

const FormSchema = z.object({
  vehicle_id: z.string().min(1, "Vehículo requerido."),
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  kind: z.enum(MAINTENANCE_KINDS),
  description: z.string().trim().min(1, "Descripción requerida.").max(500),
  cost: z.string(),
  odometer_km: z.string(),
  next_service_date: z.string(),
  next_service_km: z.string(),
  provider: z.string().trim().max(160),
  notes: z.string().trim().max(2000),
  purchase_invoice_id: z.string(),
  transaction_id: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(record?: MaintenanceRecord): FormValues {
  return {
    vehicle_id: record?.vehicle_id ?? "",
    service_date: record?.service_date ?? "",
    kind: record?.kind ?? "service",
    description: record?.description ?? "",
    cost: record?.cost != null ? String(record.cost) : "",
    odometer_km: record?.odometer_km != null ? String(record.odometer_km) : "",
    next_service_date: record?.next_service_date ?? "",
    next_service_km:
      record?.next_service_km != null ? String(record.next_service_km) : "",
    provider: record?.provider ?? "",
    notes: record?.notes ?? "",
    purchase_invoice_id: record?.purchase_invoice_id ?? "",
    transaction_id: record?.transaction_id ?? "",
  };
}

export function MaintenanceDialog({
  mode,
  record,
  vehicleOptions,
  voucherAccess,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  record?: MaintenanceRecord;
  vehicleOptions: { id: string; patente: string }[];
  voucherAccess: CostVoucherAccess;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreateMaintenance();
  const updateMut = useUpdateMaintenance();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(record),
  });

  const [purchaseInvoiceId, transactionId, voucherDate] = useWatch({
    control: form.control,
    name: ["purchase_invoice_id", "transaction_id", "service_date"],
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(record));
  }, [open, record, form]);

  function onSubmit(values: FormValues) {
    const payload = {
      vehicle_id: values.vehicle_id,
      service_date: values.service_date,
      kind: values.kind,
      description: values.description,
      cost: values.cost,
      odometer_km: values.odometer_km,
      next_service_date: values.next_service_date,
      next_service_km: values.next_service_km,
      provider: values.provider,
      notes: values.notes,
      ...(voucherAccess.purchaseInvoices && {
        purchase_invoice_id: values.purchase_invoice_id,
      }),
      ...(voucherAccess.transactions && {
        transaction_id: values.transaction_id,
      }),
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Mantenimiento creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (record) {
      updateMut.mutate(
        { id: record.id, ...payload },
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
            {isEdit ? "Editar mantenimiento" : "Nuevo mantenimiento"}
          </DialogTitle>
          <DialogDescription>
            Mantenimiento del vehículo: tipo, fecha, costo y próximo service.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="service_date"
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
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {MAINTENANCE_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {MAINTENANCE_KIND_LABELS[k]}
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
              name="vehicle_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vehículo</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Seleccionar vehículo" />
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descripción</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="Cambio de aceite y filtros"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
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
              <FormField
                control={form.control}
                name="odometer_km"
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="next_service_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Próx. service</FormLabel>
                    <FormControl>
                      <Input {...field} type="date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="next_service_km"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Próx. km</FormLabel>
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
              name="provider"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Proveedor</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Taller Pérez" />
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
            <CostVoucherFields
              access={voucherAccess}
              purchaseInvoiceId={purchaseInvoiceId}
              transactionId={transactionId}
              aroundDate={voucherDate}
              onChange={(field, value) =>
                form.setValue(field, value, { shouldDirty: true })
              }
              disabled={isSaving}
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
