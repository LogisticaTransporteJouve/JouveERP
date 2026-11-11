import { z } from "zod";

import { listCostTagOptionsAction } from "@/features/cost-centers/actions/cost-tag-options-actions";
import { isoDate } from "@/features/exchange-rates/schema";
import { getReceivedVoucherAction } from "@/features/purchase-invoices/actions/arca-received-actions";
import {
  findPurchaseInvoiceDuplicateAction,
  getPurchaseInvoiceByIdAction,
  searchPurchaseInvoicesAction,
} from "@/features/purchase-invoices/actions/purchase-invoices-actions";
import {
  arcaGapTargetLabel,
  arcaVoucherToDraft,
} from "@/features/purchase-invoices/lib/arca-received-draft";
import {
  arcaDraftAmounts,
  arcaReceivedInvoice,
  fullTributeSplit,
  supplierDueDate,
  tributeSplitTotal,
  type TributeSplit,
} from "@/features/purchase-invoices/lib/arca-received-invoice";
import { supplierCostDefaults } from "@/features/purchase-invoices/lib/supplier-defaults";
import {
  ARCA_GAP_TARGETS,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_INVOICE_LETTERS,
  PURCHASE_TRIBUTE_FIELDS,
  PURCHASE_TRIBUTE_LABEL,
  formatInvoiceNumber,
  type PurchaseInvoiceKind,
} from "@/features/purchase-invoices/schema";
import { getSupplierByIdAction } from "@/features/suppliers/actions/suppliers-actions";
import type { Supplier } from "@/features/suppliers/schema";
import { ivaIsComputable } from "@/lib/afip/codes";
import { userCan } from "@/lib/auth/permissions";
import {
  readInvoicingChannels,
  type InvoicingChannelRow,
} from "@/lib/channels";
import {
  acceptReceivedVoucher,
  arcaGapChoiceMessage,
} from "@/lib/commands/accept-received-voucher";
import {
  NON_COMPUTABLE_DENIED,
  createPurchaseInvoice,
} from "@/lib/commands/create-purchase-invoice";
import { formatArgentineDate, formatMoney, round2 } from "@/lib/format";
import { isMainChannel } from "@/lib/scope";

import {
  PURCHASE_LABELS,
  arcaPurchaseProposalSpec,
  purchaseInvoiceProposalSpec,
  type ProposalLabels,
} from "../../lib/proposal-specs";
import type { AiActionContext } from "../define";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import { optionLabel, resolveOption } from "./expense-proposals";
import { MAX_CANDIDATES, norm } from "./resolve-client";
import { findSupplier } from "./resolve-supplier";

// Purchases the assistant proposes: a purchase invoice as the form loads it,
// and an ARCA received voucher as the tray accepts it. `prepare` resolves the
// supplier, channel, account and center with the features' read actions; the
// amounts are the user's (or ARCA's), never the model's; the write runs only
// on accept, through the same lib/commands function the form calls.

const EMPLOYEE_CHARGE_DENIED =
  "No tenés permiso para cargar una compra a un empleado.";

type Split = TributeSplit;

const amount = z.number().finite().min(0).max(999_999_999_999.99);

const tributesInput = z
  .object({
    imp_perc_iva: amount.optional().describe("Percepción de IVA."),
    imp_perc_nacionales: amount
      .optional()
      .describe("Percepción de Ganancias y otros nacionales."),
    imp_perc_iibb: amount.optional().describe("Percepción de IIBB."),
    imp_perc_municipales: amount.optional().describe("Tasas municipales."),
    imp_impuestos_internos: amount.optional().describe("Impuestos internos."),
  })
  .describe(
    "Otros tributos split by type, as the user said them. Their sum is the purchase's otros tributos.",
  );

const lookup = z.string().trim().min(1).max(120);

function stop(field: string, message: string): AiPrepareResult {
  return { kind: "issues", issues: [{ field, message }] };
}

type ChannelPick =
  | { kind: "ok"; channel: InvoicingChannelRow }
  | { kind: "stop"; result: AiPrepareResult };

/** The channel the user named (fiscal / interno, or its name), else the
 *  supplier's default, else the one active channel of the supplier's side. */
