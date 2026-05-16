"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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

import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";

import {
  usePurchaseInvoiceByIdOptional,
  useCreatePurchaseInvoice,
  useUpdatePurchaseInvoice,
} from "../hooks/use-purchase-invoices";
import {
  PURCHASE_INVOICE_KINDS,
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_INVOICE_LETTERS,
  type PurchaseInvoice,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceLetter,
} from "../schema";
import {
  PurchaseInvoicePicker,
  type PickedPurchaseInvoice,
} from "./purchase-invoice-picker";

type Mode = "create" | "edit";

type FormValues = {
  supplier: PickedSupplier | null;
  channel_id: string;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | "";
  punto_venta: string;
  numero: string;
  fecha: string;
  fch_vto_pago: string;
  imp_neto: string;
  imp_iva: string;
  imp_trib: string;
  imp_total: string;
  moneda: string;
  cotizacion: string;
  cae_proveedor: string;
  cae_vto_proveedor: string;
  origin_invoice: PickedPurchaseInvoice | null;
  motivo_nc_nd: string;
  notes: string;
};

function todayIso(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function invoiceToValues(
  inv: PurchaseInvoice | undefined,
  initialChannelId: string,
): FormValues {
  return {
    supplier: inv
      ? {
          id: inv.supplier_id,
          legal_name: inv.supplier_legal_name,
          display_name: null,
          cuit: inv.supplier_cuit,
          // iva_condition no la trae el listado, pero el picker la usa solo
          // para el chip. Default seguro:
          iva_condition: "responsable_inscripto",
        }
      : null,
    channel_id: inv?.channel_id ?? initialChannelId,
    kind: inv?.kind ?? "factura",
    letter: inv?.letter ?? "",
    punto_venta: inv ? String(inv.punto_venta) : "",
    numero: inv ? String(inv.numero) : "",
    fecha: inv?.fecha ?? todayIso(),
    fch_vto_pago: inv?.fch_vto_pago ?? "",
    imp_neto: inv ? String(inv.imp_neto) : "0",
    imp_iva: inv ? String(inv.imp_iva) : "0",
    imp_trib: inv ? String(inv.imp_trib) : "0",
    imp_total: inv ? String(inv.imp_total) : "",
    moneda: inv?.moneda ?? "PES",
    cotizacion: inv ? String(inv.cotizacion) : "1",
    cae_proveedor: inv?.cae_proveedor ?? "",
    cae_vto_proveedor: inv?.cae_vto_proveedor ?? "",
    origin_invoice: null,
    motivo_nc_nd: inv?.motivo_nc_nd ?? "",
    notes: inv?.notes ?? "",
  };
}

export function PurchaseInvoiceForm({
  mode,
  invoice,
  initialSupplier,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  invoice?: PurchaseInvoice;
  initialSupplier?: PickedSupplier | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const defaultChannelId =
    invoice?.channel_id ?? activeChannels[0]?.id ?? "";

  const createMut = useCreatePurchaseInvoice();
  const updateMut = useUpdatePurchaseInvoice();
  const isSaving = createMut.isPending || updateMut.isPending;

  const form = useForm<FormValues>({
    defaultValues: {
      ...invoiceToValues(invoice, defaultChannelId),
      supplier: invoice ? invoiceToValues(invoice, defaultChannelId).supplier : initialSupplier ?? null,
    },
  });

  const watchedKind = form.watch("kind");
  const watchedMoneda = form.watch("moneda");
  const watchedNeto = form.watch("imp_neto");
  const watchedIva = form.watch("imp_iva");
  const watchedTrib = form.watch("imp_trib");
  const watchedSupplierId = form.watch("supplier")?.id ?? null;
  const watchedOriginId = form.watch("origin_invoice")?.id ?? null;

  const originInvoiceQuery = usePurchaseInvoiceByIdOptional(
    invoice?.invoice_origin_id ?? null,
  );
  const originInvoiceData = originInvoiceQuery.data ?? null;

  useEffect(() => {
    if (!originInvoiceData) return;
    if (watchedOriginId === originInvoiceData.id) return;
    form.setValue(
      "origin_invoice",
      {
        id: originInvoiceData.id,
        kind: originInvoiceData.kind,
        letter: originInvoiceData.letter,
        punto_venta: originInvoiceData.punto_venta,
        numero: originInvoiceData.numero,
        imp_total: originInvoiceData.imp_total,
        fecha: originInvoiceData.fecha,
      },
      { shouldDirty: false },
    );
  }, [originInvoiceData, watchedOriginId, form]);

  // Si cambia el proveedor o el tipo deja de ser NC/ND, soltar el origen.
  useEffect(() => {
    const current = form.getValues("origin_invoice");
    if (!current) return;
    if (watchedKind === "factura") {
      form.setValue("origin_invoice", null, { shouldDirty: true });
    }
  }, [watchedKind, form]);

  useEffect(() => {
    const current = form.getValues("origin_invoice");
    if (!current) return;
    if (!watchedSupplierId) {
      form.setValue("origin_invoice", null, { shouldDirty: true });
    }
  }, [watchedSupplierId, form]);

  // Auto-sumar imp_total = neto + iva + trib mientras el user no lo toque.
  useEffect(() => {
    const neto = Number(watchedNeto || 0);
    const iva = Number(watchedIva || 0);
    const trib = Number(watchedTrib || 0);
    if (!Number.isFinite(neto) || !Number.isFinite(iva) || !Number.isFinite(trib)) {
      return;
    }
    const total = +(neto + iva + trib).toFixed(2);
    const currentTotal = Number(form.getValues("imp_total") || 0);
    // Solo overwrite si el total no fue tocado manualmente, o coincide con el
    // cálculo previo. Heurística: si total es 0 o suma de otros tres ± 0.01.
    if (currentTotal === 0 || Math.abs(currentTotal - total) < 0.01) {
      form.setValue("imp_total", String(total), { shouldDirty: false });
    }
  }, [watchedNeto, watchedIva, watchedTrib, form]);

  function onSubmit(values: FormValues) {
    if (!values.supplier) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (!values.channel_id) {
      toast.error("Seleccioná un canal.");
      return;
    }

    const payload = {
      supplier_id: values.supplier.id,
      channel_id: values.channel_id,
      kind: values.kind,
      letter: values.letter === "" ? null : values.letter,
      punto_venta: Number(values.punto_venta),
      numero: Number(values.numero),
      fecha: values.fecha,
      fch_vto_pago: values.fch_vto_pago || null,
      imp_neto: Number(values.imp_neto || 0),
      imp_iva: Number(values.imp_iva || 0),
      imp_trib: Number(values.imp_trib || 0),
      imp_total: Number(values.imp_total),
      moneda: values.moneda,
      cotizacion: Number(values.cotizacion || 1),
      cae_proveedor: values.cae_proveedor || null,
      cae_vto_proveedor: values.cae_vto_proveedor || null,
      invoice_origin_id:
        values.kind === "factura" ? null : values.origin_invoice?.id ?? null,
      motivo_nc_nd: values.motivo_nc_nd || null,
      notes: values.notes || null,
    };

    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: (data) => {
          toast.success("Factura cargada.");
          if (onSuccess) onSuccess(data.id);
          else router.push("/purchases");
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (invoice) {
      updateMut.mutate(
        { id: invoice.id, ...payload },
        {
          onSuccess: () => {
            toast.success("Cambios guardados.");
            if (onSuccess) onSuccess(invoice.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  const isNcOrNd = watchedKind !== "factura";
  const showCotizacion = watchedMoneda !== "PES";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="supplier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Proveedor</FormLabel>
              <FormControl>
                <SupplierPicker
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="channel_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Canal</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí canal" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeChannels.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.is_fiscal ? " · fiscal" : " · interno"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PURCHASE_INVOICE_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {PURCHASE_INVOICE_KIND_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <FormField
            control={form.control}
            name="letter"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Letra</FormLabel>
                <FormControl>
                  <Select
                    value={field.value || "__none"}
                    onValueChange={(v) => field.onChange(v === "__none" ? "" : v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— Sin letra</SelectItem>
                      {PURCHASE_INVOICE_LETTERS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="punto_venta"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Punto de venta</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    placeholder="3"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="numero"
            render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Número</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="numeric"
                    placeholder="12345"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="fecha"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="fch_vto_pago"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vencimiento de pago</FormLabel>
                <FormControl>
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    clearable
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <FormField
            control={form.control}
            name="imp_neto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Neto</FormLabel>
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
            name="imp_iva"
            render={({ field }) => (
              <FormItem>
                <FormLabel>IVA</FormLabel>
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
            name="imp_trib"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Otros tributos</FormLabel>
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
            name="imp_total"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Total</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    className="font-semibold"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="moneda"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Moneda</FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PES">ARS — Peso</SelectItem>
                      <SelectItem value="DOL">USD — Dólar</SelectItem>
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {showCotizacion && (
            <FormField
              control={form.control}
              name="cotizacion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cotización</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="cae_proveedor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>CAE proveedor (opcional)</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder="14 dígitos"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cae_vto_proveedor"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vto. CAE proveedor</FormLabel>
                <FormControl>
                  <DatePicker
                    value={field.value}
                    onChange={field.onChange}
                    clearable
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {isNcOrNd && (
          <div className="space-y-4 rounded-md border border-dashed bg-muted/20 p-4">
            <FormField
              control={form.control}
              name="origin_invoice"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Factura origen{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      (opcional, recomendado para que el aging la descuente)
                    </span>
                  </FormLabel>
                  <FormControl>
                    <PurchaseInvoicePicker
                      value={field.value}
                      onChange={field.onChange}
                      supplierId={watchedSupplierId}
                      excludeId={invoice?.id ?? null}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="motivo_nc_nd"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      autoComplete="off"
                      placeholder="Ej: ajuste por devolución"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notas</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => (onCancel ? onCancel() : router.push("/purchases"))}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={
              isSaving || (mode === "edit" && !form.formState.isDirty)
            }
          >
            {isSaving
              ? "Guardando…"
              : mode === "create"
                ? "Cargar factura"
                : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
