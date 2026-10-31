"use client";

import { AlertTriangle, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { todayIsoLocal } from "@/lib/date-range";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";
import { useSupplierByIdOptional } from "@/features/suppliers/hooks/use-suppliers";

import {
  usePurchaseInvoiceByIdOptional,
  usePurchaseInvoiceItems,
  useCreatePurchaseInvoice,
  usePurchaseInvoiceDuplicate,
  useUpdatePurchaseInvoice,
} from "../hooks/use-purchase-invoices";
import {
  ITEM_DERIVED_FIELDS,
  documentTotalGap,
  draftToFormPatch,
  totalsGap,
  type DraftField,
  type PurchaseInvoiceCreateRawInput,
  type PurchaseInvoiceDraft,
} from "../lib/purchase-invoice-draft";
import {
  PURCHASE_INVOICE_KINDS,
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_INVOICE_LETTERS,
  PURCHASE_INVOICES_PATH,
  formatInvoiceNumber,
  type PurchaseInvoice,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceLetter,
} from "../schema";
import { AiFilledMark } from "./ai-filled-mark";
import {
  PurchaseInvoicePicker,
  type PickedPurchaseInvoice,
} from "./purchase-invoice-picker";
import {
  PurchaseInvoiceItemsEditor,
  computeLine,
  computeTotals,
  emptyItem,
  type PurchaseInvoiceItemDraft,
} from "./purchase-invoice-items-editor";

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
  with_items: boolean;
  items: PurchaseInvoiceItemDraft[];
};

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
          // iva_condition isn't included in the listing, but the picker uses it
          // only for the chip. Safe default:
          iva_condition: "responsable_inscripto",
        }
      : null,
    channel_id: inv?.channel_id ?? initialChannelId,
    kind: inv?.kind ?? "factura",
    letter: inv?.letter ?? "",
    punto_venta: inv ? String(inv.punto_venta) : "",
    numero: inv ? String(inv.numero) : "",
    fecha: inv?.fecha ?? todayIsoLocal(),
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
    with_items: false,
    items: [],
  };
}

function initialValues(
  invoice: PurchaseInvoice | undefined,
  defaultChannelId: string,
  initialSupplier: PickedSupplier | null | undefined,
  draft: PurchaseInvoiceDraft | null | undefined,
): { values: FormValues; filled: ReadonlySet<DraftField> } {
  const base = invoiceToValues(invoice, defaultChannelId);
  if (invoice) return { values: base, filled: new Set() };
  if (!draft) {
    return {
      values: { ...base, supplier: initialSupplier ?? null },
      filled: new Set(),
    };
  }
  const { patch, filled } = draftToFormPatch(draft.data, { fecha: base.fecha });
  return {
    values: {
      ...base,
      ...patch,
      supplier: patch.supplier ?? initialSupplier ?? null,
    },
    filled: new Set(filled),
  };
}

