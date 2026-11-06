"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  FormColumn,
  FormColumns,
  WIDE_FORM_DIALOG,
} from "@/components/form-columns";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
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

import { useCreatePallet, useUpdatePallet } from "../hooks/use-pallets";
import { PALLET_STATUSES, PALLET_STATUS_LABELS, type Pallet } from "../schema";

import { AreaSelect, type AreaOption } from "./area-select";
import { ClientOptionsReadError } from "./client-options-read-error";

const NONE = "__none__";

const FormSchema = z.object({
  warehouse_id: z.string().uuid("Depósito requerido."),
  client_id: z.string().uuid("Cliente requerido."),
  product_id: z.string(),
  code: z.string().trim().min(1, "Código requerido.").max(60),
  quantity: z.string(),
  status: z.enum(PALLET_STATUSES),
  entry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha requerida."),
  exit_date: z.string(),
  notes: z.string().trim().max(2000),
  area_id: z.string(),
  lot_number: z.string().trim().max(60),
  lot_expiry: z.string(),
});

type FormValues = z.infer<typeof FormSchema>;

function toDefaults(pallet?: Pallet): FormValues {
  return {
    warehouse_id: pallet?.warehouse_id ?? "",
    client_id: pallet?.client_id ?? "",
    product_id: pallet?.product_id ?? "",
    code: pallet?.code ?? "",
    quantity: pallet?.quantity != null ? String(pallet.quantity) : "",
    status: pallet?.status ?? "en_deposito",
    entry_date: pallet?.entry_date ?? "",
    exit_date: pallet?.exit_date ?? "",
    notes: pallet?.notes ?? "",
    area_id: pallet?.area_id ?? "",
    lot_number: pallet?.lot_number ?? "",
    lot_expiry: pallet?.lot_expiry ?? "",
  };
}

export function PalletDialog({
  mode,
  pallet,
  warehouseOptions,
  clientOptions,
  productOptions,
  areaOptions,
  canMoveStock,
  open,
  onOpenChange,
}: {
  mode: "create" | "edit";
  pallet?: Pallet;
  warehouseOptions: { id: string; name: string }[];
  /** null: the clients could not be read. */
  clientOptions: { id: string; legal_name: string }[] | null;
  productOptions: { id: string; name: string }[];
  areaOptions: AreaOption[];
  /** Without it only the fields that move no stock can change. */
  canMoveStock: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createMut = useCreatePallet();
  const updateMut = useUpdatePallet();
  const isSaving = createMut.isPending || updateMut.isPending;
  const isEdit = mode === "edit";
  const stockLocked = !canMoveStock;

  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: toDefaults(pallet),
  });

  useEffect(() => {
    if (open) form.reset(toDefaults(pallet));
  }, [open, pallet, form]);

  const warehouseId = useWatch({ control: form.control, name: "warehouse_id" });

  function onSubmit(values: FormValues) {
    const payload = {
      warehouse_id: values.warehouse_id,
      client_id: values.client_id,
      product_id: values.product_id,
      code: values.code,
      quantity: values.quantity,
      status: values.status,
      entry_date: values.entry_date,
      exit_date: values.exit_date,
      notes: values.notes,
      area_id: values.area_id,
      lot_number: values.lot_number,
      lot_expiry: values.lot_expiry,
    };
    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Pallet creado.");
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (pallet) {
      updateMut.mutate(
        { id: pallet.id, ...payload },
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
      <DialogContent className={WIDE_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar pallet" : "Nuevo pallet"}</DialogTitle>
          <DialogDescription>
            Unidad física almacenada: depósito, cliente y producto.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormColumns>
              <FormColumn>
                <FormField
                  control={form.control}
                  name="warehouse_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depósito</FormLabel>
                      <Select
                        value={field.value}
                        disabled={stockLocked}
                        onValueChange={(v) => {
                          field.onChange(v);
                          // An area belongs to one warehouse.
                          if (v !== field.value) form.setValue("area_id", "");
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Elegí un depósito" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {warehouseOptions.map((w) => (
                            <SelectItem key={w.id} value={w.id}>
                              {w.name}
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
                  name="area_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Área (opcional)</FormLabel>
                      <FormControl>
                        <AreaSelect
                          areaOptions={areaOptions}
                          warehouseId={warehouseId}
                          value={field.value}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="client_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cliente</FormLabel>
                      <FormControl>
                        <Combobox
                          options={(clientOptions ?? []).map((c) => ({
                            value: c.id,
                            label: c.legal_name,
                          }))}
                          value={field.value}
                          onChange={field.onChange}
                          placeholder="Elegí un cliente"
                          searchPlaceholder="Buscar cliente…"
                          emptyText="Sin clientes."
                        />
                      </FormControl>
                      <ClientOptionsReadError clientOptions={clientOptions} />
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="product_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Producto (opcional)</FormLabel>
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
                          {productOptions.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
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
                    name="code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Código</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="P-001" />
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
                        <Select
                          value={field.value}
                          disabled={stockLocked}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {PALLET_STATUSES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {PALLET_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </FormColumn>
              <FormColumn>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="lot_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lote (opcional)</FormLabel>
                        <FormControl>
                          <Input {...field} maxLength={60} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lot_expiry"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Vencimiento del lote</FormLabel>
                        <FormControl>
                          <DatePicker {...field} clearable />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cantidad</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          disabled={stockLocked}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="entry_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ingreso</FormLabel>
                        <FormControl>
                          <DatePicker {...field} disabled={stockLocked} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="exit_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Egreso (opcional)</FormLabel>
                        <FormControl>
                          <DatePicker
                            {...field}
                            disabled={stockLocked}
                            clearable
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {stockLocked && (
                  <p className="text-muted-foreground text-xs">
                    Depósito, estado, cantidad y fechas mueven stock: no tenés
                    permiso para cambiarlos.
                  </p>
                )}
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
              </FormColumn>
            </FormColumns>
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
