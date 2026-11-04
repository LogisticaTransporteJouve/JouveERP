"use client";

import { AlertTriangle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  useDefaultChannel,
  usePageIsFiscal,
  useScope,
  useSideChannels,
} from "@/components/providers/scope-provider";
import { DialogFormFooter } from "@/components/dialog-form-footer";
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
import { MoneyInput } from "@/components/money-input";
import { parseUsdRate } from "@/components/usd-rate-field";
import {
  amountToInput,
  COTIZACION_DECIMALS,
  parseArAmount,
} from "@/lib/format";
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
import { channelIsFiscal } from "@/lib/scope";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";
import { useSupplierByIdOptional } from "@/features/suppliers/hooks/use-suppliers";
import { CostTagSelect } from "@/features/cost-centers/components/cost-tag-select";
import { useCostTagOptions } from "@/features/cost-centers/hooks/use-cost-centers";
import { EmployeeChargeSelect } from "@/features/hr/components/employee-charge-select";

import {
  usePurchaseInvoiceByIdOptional,
  usePurchaseInvoiceItems,
  useCreatePurchaseInvoice,
  useNextInternalPurchaseNumero,
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
  amountOf,
  amountsDiffer,
  followHeaderTotal,
  partsGapFix,
} from "../lib/header-total";
import {
  type CostDefault,
  supplierCostDefaultsForKind,
  supplierCostWrites,
} from "../lib/supplier-defaults";
import {
  PURCHASE_INVOICE_KINDS,
  PURCHASE_INVOICE_KIND_LABEL,
  PURCHASE_INVOICE_LETTERS,
  PURCHASE_INVOICES_PATH,
  PURCHASE_TOTAL_MISMATCH_MESSAGE,
  PURCHASE_TRIBUTE_FIELDS,
  formatInvoiceNumber,
  type PurchaseAmountBreakdown,
  type PurchaseInvoice,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceLetter,
} from "../schema";
import { AiFilledMark } from "./ai-filled-mark";
import {
  TributesSplitFields,
  tributesRemaining,
  tributesRemainingMessage,
} from "./tributes-split-fields";
import {
  PurchaseInvoicePicker,
  type PickedPurchaseInvoice,
} from "./purchase-invoice-picker";
import { ArcaLinesNote } from "./arca-lines-note";
import {
  PurchaseInvoiceItemsEditor,
  computeTotals,
  emptyItem,
  itemsToSave,
  storedItemToDraft,
  type PurchaseInvoiceItemDraft,
} from "./purchase-invoice-items-editor";

type Mode = "create" | "edit";

export type PurchaseInvoiceFormValues = FormValues;