export function PurchaseInvoiceForm({
  mode,
  invoice,
  initialSupplier,
  draft,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  invoice?: PurchaseInvoice;
  initialSupplier?: PickedSupplier | null;
  /** Create mode only: values read from a document, saved via its own submit. */
  draft?: PurchaseInvoiceDraft | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const defaultChannelId = invoice?.channel_id ?? activeChannels[0]?.id ?? "";

  const createDraft = mode === "create" ? (draft ?? null) : null;
  const createMut = useCreatePurchaseInvoice(createDraft?.submitCreate);
  const updateMut = useUpdatePurchaseInvoice();
  const isSaving = createMut.isPending || updateMut.isPending;

  const [initial] = useState(() =>
    initialValues(invoice, defaultChannelId, initialSupplier, createDraft),
  );
  const form = useForm<FormValues>({ defaultValues: initial.values });

  // A field read from the document keeps its mark until the user edits it.
  const dirtyFields = form.formState.dirtyFields;
  function aiMark(field: DraftField) {
    if (!initial.filled.has(field) || dirtyFields[field]) return null;
    // With items, these are recomputed from the lines, not the document's.
    if (watchedWithItems && ITEM_DERIVED_FIELDS.includes(field)) return null;
    return <AiFilledMark />;
  }

  const [suggestedAccount, setSuggestedAccount] = useState(
    createDraft?.data.account ?? null,
  );
  const [acceptTotalsGap, setAcceptTotalsGap] = useState(false);

  const watchedKind = form.watch("kind");
  const watchedMoneda = form.watch("moneda");
  const watchedNeto = form.watch("imp_neto");
  const watchedIva = form.watch("imp_iva");
  const watchedTrib = form.watch("imp_trib");
  const watchedSupplierId = form.watch("supplier")?.id ?? null;
  const watchedOriginId = form.watch("origin_invoice")?.id ?? null;
  const watchedWithItems = form.watch("with_items");
  const watchedItems = form.watch("items");

  const itemsQuery = usePurchaseInvoiceItems(invoice?.id ?? null);
  const itemsData = itemsQuery.data ?? null;

  // In edit mode, if the invoice already has items in the DB → enable "with detail"
  // mode and populate the editor. Only once per load (don't re-apply after the first
  // hydration so we don't overwrite the user's edits).
  useEffect(() => {
    if (!itemsData || itemsData.length === 0) return;
    if (form.getValues("with_items")) return;
    form.setValue(
      "items",
      itemsData.map((it) => ({
        description: it.description,
        quantity: String(it.quantity),
        unit_price: String(it.unit_price),
        iva_rate_id: it.iva_rate_id,
      })),
      { shouldDirty: false },
    );
    form.setValue("with_items", true, { shouldDirty: false });
  }, [itemsData, form]);

  // Derived totals: if there are items, recompute neto/iva/total from the editor;
  // otherwise, sum neto + iva + trib into imp_total. Centralized in a useMemo
  // to avoid re-fires on every keystroke across each separate effect.
  const derivedTotals = useMemo(() => {
    const trib = Number(watchedTrib || 0);
    if (watchedWithItems) {
      const t = computeTotals(watchedItems);
      return {
        mode: "items" as const,
        imp_neto: t.imp_neto,
        imp_iva: t.imp_iva,
        imp_total: +(t.imp_total_lines + trib).toFixed(2),
      };
    }
    const neto = Number(watchedNeto || 0);
    const iva = Number(watchedIva || 0);
    if (
      !Number.isFinite(neto) ||
      !Number.isFinite(iva) ||
      !Number.isFinite(trib)
    ) {
      return null;
    }
    return {
      mode: "header" as const,
      imp_total: +(neto + iva + trib).toFixed(2),
    };
  }, [watchedWithItems, watchedItems, watchedNeto, watchedIva, watchedTrib]);

  useEffect(() => {
    if (!derivedTotals) return;
    if (derivedTotals.mode === "items") {
      form.setValue("imp_neto", String(derivedTotals.imp_neto), {
        shouldDirty: false,
      });
      form.setValue("imp_iva", String(derivedTotals.imp_iva), {
        shouldDirty: false,
      });
      form.setValue("imp_total", String(derivedTotals.imp_total), {
        shouldDirty: false,
      });
      return;
    }
    // Header mode: only overwrite if the total wasn't touched manually, or
    // it matches the previous calculation (±0.01 heuristic).
    const currentTotal = Number(form.getValues("imp_total") || 0);
    if (
      currentTotal === 0 ||
      Math.abs(currentTotal - derivedTotals.imp_total) < 0.01
    ) {
      form.setValue("imp_total", String(derivedTotals.imp_total), {
        shouldDirty: false,
      });
    }
  }, [derivedTotals, form]);

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

  // If the supplier changes or the kind is no longer NC/ND, drop the origin.
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

  // K.12 Part A — Pre-fill from the supplier's defaults (create only + empty
  // fields). In edit mode we touch nothing so we don't clobber already-loaded data.
  const supplierDetailQuery = useSupplierByIdOptional(
    mode === "create" ? watchedSupplierId : null,
  );
  const supplierDetail = supplierDetailQuery.data ?? null;

  useEffect(() => {
    if (mode !== "create" || !supplierDetail) return;
    // Channel: pre-fill only if the form still has the default-from-scope channel
    // and the supplier has one saved.
    if (
      supplierDetail.default_channel_id &&
      form.getValues("channel_id") === defaultChannelId &&
      supplierDetail.default_channel_id !== defaultChannelId
    ) {
      form.setValue("channel_id", supplierDetail.default_channel_id, {
        shouldDirty: false,
      });
    }
    // fch_vto_pago: pre-fill only if it's empty and there's a date and the supplier
    // has default days.
    const fchVtoPago = form.getValues("fch_vto_pago");
    const fecha = form.getValues("fecha");
    if (
      !fchVtoPago &&
      fecha &&
      supplierDetail.default_payment_term_days != null
    ) {
      const d = new Date(fecha + "T00:00:00");
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + supplierDetail.default_payment_term_days);
        const iso = d.toISOString().slice(0, 10);
        form.setValue("fch_vto_pago", iso, { shouldDirty: false });
      }
    }
  }, [mode, supplierDetail, defaultChannelId, form]);

  // K.12 Part C — Internal expense auto-numero. When the channel is internal
  // and the supplier is picked, fetch the next numero for that pair. Only
  // in mode=create and only if the numero field is empty.
  const watchedChannelId = form.watch("channel_id");
  const watchedChannelIsFiscal =
    activeChannels.find((c) => c.id === watchedChannelId)?.is_fiscal ?? true;
  const isInternalChannel = !watchedChannelIsFiscal;

  // An NC/ND only references an invoice of its own channel: switching the
  // channel drops the picked origin (the edit form's first load is not a switch).
  const prevChannelIdRef = useRef(watchedChannelId);
  useEffect(() => {
    if (prevChannelIdRef.current === watchedChannelId) return;
    prevChannelIdRef.current = watchedChannelId;
    if (form.getValues("origin_invoice")) {
      form.setValue("origin_invoice", null, { shouldDirty: true });
    }
  }, [watchedChannelId, form]);

  useEffect(() => {
    if (mode !== "create") return;
    if (!isInternalChannel) return;
    if (!watchedSupplierId || !watchedChannelId) return;
    if (form.getValues("numero")) return; // already typed something

    let cancelled = false;
    (async () => {
      const supabase = createBrowserClient();
      const { data, error } = await supabase.rpc(
        "next_internal_purchase_numero",
        {
          p_channel_id: watchedChannelId,
          p_supplier_id: watchedSupplierId,
        },
      );
      if (cancelled || error || data == null) return;
      form.setValue("numero", String(data), { shouldDirty: false });
      if (!form.getValues("punto_venta")) {
        form.setValue("punto_venta", "1", { shouldDirty: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, isInternalChannel, watchedSupplierId, watchedChannelId, form]);

  const debouncedPv = useDebouncedValue(form.watch("punto_venta"), 300);
  const debouncedNumero = useDebouncedValue(form.watch("numero"), 300);
  const duplicateLookup = useMemo(() => {
    const pv = Number(debouncedPv);
    const numero = Number(debouncedNumero);
    if (mode !== "create" || !watchedSupplierId) return null;
    if (!Number.isInteger(pv) || pv < 1) return null;
    if (!Number.isInteger(numero) || numero < 1) return null;
    return {
      supplier_id: watchedSupplierId,
      kind: watchedKind,
      punto_venta: pv,
      numero,
    };
  }, [mode, watchedSupplierId, watchedKind, debouncedPv, debouncedNumero]);
  const duplicate = usePurchaseInvoiceDuplicate(duplicateLookup).data ?? null;

  // Only document-filled invoices are checked: a manual header-only load may
  // legitimately carry amounts the form has no field for. With items, the
  // computed total is checked against the total printed on the document.
  const watchedTotal = form.watch("imp_total");
  const gap = !createDraft
    ? null
    : watchedWithItems
      ? documentTotalGap(createDraft.data.imp_total, Number(watchedTotal))
      : totalsGap({
          imp_neto: watchedNeto,
          imp_iva: watchedIva,
          imp_trib: watchedTrib,
          imp_total: watchedTotal,
        });

  function onSubmit(values: FormValues) {
    if (!values.supplier) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (gap !== null && !acceptTotalsGap) {
      toast.error(
        "Los importes no cierran: revisá neto, IVA, otros tributos y total.",
      );
      return;
    }
    if (values.moneda !== "PES" && !(Number(values.cotizacion) > 1)) {
      form.setError("cotizacion", {
        message: "Cargá la cotización del dólar (tiene que ser mayor a 1).",
      });
      return;
    }
    if (!values.channel_id) {
      toast.error("Seleccioná un canal.");
      return;
    }

    // Items: if the "With detail" toggle is on, send the computed
    // items. On update, send an empty array if it went from with-items to
    // without-items (clears the table). On create without items, send undefined.
    const itemsPayload = values.with_items
      ? values.items
          .filter((it) => it.description.trim().length > 0)
          .map((it, idx) => {
            const c = computeLine(it);
            return {
              description: it.description.trim(),
              quantity: Number(it.quantity),
              unit_price: Number(it.unit_price),
              iva_rate_id: it.iva_rate_id,
              line_neto: c.line_neto,
              line_iva: c.line_iva,
              line_total: c.line_total,
              sort_order: idx,
            };
          })
      : mode === "edit"
        ? []
        : undefined;

    // If the channel is internal, we force letter/CAE to null even if the form
    // was left with values (e.g. you changed channel after typing).
    const isInternal = !activeChannels.find((c) => c.id === values.channel_id)
      ?.is_fiscal;

    const payload: PurchaseInvoiceCreateRawInput = {
      supplier_id: values.supplier.id,
      channel_id: values.channel_id,
      kind: values.kind,
      letter: isInternal ? null : values.letter === "" ? null : values.letter,
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
      cae_proveedor: isInternal ? null : values.cae_proveedor || null,
      cae_vto_proveedor: isInternal ? null : values.cae_vto_proveedor || null,
      invoice_origin_id:
        values.kind === "factura" ? null : (values.origin_invoice?.id ?? null),
      motivo_nc_nd: values.motivo_nc_nd || null,
      notes: values.notes || null,
      items: itemsPayload,
    };

    if (mode === "create") {
      const createPayload: PurchaseInvoiceCreateRawInput = createDraft
        ? {
            ...payload,
            account_id: suggestedAccount?.id ?? null,
            cost_center_id: createDraft.data.cost_center_id,
          }
        : payload;
      createMut.mutate(createPayload, {
        onSuccess: (data) => {
          toast.success(
            createDraft
              ? "Factura cargada con el archivo adjunto."
              : "Factura cargada.",
          );
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
        {createDraft && <DraftNotice warnings={createDraft.data.warnings} />}
        <FormField
          control={form.control}
          name="supplier"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Proveedor{aiMark("supplier")}</FormLabel>
              <FormControl>
                <SupplierPicker
                  value={field.value}
                  onChange={field.onChange}
                  suggestedNew={createDraft?.data.unmatchedSupplier ?? null}
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
                  <Select value={field.value} onValueChange={field.onChange}>
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
                <FormLabel>Tipo{aiMark("kind")}</FormLabel>
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

        {isInternalChannel && (
          <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <strong className="font-medium text-foreground">
              Gasto interno.
            </strong>{" "}
            Sin letra fiscal ni CAE. Número auto-asignado por proveedor. Pagable
            con OP interna; no va al libro IVA Compras.
          </div>
        )}

        <div
          className={`grid gap-4 ${isInternalChannel ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
        >
          {!isInternalChannel && (
            <FormField
              control={form.control}
              name="letter"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Letra{aiMark("letter")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value || "__none"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none" ? "" : v)
                      }
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
          )}
          <FormField
            control={form.control}
            name="punto_venta"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Punto de venta{aiMark("punto_venta")}</FormLabel>
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
                <FormLabel>Número{aiMark("numero")}</FormLabel>
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

        {duplicate && (
          <p className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Ya cargaste{" "}
              <Link
                href={`${PURCHASE_INVOICES_PATH}/${duplicate.id}`}
                className="font-mono underline underline-offset-2"
              >
                {formatInvoiceNumber(duplicate)}
              </Link>{" "}
              de este proveedor
              {duplicate.status === "cancelled" ? " (anulada)" : ""}. Revisá que
              no sea la misma factura.
            </span>
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="fecha"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Fecha{aiMark("fecha")}</FormLabel>
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
                <FormLabel>
                  Vencimiento de pago{aiMark("fch_vto_pago")}
                </FormLabel>
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

        <div className="space-y-3 rounded-md border bg-muted/10 p-4">
          <FormField
            control={form.control}
            name="with_items"
            render={({ field }) => (
              <FormItem className="flex items-start gap-3 space-y-0">
                <FormControl>
                  <input
                    type="checkbox"
                    checked={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.checked);
                      if (
                        e.target.checked &&
                        form.getValues("items").length === 0
                      ) {
                        form.setValue("items", [emptyItem()]);
                      }
                    }}
                    className="mt-1 size-4 accent-foreground"
                  />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="cursor-pointer">
                    Cargar con detalle por ítem{aiMark("items")}
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    Discrimina IVA por alícuota (necesario para libro IVA
                    Compras). Si lo dejás apagado, cargás solo los totales del
                    header.
                  </p>
                </div>
              </FormItem>
            )}
          />
          {watchedWithItems && (
            <FormField
              control={form.control}
              name="items"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <PurchaseInvoiceItemsEditor
                      items={field.value}
                      onChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <FormField
            control={form.control}
            name="imp_neto"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Neto{aiMark("imp_neto")}
                  {watchedWithItems && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (auto)
                    </span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    readOnly={watchedWithItems}
                    className={watchedWithItems ? "bg-muted/40" : undefined}
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
                <FormLabel>
                  IVA{aiMark("imp_iva")}
                  {watchedWithItems && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (auto)
                    </span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    readOnly={watchedWithItems}
                    className={watchedWithItems ? "bg-muted/40" : undefined}
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
                <FormLabel>Otros tributos{aiMark("imp_trib")}</FormLabel>
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
                <FormLabel>
                  Total{aiMark("imp_total")}
                  {watchedWithItems && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      (auto)
                    </span>
                  )}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    readOnly={watchedWithItems}
                    className={
                      watchedWithItems
                        ? "bg-muted/40 font-semibold"
                        : "font-semibold"
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {gap !== null && (
          <div className="space-y-2 rounded-md border border-dashed px-3 py-2 text-xs">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {watchedWithItems
                  ? "Los ítems más otros tributos no dan el total del comprobante"
                  : "Neto + IVA + otros tributos no da el total"}{" "}
                (diferencia{" "}
                <span className="font-mono">
                  {gap.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </span>
                ). Revisá los importes contra el comprobante.
              </span>
            </p>
            <label className="flex items-center gap-2 text-muted-foreground">
              <input
                type="checkbox"
                checked={acceptTotalsGap}
                onChange={(e) => setAcceptTotalsGap(e.target.checked)}
                className="size-3.5 accent-foreground"
              />
              Los importes son correctos, guardar igual
            </label>
          </div>
        )}

        {suggestedAccount && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs">
            <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="text-muted-foreground">
                Cuenta de gasto sugerida por IA:{" "}
              </span>
              {suggestedAccount.label}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label="Quitar cuenta sugerida"
              onClick={() => setSuggestedAccount(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="moneda"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Moneda{aiMark("moneda")}</FormLabel>
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
                  <FormLabel>Cotización{aiMark("cotizacion")}</FormLabel>
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

        {!isInternalChannel && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="cae_proveedor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    CAE proveedor (opcional){aiMark("cae_proveedor")}
                  </FormLabel>
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
                  <FormLabel>
                    Vto. CAE proveedor{aiMark("cae_vto_proveedor")}
                  </FormLabel>
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
        )}

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
                      channelId={watchedChannelId || null}
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
            disabled={isSaving || (mode === "edit" && !form.formState.isDirty)}
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

function DraftNotice({ warnings }: { warnings: string[] }) {
  return (
    <div className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs">
      <p className="flex items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
        Revisá los datos leídos del archivo antes de guardar. Los marcados con
        el ícono los completó la IA.
      </p>
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