async function pickChannel(
  said: string | undefined,
  supplier: Supplier,
  onlyFiscal: boolean,
): Promise<ChannelPick> {
  const read = await readInvoicingChannels();
  if (!read.ok) {
    return {
      kind: "stop",
      result: { kind: "error", error: "No se pudieron leer los canales." },
    };
  }
  // The AI works on the main app: a segregated channel is never proposed.
  const active = read.channels.filter(
    (c) => c.is_active && isMainChannel(c) && (!onlyFiscal || c.is_fiscal),
  );
  const q = said ? norm(said) : null;
  const named = q
    ? active.filter((c) => norm(c.id) === q || norm(c.name) === q)
    : [];
  let pool: InvoicingChannelRow[];
  if (named.length > 0) {
    pool = named;
  } else if (q === "fiscal" || q === "interno") {
    pool = active.filter((c) => c.is_fiscal === (q === "fiscal"));
  } else {
    const usual = active.find((c) => c.id === supplier.default_channel_id);
    pool = usual
      ? [usual]
      : active.filter(
          (c) => c.is_fiscal === (onlyFiscal || supplier.is_fiscal),
        );
  }
  const [only] = pool;
  if (only && pool.length === 1) return { kind: "ok", channel: only };
  return {
    kind: "stop",
    result: {
      kind: "issues",
      issues: [
        {
          field: "channel",
          message:
            pool.length === 0
              ? "No hay un canal activo que corresponda: decime cuál."
              : "Hay más de un canal posible: decime cuál.",
        },
      ],
      candidates: [
        {
          field: "channel",
          options: (pool.length ? pool : active).map((c) => ({
            value: c.name,
            label: `${c.name}${c.is_fiscal ? " · fiscal" : " · interno"}`,
          })),
        },
      ],
    },
  };
}

type CostPick =
  | {
      kind: "ok";
      account_id: string | null;
      cost_center_id: string | null;
    }
  | { kind: "stop"; result: AiPrepareResult };

/** The account and center the user named, else the supplier's defaults on
 *  a factura (an NC/ND takes its origin's: the trigger copies them). */
async function pickCosts(
  input: { expense_account?: string; cost_center?: string },
  supplier: Supplier,
  kind: PurchaseInvoiceKind,
  labels: Record<string, string>,
): Promise<CostPick> {
  const usesDefaults =
    kind === "factura" &&
    (supplier.default_expense_account_id !== null ||
      supplier.default_cost_center_id !== null);
  if (
    input.expense_account === undefined &&
    input.cost_center === undefined &&
    !usesDefaults
  ) {
    return { kind: "ok", account_id: null, cost_center_id: null };
  }
  const res = await listCostTagOptionsAction();
  if (!res.ok) {
    // Only the user's own pick needs the options; without them, the form
    // offers no defaults either.
    if (input.expense_account !== undefined || input.cost_center !== undefined)
      return { kind: "stop", result: { kind: "error", error: res.error } };
    return { kind: "ok", account_id: null, cost_center_id: null };
  }
  const options = res.data;
  const defaults =
    kind === "factura" ? supplierCostDefaults(supplier, options) : [];
  let account_id = defaults.find((d) => d.name === "account_id")?.id ?? null;
  let cost_center_id =
    defaults.find((d) => d.name === "cost_center_id")?.id ?? null;
  if (input.expense_account !== undefined) {
    const r = resolveOption(
      "expense_account",
      input.expense_account,
      options.expenseAccounts,
    );
    if (r.kind === "issues") return { kind: "stop", result: r.result };
    account_id = r.id;
  }
  if (input.cost_center !== undefined) {
    const r = resolveOption(
      "cost_center",
      input.cost_center,
      options.costCenters,
    );
    if (r.kind === "issues") return { kind: "stop", result: r.result };
    cost_center_id = r.id;
  }
  for (const o of [...options.expenseAccounts, ...options.costCenters]) {
    if (o.id === account_id || o.id === cost_center_id) {
      labels[o.id] = optionLabel(o);
    }
  }
  return { kind: "ok", account_id, cost_center_id };
}

type OriginPick =
  { kind: "ok"; id: string | null } | { kind: "stop"; result: AiPrepareResult };

/** An NC/ND's origin factura: the one the user gave (same supplier, not
 *  cancelled), or a question with the supplier's latest facturas. */