type FormValues = {
  supplier: PickedSupplier | null;
  channel_id: string;
  /** Expense account and cost center ids; "" for none. */
  account_id: string;
  cost_center_id: string;
  /** "A cargo de empleado": employee id or "". */
  charged_employee_id: string;
  kind: PurchaseInvoiceKind;
  letter: PurchaseInvoiceLetter | "";
  punto_venta: string;
  numero: string;
  fecha: string;
  fch_vto_pago: string;
  imp_neto: string;
  imp_iva: string;
  imp_trib: string;
  imp_no_gravado: string;
  imp_op_exentas: string;
  imp_perc_iva: string;
  imp_perc_nacionales: string;
  imp_perc_iibb: string;
  imp_perc_municipales: string;
  imp_impuestos_internos: string;
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

type BreakdownValues = Pick<
  FormValues,
  | "imp_no_gravado"
  | "imp_op_exentas"
  | "imp_perc_iva"
  | "imp_perc_nacionales"
  | "imp_perc_iibb"
  | "imp_perc_municipales"
  | "imp_impuestos_internos"
>;

function breakdownValues(b: PurchaseAmountBreakdown): BreakdownValues {
  return {
    imp_no_gravado: amountToInput(b.imp_no_gravado),
    imp_op_exentas: amountToInput(b.imp_op_exentas),
    imp_perc_iva: amountToInput(b.imp_perc_iva),
    imp_perc_nacionales: amountToInput(b.imp_perc_nacionales),
    imp_perc_iibb: amountToInput(b.imp_perc_iibb),
    imp_perc_municipales: amountToInput(b.imp_perc_municipales),
    imp_impuestos_internos: amountToInput(b.imp_impuestos_internos),
  };
}

/** A listed row has no breakdown: until the detail loads, its tributes show as
 *  IIBB (what a purchase without a split means) and are not sent. */
function breakdownToValues(inv: PurchaseInvoice | undefined): BreakdownValues {
  if (inv?.amount_breakdown) return breakdownValues(inv.amount_breakdown);
  return {
    imp_no_gravado: "0",
    imp_op_exentas: "0",
    imp_perc_iva: "0",
    imp_perc_nacionales: "0",
    imp_perc_iibb: inv ? amountToInput(inv.imp_trib) : "0",
    imp_perc_municipales: "0",
    imp_impuestos_internos: "0",
  };
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
          // iva_condition isn't included in the listing, but the picker uses it
          // only for the chip. Safe default; an internal supplier has none.
          iva_condition: inv.supplier_cuit ? "responsable_inscripto" : null,
          // Only a fiscal supplier carries a CUIT (clients_side_identity).
          is_fiscal: inv.supplier_cuit !== null,
        }
      : null,
    channel_id: inv?.channel_id ?? initialChannelId,
    account_id: inv?.account_id ?? "",
    cost_center_id: inv?.cost_center_id ?? "",
    charged_employee_id: inv?.charged_employee_id ?? "",
    kind: inv?.kind ?? "factura",
    letter: inv?.letter ?? "",
    punto_venta: inv ? String(inv.punto_venta) : "",
    numero: inv ? String(inv.numero) : "",
    fecha: inv?.fecha ?? todayIsoLocal(),
    fch_vto_pago: inv?.fch_vto_pago ?? "",
    imp_neto: inv ? amountToInput(inv.imp_neto) : "0",
    imp_iva: inv ? amountToInput(inv.imp_iva) : "0",
    imp_trib: inv ? amountToInput(inv.imp_trib) : "0",
    ...breakdownToValues(inv),
    imp_total: inv ? amountToInput(inv.imp_total) : "",
    moneda: inv?.moneda ?? "PES",
    cotizacion: inv
      ? amountToInput(Number(inv.cotizacion), COTIZACION_DECIMALS)
      : "1",
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
      account_id: draft.data.account?.id ?? "",
      cost_center_id: draft.data.cost_center_id ?? "",
      // A draft comes from a scanned fiscal invoice: its supplier is fiscal.
      supplier: patch.supplier
        ? { ...patch.supplier, is_fiscal: true }
        : (initialSupplier ?? null),
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
  // Edit keeps the invoice's own channel among the options even if it was retired.
  const pageIsFiscal = usePageIsFiscal();
  const channelOptions = useSideChannels(
    channels.filter((c) => c.is_active || c.id === invoice?.channel_id),
  );
  const scopeDefaultChannel = useDefaultChannel();
  const defaultChannelId = invoice?.channel_id ?? scopeDefaultChannel ?? "";

  const createDraft = mode === "create" ? (draft ?? null) : null;
  // An ARCA voucher: identity and amounts come from ARCA and stay as they are.
  const arcaLocked = createDraft?.origin === "arca";
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
    if (arcaLocked) return null;
    if (!initial.filled.has(field) || dirtyFields[field]) return null;
    // With items, these are recomputed from the lines, not the document's.
    if (watchedWithItems && ITEM_DERIVED_FIELDS.includes(field)) return null;
    return <AiFilledMark />;
  }

  const [acceptTotalsGap, setAcceptTotalsGap] = useState(false);

  const watchedKind = useWatch({ control: form.control, name: "kind" });
  const watchedMoneda = useWatch({ control: form.control, name: "moneda" });
  const watchedNeto = useWatch({ control: form.control, name: "imp_neto" });
  const watchedIva = useWatch({ control: form.control, name: "imp_iva" });
  const watchedTrib = useWatch({ control: form.control, name: "imp_trib" });
  const watchedNoGravado = useWatch({
    control: form.control,
    name: "imp_no_gravado",
  });
  const watchedExentas = useWatch({
    control: form.control,
    name: "imp_op_exentas",
  });
  const watchedLetter = useWatch({ control: form.control, name: "letter" });
  const watchedSupplierId =
    useWatch({ control: form.control, name: "supplier" })?.id ?? null;
  const watchedOriginId =
    useWatch({ control: form.control, name: "origin_invoice" })?.id ?? null;
  const watchedWithItems = useWatch({
    control: form.control,
    name: "with_items",
  });
  const watchedItems = useWatch({ control: form.control, name: "items" });

  const itemsQuery = usePurchaseInvoiceItems(invoice?.id ?? null);
  const itemsData = itemsQuery.data ?? null;
  // Edit: until the stored items are read, "con detalle" cannot be toggled
  // and the save leaves the items alone.
  const itemsUnknown = mode === "edit" && !!invoice && itemsData === null;

  // In edit mode, if the invoice already has items in the DB → enable "with detail"
  // mode and populate the editor. Only once per load (don't re-apply after the first
  // hydration so we don't overwrite the user's edits).
  useEffect(() => {
    if (!itemsData || itemsData.length === 0) return;
    if (form.getValues("with_items")) return;
    form.setValue("items", itemsData.map(storedItemToDraft), {
      shouldDirty: false,
    });
    form.setValue("with_items", true, { shouldDirty: false });
  }, [itemsData, form]);

  // Derived totals: if there are items, recompute neto/iva/total from the editor;
  // otherwise, sum neto + iva + trib into imp_total. Centralized in a useMemo
  // to avoid re-fires on every keystroke across each separate effect.
  const derivedTotals = useMemo(() => {
    // Exento and no gravado sit in the header next to otros tributos.
    const outside =
      amountOf(watchedTrib) +
      amountOf(watchedNoGravado) +
      amountOf(watchedExentas);
    if (watchedWithItems) {
      const t = computeTotals(watchedItems);
      return {
        mode: "items" as const,
        imp_neto: t.imp_neto,
        imp_iva: t.imp_iva,
        imp_total: +(t.imp_total_lines + outside).toFixed(2),
      };
    }
    const neto = amountOf(watchedNeto);
    const iva = amountOf(watchedIva);
    return {
      mode: "header" as const,
      imp_total: +(neto + iva + outside).toFixed(2),
    };
  }, [
    watchedWithItems,
    watchedItems,
    watchedNeto,
    watchedIva,
    watchedTrib,
    watchedNoGravado,
    watchedExentas,
  ]);

  const prevHeaderTotalRef = useRef<number | null>(null);
  useEffect(() => {
    if (!derivedTotals) return;
    if (derivedTotals.mode === "items") {
      form.setValue("imp_neto", amountToInput(derivedTotals.imp_neto), {
        shouldDirty: false,
      });
      form.setValue("imp_iva", amountToInput(derivedTotals.imp_iva), {
        shouldDirty: false,
      });
      form.setValue("imp_total", amountToInput(derivedTotals.imp_total), {
        shouldDirty: false,
      });
      return;
    }
    const previous = prevHeaderTotalRef.current;
    prevHeaderTotalRef.current = derivedTotals.imp_total;
    const next = followHeaderTotal(
      amountOf(form.getValues("imp_total")),
      previous,
      derivedTotals.imp_total,
    );
    if (next !== null) {
      form.setValue("imp_total", amountToInput(next), { shouldDirty: false });
    }
  }, [derivedTotals, form]);

  // A listed row does not carry "a cargo de empleado": read it from the
  // detail, and send it only once known and changed.
  const chargeFromRow = invoice?.charged_employee_id !== undefined;
  // Same for the amount breakdown: only the detail carries it.
  const breakdownFromRow = invoice?.amount_breakdown !== undefined;
  const detailQuery = usePurchaseInvoiceByIdOptional(
    mode === "edit" && invoice && !(chargeFromRow && breakdownFromRow)
      ? invoice.id
      : null,
  );
  const detailCharge = detailQuery.data?.charged_employee_id;
  const chargeKnown =
    mode === "create" || chargeFromRow || detailCharge !== undefined;
  useEffect(() => {
    if (detailCharge === undefined) return;
    form.resetField("charged_employee_id", {
      defaultValue: detailCharge ?? "",
    });
  }, [detailCharge, form]);
  const detailBreakdown = detailQuery.data?.amount_breakdown;
  const breakdownKnown =
    mode === "create" || breakdownFromRow || detailBreakdown !== undefined;
  useEffect(() => {
    if (detailBreakdown === undefined) return;
    for (const [name, value] of Object.entries(
      breakdownValues(detailBreakdown),
    ) as [keyof BreakdownValues, string][]) {
      form.resetField(name, { defaultValue: value });
    }
  }, [detailBreakdown, form]);

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
  // Which accounts and centers are still offered (active), for the defaults.
  const costTagOptions = useCostTagOptions().data;
  // The account and center the last supplier's defaults wrote, so switching
  // supplier does not leave them on the new one's purchase.
  const appliedCostDefaults = useRef<CostDefault[]>([]);

  // Expense account and cost center: the supplier's, over the AI's
  // suggestion, unless the user already picked one, and only while still
  // active (a retired FLOTA_DZ is not copied). Switching the type to NC/ND
  // clears what the supplier wrote, so the origin's is inherited.
  useEffect(() => {
    if (mode !== "create" || !supplierDetail) return;
    const next = supplierCostDefaultsForKind(
      watchedKind,
      supplierDetail,
      costTagOptions,
    );
    for (const { name, id } of supplierCostWrites(
      appliedCostDefaults.current,
      next,
      (name) => ({
        value: form.getValues(name),
        dirty: form.getFieldState(name).isDirty,
      }),
    )) {
      form.setValue(name, id, { shouldDirty: false });
    }
    appliedCostDefaults.current = next;
  }, [mode, supplierDetail, costTagOptions, watchedKind, form]);

  useEffect(() => {
    if (mode !== "create" || !supplierDetail) return;
    // Channel: pre-fill only if the form still has the default-from-scope channel
    // and the supplier has one saved. An ARCA voucher is fiscal whatever the
    // supplier's usual channel.
    if (
      !arcaLocked &&
      supplierDetail.default_channel_id &&
      channels.some(
        (c) => c.id === supplierDetail.default_channel_id && c.is_active,
      ) &&
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
    // An ARCA voucher starts due on its date: the supplier's term replaces
    // that until the user picks another.
    const startsAtFecha =
      arcaLocked &&
      fchVtoPago === fecha &&
      !form.getFieldState("fch_vto_pago").isDirty;
    if (
      (!fchVtoPago || startsAtFecha) &&
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
  }, [mode, supplierDetail, defaultChannelId, channels, form, arcaLocked]);

  const watchedChannelId = useWatch({
    control: form.control,
    name: "channel_id",
  });
  const watchedChannelIsFiscal =
    channelIsFiscal(watchedChannelId, channels) ?? true;
  const isInternalChannel = !watchedChannelIsFiscal;
  const showsExempt = watchedChannelIsFiscal && watchedLetter === "A";

  // Off a fiscal A, exento and no gravado move into the net, also when the
  // detail loads them after the switch, so the total keeps matching the parts
  // sent. IVA stays for the user to clear (NON_COMPUTABLE_DENIED). With items
  // the net comes from the lines and the total is recomputed without them.
  useEffect(() => {
    if (showsExempt) return;
    const hidden =
      amountOf(form.getValues("imp_no_gravado")) +
      amountOf(form.getValues("imp_op_exentas"));
    if (hidden === 0) return;
    form.setValue("imp_no_gravado", "0");
    form.setValue("imp_op_exentas", "0");
    if (!form.getValues("with_items")) {
      const neto = amountOf(form.getValues("imp_neto"));
      form.setValue("imp_neto", amountToInput(neto + hidden));
    }
  }, [showsExempt, watchedNoGravado, watchedExentas, form]);

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

  const debouncedPv = useDebouncedValue(
    useWatch({ control: form.control, name: "punto_venta" }),
    300,
  );
  const debouncedNumero = useDebouncedValue(
    useWatch({ control: form.control, name: "numero" }),
    300,
  );

  // Internal purchases number themselves: once the supplier is picked, the
  // next número of its (kind, PV) series fills an empty numero field.
  const nextNumeroPv = Number(debouncedPv);
  const nextNumero = useNextInternalPurchaseNumero(
    mode === "create" &&
      isInternalChannel &&
      watchedSupplierId &&
      watchedChannelId
      ? {
          channelId: watchedChannelId,
          supplierId: watchedSupplierId,
          kind: watchedKind,
          puntoVenta:
            Number.isInteger(nextNumeroPv) && nextNumeroPv >= 1
              ? nextNumeroPv
              : 1,
        }
      : null,
  );
  useEffect(() => {
    if (nextNumero.data == null) return;
    if (form.getValues("numero")) return; // already typed something
    form.setValue("numero", String(nextNumero.data), { shouldDirty: false });
    if (!form.getValues("punto_venta")) {
      form.setValue("punto_venta", "1", { shouldDirty: false });
    }
  }, [nextNumero.data, form]);
  useEffect(() => {
    if (nextNumero.error) {
      toast.error(`No se pudo sugerir el número: ${nextNumero.error.message}`);
    }
  }, [nextNumero.error]);
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

  // Header mode: the total must equal its parts (the journal credits the
  // supplier the parts, the statement the total), so a gap blocks the save
  // and can be moved into no gravado or the net. An edit that leaves the
  // amounts of an older purchase as they are still saves. With items the total
  // is computed from the lines; a scanned document's printed total is only
  // compared, and the user may keep the lines.
  const watchedTotal = useWatch({ control: form.control, name: "imp_total" });
  const watchedAmounts = {
    imp_neto: watchedNeto,
    imp_iva: watchedIva,
    imp_trib: watchedTrib,
    imp_no_gravado: watchedNoGravado,
    imp_op_exentas: watchedExentas,
    imp_total: watchedTotal,
  };
  const amountsChanged =
    mode === "create" ||
    amountsDiffer(watchedAmounts, form.formState.defaultValues);
  const partsGap =
    watchedWithItems || !breakdownKnown ? null : totalsGap(watchedAmounts);
  const documentGap =
    createDraft && watchedWithItems
      ? documentTotalGap(createDraft.data.imp_total, amountOf(watchedTotal))
      : null;
  const gap = partsGap ?? documentGap;
  // ARCA's amounts are locked (its export already ties them to the total).
  const gapFix = arcaLocked
    ? null
    : partsGapFix(partsGap, showsExempt, watchedAmounts);

  function onSubmit(values: FormValues) {
    if (!values.supplier) {
      toast.error("Seleccioná un proveedor.");
      return;
    }
    if (partsGap !== null && amountsChanged) {
      toast.error(PURCHASE_TOTAL_MISMATCH_MESSAGE);
      return;
    }
    // Unread items are not sent: new header amounts would not match them.
    if (itemsUnknown && amountsChanged) {
      toast.error(
        "Los ítems de la factura todavía no se leyeron: para cambiar importes, esperá a que carguen o reintentá la lectura.",
      );
      return;
    }
    if (documentGap !== null && !acceptTotalsGap) {
      toast.error(
        "Los ítems no dan el total del comprobante: revisalos o confirmá que son correctos.",
      );
      return;
    }
    if (values.moneda !== "PES" && !(parseUsdRate(values.cotizacion) > 1)) {
      form.setError("cotizacion", {
        message: "Cargá la cotización del dólar (tiene que ser mayor a 1).",
      });
      return;
    }
    if (!values.channel_id) {
      toast.error("Seleccioná un canal.");
      return;
    }

    const itemsPayload = itemsToSave(
      values,
      mode === "edit" ? (itemsData?.length ?? null) : 0,
    );

    // If the channel is internal, we force letter/CAE to null even if the form
    // was left with values (e.g. you changed channel after typing).
    const channelFiscal = channelIsFiscal(values.channel_id, channels);
    if (channelFiscal === null) {
      toast.error("El canal elegido no existe. Elegí otro canal.");
      return;
    }
    const isInternal = !channelFiscal;
    const letter = isInternal || values.letter === "" ? null : values.letter;
    // Same rule as the DB guard: a fiscal purchase needs its letter when it is
    // created or its letter/channel change; an old one without letter can
    // still be corrected.
    const letterRequired =
      !isInternal &&
      (mode === "create" ||
        letter !== (invoice?.letter ?? null) ||
        values.channel_id !== invoice?.channel_id);
    if (letterRequired && letter === null) {
      form.setError("letter", {
        message: "Una factura de compra fiscal lleva letra.",
      });
      return;
    }

    // The tributes are split on a fiscal purchase and are IIBB on an internal one.
    const trib = amountOf(values.imp_trib);
    const parts =
      isInternal || trib === 0
        ? {
            imp_perc_iva: 0,
            imp_perc_nacionales: 0,
            imp_perc_iibb: trib,
            imp_perc_municipales: 0,
            imp_impuestos_internos: 0,
          }
        : {
            imp_perc_iva: amountOf(values.imp_perc_iva),
            imp_perc_nacionales: amountOf(values.imp_perc_nacionales),
            imp_perc_iibb: amountOf(values.imp_perc_iibb),
            imp_perc_municipales: amountOf(values.imp_perc_municipales),
            imp_impuestos_internos: amountOf(values.imp_impuestos_internos),
          };
    if (!isInternal && trib !== 0 && breakdownKnown) {
      const message = tributesRemainingMessage(
        tributesRemaining(
          trib,
          PURCHASE_TRIBUTE_FIELDS.map((name) => values[name]),
        ),
      );
      if (message) {
        form.setError("imp_perc_iibb", { message });
        return;
      }
    }
    const breakdown = breakdownKnown
      ? {
          imp_no_gravado: showsExempt ? amountOf(values.imp_no_gravado) : 0,
          imp_op_exentas: showsExempt ? amountOf(values.imp_op_exentas) : 0,
          ...parts,
        }
      : {};

    const payload: PurchaseInvoiceCreateRawInput = {
      supplier_id: values.supplier.id,
      channel_id: values.channel_id,
      account_id: values.account_id || null,
      cost_center_id: values.cost_center_id || null,
      ...(chargeKnown && form.formState.dirtyFields.charged_employee_id
        ? { charged_employee_id: values.charged_employee_id || null }
        : {}),
      kind: values.kind,
      letter,
      punto_venta: Number(values.punto_venta),
      numero: Number(values.numero),
      fecha: values.fecha,
      fch_vto_pago: values.fch_vto_pago || null,
      imp_neto: amountOf(values.imp_neto),
      imp_iva: amountOf(values.imp_iva),
      imp_trib: trib,
      ...breakdown,
      imp_total: amountOf(values.imp_total),
      moneda: values.moneda,
      cotizacion: parseArAmount(values.cotizacion) ?? 1,
      cae_proveedor: isInternal ? null : values.cae_proveedor || null,
      cae_vto_proveedor: isInternal ? null : values.cae_vto_proveedor || null,
      invoice_origin_id:
        values.kind === "factura" ? null : (values.origin_invoice?.id ?? null),
      motivo_nc_nd: values.motivo_nc_nd || null,
      notes: values.notes || null,
      items: itemsPayload,
    };

    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: (data) => {
          toast.success(
            arcaLocked
              ? data.linkedExisting
                ? "Ya estaba cargado: quedó vinculado."
                : "Comprobante de ARCA cargado."
              : createDraft?.source
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
        {createDraft && (
          <DraftNotice
            warnings={createDraft.data.warnings}
            fromArca={arcaLocked}
          />
        )}
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
                  isFiscal={pageIsFiscal ?? true}
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
                      {channelOptions.map((c) => (
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
                  <Select
                    disabled={arcaLocked}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
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
                      disabled={arcaLocked}
                      value={field.value || "__none"}
                      onValueChange={(v) =>
                        field.onChange(v === "__none" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Fiscal purchases need a letter; only an old one
                            saved without it can stay that way. */}
                        {mode === "edit" && !invoice?.letter && (
                          <SelectItem value="__none">— Sin letra</SelectItem>
                        )}
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
                    disabled={arcaLocked}
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
                    disabled={arcaLocked}
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
                  <DatePicker
                    disabled={arcaLocked}
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

        {arcaLocked ? (
          <ArcaLinesNote lines={createDraft?.data.arca_lines ?? []} />
        ) : (
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
                      disabled={itemsUnknown}
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
                    {itemsUnknown &&
                      (itemsQuery.isError ? (
                        <p className="text-xs text-muted-foreground">
                          No se pudieron leer los ítems: al guardar quedan como
                          están.{" "}
                          <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => void itemsQuery.refetch()}
                          >
                            Reintentar
                          </Button>
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Leyendo los ítems…
                        </p>
                      ))}
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
        )}

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
                  <MoneyInput
                    {...field}
                    disabled={arcaLocked || !breakdownKnown}
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
                  <MoneyInput
                    {...field}
                    disabled={arcaLocked || !breakdownKnown}
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
                  <MoneyInput
                    {...field}
                    disabled={arcaLocked || !breakdownKnown}
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
                  <MoneyInput
                    {...field}
                    disabled={arcaLocked || !breakdownKnown}
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

        {!breakdownKnown && (
          <p className="text-xs text-muted-foreground">
            {detailQuery.isError
              ? `No se pudo leer el desglose de la factura: los importes${chargeKnown ? "" : " y «A cargo de empleado»"} no se pueden editar. Cerrá y volvé a abrirla para reintentar.`
              : "Cargando el desglose de la factura…"}
          </p>
        )}

        {showsExempt && (
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField
              control={form.control}
              name="imp_no_gravado"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>No gravado</FormLabel>
                  <FormControl>
                    <MoneyInput
                      {...field}
                      disabled={arcaLocked || !breakdownKnown}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="imp_op_exentas"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Exento</FormLabel>
                  <FormControl>
                    <MoneyInput
                      {...field}
                      disabled={arcaLocked || !breakdownKnown}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}
        {watchedChannelIsFiscal && amountOf(watchedTrib) > 0 && (
          <TributesSplitFields
            control={form.control}
            total={amountOf(watchedTrib)}
            disabled={!breakdownKnown}
          />
        )}

        {gap !== null && (
          <div className="space-y-2 rounded-md border border-dashed px-3 py-2 text-xs">
            <p className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {partsGap !== null
                  ? "Neto + IVA + otros tributos + no gravado + exento no da el total"
                  : "Los ítems más otros tributos no dan el total del comprobante"}{" "}
                (diferencia{" "}
                <span className="font-mono">
                  {gap.toLocaleString("es-AR", { minimumFractionDigits: 2 })}
                </span>
                ).{" "}
                {partsGap === null
                  ? "Revisá los ítems contra el comprobante."
                  : amountsChanged
                    ? "Corregí los importes para guardar."
                    : "Para cambiar un importe, primero corregí la diferencia."}
              </span>
            </p>
            {gapFix ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  form.setValue(gapFix.field, gapFix.value, {
                    shouldDirty: true,
                  })
                }
              >
                {gapFix.field === "imp_no_gravado"
                  ? "Pasar la diferencia a No gravado"
                  : "Sumar la diferencia al neto"}
              </Button>
            ) : null}
            {partsGap === null ? (
              <label className="flex items-center gap-2 text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acceptTotalsGap}
                  onChange={(e) => setAcceptTotalsGap(e.target.checked)}
                  className="size-3.5 accent-foreground"
                />
                Los ítems son correctos, guardar igual
              </label>
            ) : null}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="account_id"
            render={({ field, fieldState }) => (
              <FormItem>
                <FormLabel>
                  Cuenta de gasto
                  {createDraft?.data.account &&
                    field.value === createDraft.data.account.id &&
                    !fieldState.isDirty && <AiFilledMark />}
                </FormLabel>
                <FormControl>
                  <CostTagSelect
                    kind="expenseAccount"
                    value={field.value}
                    onChange={field.onChange}
                    noneLabel={
                      isNcOrNd
                        ? "La del comprobante de origen"
                        : "Sin cuenta (Compras)"
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="cost_center_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Centro de costo</FormLabel>
                <FormControl>
                  <CostTagSelect
                    kind="costCenter"
                    value={field.value}
                    onChange={field.onChange}
                    noneLabel={
                      isNcOrNd ? "El del comprobante de origen" : undefined
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {watchedKind !== "nc" && chargeKnown && (
          <FormField
            control={form.control}
            name="charged_employee_id"
            render={({ field }) => (
              <EmployeeChargeSelect
                id="purchase-charged-employee"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="moneda"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Moneda{aiMark("moneda")}</FormLabel>
                <FormControl>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={arcaLocked}
                  >
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
                    <MoneyInput {...field} decimals={COTIZACION_DECIMALS} />
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
                      disabled={
                        arcaLocked && createDraft?.data.cae_proveedor != null
                      }
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

        <DialogFormFooter
          mode={mode}
          isSaving={isSaving}
          isDirty={form.formState.isDirty}
          createLabel="Cargar factura"
          onCancel={() => (onCancel ? onCancel() : router.push("/purchases"))}
        />
      </form>
    </Form>
  );
}

function DraftNotice({
  warnings,
  fromArca,
}: {
  warnings: string[];
  fromArca: boolean;
}) {
  if (fromArca && warnings.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border bg-muted/20 px-3 py-2 text-xs">
      {!fromArca && (
        <p className="flex items-center gap-2">
          <Sparkles className="size-3.5 shrink-0 text-muted-foreground" />
          Revisá los datos leídos del archivo antes de guardar. Los marcados con
          el ícono los completó la IA.
        </p>
      )}
      {warnings.map((w) => (
        <p key={w} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {w}
        </p>
      ))}
    </div>
  );
}