async function pickOrigin(
  originId: string | undefined,
  supplier: Supplier,
  kind: PurchaseInvoiceKind,
  labels: Record<string, string>,
): Promise<OriginPick> {
  if (kind === "factura") return { kind: "ok", id: null };
  if (!originId) {
    const res = await searchPurchaseInvoicesAction({
      supplierId: supplier.id,
      kind: "factura",
      status: "received",
      limit: MAX_CANDIDATES,
    });
    return {
      kind: "stop",
      result: {
        kind: "issues",
        issues: [
          {
            field: "origin_invoice_id",
            message:
              "Falta la factura de origen de la nota de crédito o débito.",
          },
        ],
        candidates:
          res.ok && res.data.invoices.length
            ? [
                {
                  field: "origin_invoice_id",
                  options: res.data.invoices.map((i) => ({
                    value: i.id,
                    label: `${formatInvoiceNumber(i)} · ${formatArgentineDate(i.fecha)} · ${formatMoney(i.imp_total, i.moneda === "PES" ? "ARS" : "USD")}`,
                  })),
                },
              ]
            : undefined,
      },
    };
  }
  const res = await getPurchaseInvoiceByIdAction(originId);
  if (!res.ok)
    return { kind: "stop", result: { kind: "error", error: res.error } };
  const origin = res.data;
  if (
    !origin ||
    origin.supplier_id !== supplier.id ||
    origin.kind !== "factura" ||
    origin.status !== "received"
  ) {
    return {
      kind: "stop",
      result: stop(
        "origin_invoice_id",
        "La factura de origen tiene que ser una factura vigente del mismo proveedor.",
      ),
    };
  }
  labels[origin.id] =
    `${formatInvoiceNumber(origin)} del ${formatArgentineDate(origin.fecha)}`;
  return { kind: "ok", id: origin.id };
}

/** Labels shared by both proposals: the supplier, the channel and its side. */
function baseLabels(
  supplier: Supplier,
  channel: InvoicingChannelRow,
): Record<string, string> {
  return {
    [supplier.id]: supplier.cuit
      ? `${supplier.legal_name} (CUIT ${supplier.cuit})`
      : supplier.legal_name,
    [channel.id]: channel.name,
    ...(channel.is_fiscal ? {} : { [PURCHASE_LABELS.internal]: "1" }),
  };
}

function refuseEmployeeCharge(
  ctx: AiActionContext,
  chargedEmployeeId: string | null | undefined,
): string | null {
  return chargedEmployeeId && !userCan(ctx.access, "hr:write")
    ? EMPLOYEE_CHARGE_DENIED
    : null;
}

// ─── Factura de compra ───────────────────────────────────────────────────────

export const proposePurchaseInvoice = defineAiProposal({
  name: "proposePurchaseInvoice",
  domain: "compras",
  permission: [
    "purchase_invoices:write",
    "purchase_invoices:read",
    "suppliers:read",
  ],
  sources: [
    "purchase_invoices",
    "suppliers",
    "invoicing_channels",
    "expense_leaf_accounts",
    "cost_centers",
  ],
  description:
    "Propose loading a purchase invoice (factura, NC or ND de proveedor) the " +
    "user describes, for them to accept on a card, as Compras › Nueva factura " +
    "does. Pass the amounts exactly as the user (or the document) gave them, " +
    "never computed or guessed: neto, IVA, no gravado, exento, otros tributos " +
    "split by type, and the total; they must add up. channel 'fiscal' " +
    "(Compras, with letter and CAE) or 'interno' (Otras compras, remito " +
    "interno); omitted = the supplier's. Account and cost center by code or " +
    "name (default: the supplier's). An NC/ND needs its origin factura " +
    "(origin_invoice_id from getPurchaseInvoices) and a motivo. For an ARCA " +
    "voucher use proposeArcaPurchase. A purchase already loaded is refused. " +
    "Writes nothing by itself.",
  input: z.object({
    supplier: lookup.describe("Supplier name or CUIT, as the user said it."),
    kind: z
      .enum(PURCHASE_INVOICE_KINDS)
      .optional()
      .describe("Default factura."),
    channel: lookup.optional(),
    letter: z.enum(PURCHASE_INVOICE_LETTERS).optional(),
    punto_venta: z.number().int().min(1).max(99999).optional(),
    numero: z.number().int().min(1).optional(),
    fecha: isoDate,
    fch_vto_pago: isoDate.optional().describe("Default: the supplier's term."),
    imp_neto: amount,
    imp_iva: amount.optional(),
    imp_no_gravado: amount.optional(),
    imp_op_exentas: amount.optional(),
    tributes: tributesInput.optional(),
    imp_total: amount,
    currency: z.enum(["ARS", "USD"]).optional(),
    cotizacion: z
      .number()
      .positive()
      .optional()
      .describe(
        "ARS per USD, only for a purchase in dollars, as the user said it.",
      ),
    cae: z
      .string()
      .trim()
      .regex(/^\d{14}$/)
      .optional(),
    origin_invoice_id: z.string().uuid().optional(),
    motivo: z.string().trim().min(1).max(500).optional(),
    expense_account: lookup.optional(),
    cost_center: lookup.optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  spec: purchaseInvoiceProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await findSupplier(input.supplier, { onlyActive: true });
    if (found.kind === "stop") return found.result;
    const { supplier } = found;
    const picked = await pickChannel(input.channel, supplier, false);
    if (picked.kind === "stop") return picked.result;
    const { channel } = picked;
    const internal = !channel.is_fiscal;
    const kind = input.kind ?? "factura";
    const labels = baseLabels(supplier, channel);

    const letter = internal ? null : (input.letter ?? null);
    if (!internal && letter === null) {
      return {
        kind: "issues",
        issues: [
          {
            field: "letter",
            message: "Una factura de compra fiscal lleva letra.",
          },
        ],
        candidates: [
          {
            field: "letter",
            options: PURCHASE_INVOICE_LETTERS.map((l) => ({
              value: l,
              label: `Letra ${l}`,
            })),
          },
        ],
      };
    }
    const puntoVenta = input.punto_venta ?? (internal ? 1 : undefined);
    if (puntoVenta === undefined) {
      return stop("punto_venta", "Falta el punto de venta del comprobante.");
    }
    if (input.numero === undefined) {
      return stop(
        "numero",
        internal
          ? "Falta el número del remito interno (en Compras se propone el siguiente)."
          : "Falta el número del comprobante.",
      );
    }
    if (kind !== "factura" && !input.motivo) {
      return stop("motivo", "Falta el motivo de la nota de crédito o débito.");
    }
    const moneda = input.currency === "USD" ? "DOL" : "PES";
    if (
      moneda === "DOL" &&
      !(input.cotizacion !== undefined && input.cotizacion > 1)
    ) {
      return stop(
        "cotizacion",
        "Falta la cotización del dólar del comprobante (pesos por dólar).",
      );
    }

    const given = fullTributeSplit(input.tributes ?? {});
    const trib = tributeSplitTotal(given);
    // The tributes are split on a fiscal purchase and are IIBB on an
    // internal one (the form's rule).
    const split: Split = internal
      ? { ...fullTributeSplit({}), imp_perc_iibb: trib }
      : given;
    const imp_iva = input.imp_iva ?? 0;
    const imp_no_gravado = input.imp_no_gravado ?? 0;
    const imp_op_exentas = input.imp_op_exentas ?? 0;
    if (
      !internal &&
      !ivaIsComputable(letter) &&
      imp_iva + imp_no_gravado + imp_op_exentas > 0
    ) {
      return stop("imp_iva", NON_COMPUTABLE_DENIED);
    }

    const origin = await pickOrigin(
      input.origin_invoice_id,
      supplier,
      kind,
      labels,
    );
    if (origin.kind === "stop") return origin.result;
    const costs = await pickCosts(input, supplier, kind, labels);
    if (costs.kind === "stop") return costs.result;

    const duplicate = await findPurchaseInvoiceDuplicateAction({
      supplier_id: supplier.id,
      kind,
      punto_venta: puntoVenta,
      numero: input.numero,
    });
    if (!duplicate.ok) return { kind: "error", error: duplicate.error };
    if (duplicate.data) {
      return {
        kind: "error",
        error: `Ya está cargada: ${formatInvoiceNumber(duplicate.data)}${duplicate.data.status === "cancelled" ? " (anulada)" : ""}.`,
      };
    }

    return {
      kind: "draft",
      draft: {
        channel_id: channel.id,
        account_id: costs.account_id,
        cost_center_id: costs.cost_center_id,
        supplier_id: supplier.id,
        kind,
        letter,
        punto_venta: puntoVenta,
        numero: input.numero,
        fecha: input.fecha,
        fch_vto_pago:
          input.fch_vto_pago ?? supplierDueDate(supplier, input.fecha),
        imp_neto: input.imp_neto,
        imp_iva,
        imp_trib: trib,
        imp_no_gravado,
        imp_op_exentas,
        ...split,
        imp_total: input.imp_total,
        moneda,
        cotizacion: moneda === "DOL" ? input.cotizacion : 1,
        cae_proveedor: internal ? null : (input.cae ?? null),
        cae_vto_proveedor: null,
        invoice_origin_id: origin.id,
        motivo_nc_nd: kind === "factura" ? null : (input.motivo ?? null),
        notes: input.notes ?? null,
        items: [],
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const denied = refuseEmployeeCharge(ctx, draft.charged_employee_id);
    if (denied) return { ok: false, error: denied };
    return createPurchaseInvoice(ctx.userId, draft);
  },
});

// ─── Comprobante recibido de ARCA ────────────────────────────────────────────

export const proposeArcaPurchase = defineAiProposal({
  name: "proposeArcaPurchase",
  domain: "compras",
  // The tray and its accept are for whoever loads purchases; the supplier's
  // defaults and an NC's origin are read too.
  permission: [
    "purchase_invoices:write",
    "purchase_invoices:read",
    "suppliers:read",
  ],
  sources: [
    "arca_received_vouchers",
    "purchase_invoices",
    "suppliers",
    "invoicing_channels",
  ],
  description:
    "Propose loading a voucher received from ARCA (voucher_id from " +
    "getArcaReceivedVouchers, pending_review) as a purchase, for the user to " +
    "accept on a card, as accepting it in Compras › ARCA does: number, date, " +
    "CAE and amounts are ARCA's. When ARCA's parts do not add up to its " +
    "total, the difference goes where the USER says (gap_target " +
    "'otros_tributos' or 'no_gravado'): ask them, NEVER choose it yourself; " +
    "if it goes to otros tributos, also ask which tribute (gap_tribute) or " +
    "the full split (tributes). An NC/ND needs its origin factura " +
    "(origin_invoice_id). A supplier not loaded yet goes first through " +
    "proposeSupplier. Writes nothing by itself.",
  input: z.object({
    voucher_id: z.string().uuid(),
    gap_target: z
      .enum(ARCA_GAP_TARGETS)
      .optional()
      .describe("Only what the user chose; never pick it."),
    gap_tribute: z
      .enum(PURCHASE_TRIBUTE_FIELDS)
      .optional()
      .describe(
        "With gap_target otros_tributos: the tribute the user said the difference is.",
      ),
    tributes: tributesInput.optional(),
    origin_invoice_id: z.string().uuid().optional(),
    cotizacion: z.number().positive().optional(),
    fch_vto_pago: isoDate.optional(),
    expense_account: lookup.optional(),
    cost_center: lookup.optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
  spec: arcaPurchaseProposalSpec,
  prepare: async (_ctx, input) => {
    const read = await getReceivedVoucherAction({
      voucherId: input.voucher_id,
    });
    if (!read.ok) return { kind: "error", error: read.error };
    const voucher = read.data;
    if (!voucher) {
      return { kind: "error", error: "No existe ese comprobante de ARCA." };
    }
    if (voucher.status === "confirmed") {
      return {
        kind: "error",
        error: "Ese comprobante ya está cargado como compra.",
      };
    }
    if (voucher.status !== "pending_review" || voucher.kind === null) {
      return {
        kind: "error",
        error:
          voucher.status === "discarded"
            ? "Ese comprobante está descartado: restauralo en Compras › ARCA para cargarlo."
            : "Ese tipo de comprobante no se carga como compra.",
      };
    }
    if (!voucher.supplier) {
      return {
        kind: "error",
        error: `El proveedor ${voucher.issuer_name} (CUIT ${voucher.issuer_cuit}) no está dado de alta: primero hay que crearlo (proposeSupplier) y después cargar el comprobante.`,
      };
    }
    const stored = await getSupplierByIdAction(voucher.supplier.id);
    if (!stored.ok) return { kind: "error", error: stored.error };
    const supplier = stored.data;
    if (!supplier) {
      return { kind: "error", error: "No se pudo leer el proveedor." };
    }
    const picked = await pickChannel(undefined, supplier, true);
    if (picked.kind === "stop") return picked.result;
    const { channel } = picked;
    const labels: ProposalLabels = baseLabels(supplier, channel);
    const currency = voucher.moneda === "DOL" ? "USD" : "ARS";

    // The tray's own draft: ARCA's amounts, its tribute split (or the
    // suggestion when ARCA gives only the total) and its warnings.
    const base = arcaVoucherToDraft(voucher);
    const gap = base.arca_gap ?? null;
    if (gap !== null && input.gap_target === undefined) {
      return {
        kind: "issues",
        issues: [
          { field: "gap_target", message: arcaGapChoiceMessage(gap, voucher) },
        ],
        candidates: [
          {
            field: "gap_target",
            options: ARCA_GAP_TARGETS.map((t) => ({
              value: t,
              label: arcaGapTargetLabel(t, voucher.letter),
            })),
          },
        ],
      };
    }
    const gapTarget = gap !== null ? (input.gap_target ?? null) : null;
    const amounts = arcaDraftAmounts(base, voucher.letter, gapTarget);
    if (gap !== null) {
      labels[PURCHASE_LABELS.gap] = formatMoney(gap, currency);
    }

    let split: Split;
    if (input.tributes) {
      split = fullTributeSplit(input.tributes);
    } else {
      split = fullTributeSplit(base.tributes ?? {});
      if (gap !== null && gapTarget === "otros_tributos") {
        if (!input.gap_tribute) {
          return {
            kind: "issues",
            issues: [
              {
                field: "gap_tribute",
                message: `La diferencia de ${formatMoney(gap, currency)} va a otros tributos: falta a cuál (o el reparto completo).`,
              },
            ],
            candidates: [
              {
                field: "gap_tribute",
                options: PURCHASE_TRIBUTE_FIELDS.map((f) => ({
                  value: f,
                  label: PURCHASE_TRIBUTE_LABEL[f],
                })),
              },
            ],
          };
        }
        split[input.gap_tribute] = round2(split[input.gap_tribute] + gap);
      }
    }
    if (Math.abs(tributeSplitTotal(split) - amounts.imp_trib) > 0.01) {
      return stop(
        "tributes",
        `Los otros tributos suman ${formatMoney(amounts.imp_trib, currency)}: falta cómo se reparten (percepción de IVA, Ganancias, IIBB, municipales, internos).`,
      );
    }

    const kind = voucher.kind;
    const origin = await pickOrigin(
      input.origin_invoice_id,
      supplier,
      kind,
      labels,
    );
    if (origin.kind === "stop") return origin.result;
    const cotizacion =
      voucher.moneda === "DOL" ? (input.cotizacion ?? voucher.cotizacion) : 1;
    if (
      cotizacion === null ||
      (voucher.moneda === "DOL" && !(cotizacion > 1))
    ) {
      return stop(
        "cotizacion",
        "ARCA no trae la cotización del dólar de este comprobante: decime cuál es (pesos por dólar).",
      );
    }
    const costs = await pickCosts(input, supplier, kind, labels);
    if (costs.kind === "stop") return costs.result;

    const warnings = base.warnings.filter(
      (w) => !w.startsWith("NC/ND") && !w.startsWith("USD"),
    );
    if (warnings.length) labels[PURCHASE_LABELS.warning] = warnings.join(" ");

    return {
      kind: "draft",
      draft: {
        voucher_id: voucher.id,
        gap_target: gapTarget,
        invoice: arcaReceivedInvoice(
          { ...voucher, kind },
          {
            channelId: channel.id,
            supplierId: supplier.id,
            accountId: costs.account_id,
            costCenterId: costs.cost_center_id,
            amounts,
            split,
            cotizacion,
            fchVtoPago:
              input.fch_vto_pago ??
              supplierDueDate(supplier, voucher.fecha) ??
              voucher.fecha,
            originId: origin.id,
            notes: input.notes ?? null,
          },
        ),
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const denied = refuseEmployeeCharge(ctx, draft.invoice.charged_employee_id);
    if (denied) return { ok: false, error: denied };
    const res = await acceptReceivedVoucher(ctx.userId, {
      voucherId: draft.voucher_id,
      invoice: draft.invoice,
      gapTarget: draft.gap_target,
    });
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: res.data.id,
        ...(res.data.linkedExisting
          ? { note: "Ya estaba cargado: quedó vinculado." }
          : {}),
      },
    };
  },
});
