import { z } from "zod";

import { isCheckAccount, type Account } from "@/features/accounts/schema";
import { isoDate } from "@/features/exchange-rates/schema";
import { comprobanteLabel } from "@/features/late-interest/lib/late-interest";
import {
  getNextPaymentOrderNumeroAction,
  getPaymentOrderUsdRateAction,
  listPendingInvoicesForSupplierAction,
} from "@/features/payment-orders/actions/payment-orders-actions";
import { formatPaymentOrderNumber } from "@/features/payment-orders/schema";
import {
  getNextReceiptNumeroAction,
  getReceiptUsdRateAction,
  listPendingComprobantesForClientAction,
} from "@/features/receipts/actions/receipts-actions";
import { formatReceiptNumber } from "@/features/receipts/schema";
import { userCan } from "@/lib/auth/permissions";
import { allocateFifo, type PendingDocument } from "@/lib/allocations";
import type { InvoicingChannelRow } from "@/lib/channels";
import { createPaymentOrder } from "@/lib/commands/create-payment-order";
import { createReceipt } from "@/lib/commands/create-receipt";
import { createTransaction } from "@/lib/commands/create-transaction";
import { createTransfer } from "@/lib/commands/create-transfer";
import { formatArgentineDate, todayInAR } from "@/lib/format";
import type { ActionResult } from "@/lib/query/run-action";
import type { ScopeSide } from "@/lib/scope";

import {
  cashMovementProposalSpec,
  paymentOrderProposalSpec,
  receiptProposalSpec,
  transferProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal, type AiPrepareResult } from "../propose";

import {
  accountLabel,
  activeChannels,
  channelFor,
  ChannelSideInput,
  resolveAccount,
  type Resolved,
} from "./treasury-refs";
import { resolveClient } from "./resolve-client";
import { findSupplier } from "./resolve-supplier";

// Treasury proposals over the writes of Caja, Recibos and Órdenes de pago.
// `prepare` resolves the names with the features' read actions, takes the
// number, the USD rate and the open documents from the server (never from
// the model) and spreads the amount oldest-first as the form's «Automática»
// would; the draft keeps those allocations as picked ones, so accepting
// re-checks them against what is open then and refuses if it changed.

const amount = z
  .number()
  .finite()
  .positive()
  .max(1_000_000_000_000)
  .describe("Amount the user said, in the account's currency.");

const notCheckAccount = (a: Account) => !isCheckAccount(a.type);

/** First day of the date's month (the movement's accrual month). */
function monthOf(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function issue(field: string, message: string): AiPrepareResult {
  return { kind: "issues", issues: [{ field, message }] };
}

/** The channel the user named, or the one where the counterparty has
 *  something open in that currency (asks when both or neither do), with its
 *  open documents. */
async function payerChannel<T extends PendingDocument & { currency: string }>(
  side: ScopeSide | undefined,
  currency: string,
  listPending: (channelId: string) => Promise<ActionResult<T[]>>,
): Promise<Resolved<{ channel: InvoicingChannelRow; pending: T[] }>> {
  const chans = await activeChannels();
  if (!chans.ok) return chans;
  const channels = chans.value;
  const open = (rows: T[]) => rows.filter((r) => r.currency === currency);
  if (side || channels.length <= 1) {
    const ch = channelFor(channels, side);
    if (!ch.ok) return ch;
    const res = await listPending(ch.value.id);
    if (!res.ok)
      return { ok: false, result: { kind: "error", error: res.error } };
    return { ok: true, value: { channel: ch.value, pending: open(res.data) } };
  }
  const byChannel = new Map<string, T[]>();
  for (const c of channels) {
    const res = await listPending(c.id);
    if (!res.ok)
      return { ok: false, result: { kind: "error", error: res.error } };
    byChannel.set(c.id, open(res.data));
  }
  const withOpen = channels.filter((c) => (byChannel.get(c.id) ?? []).length);
  const ch = channelFor(channels, undefined, withOpen);
  if (!ch.ok) return ch;
  return {
    ok: true,
    value: { channel: ch.value, pending: byChannel.get(ch.value.id) ?? [] },
  };
}

/** The USD rate the user gave, else the loaded one for the date. */
async function usdRate(
  given: number | undefined,
  read: (date: string) => Promise<ActionResult<{ rate: number } | null>>,
  date: string,
): Promise<Resolved<number>> {
  if (given !== undefined) return { ok: true, value: given };
  const res = await read(date);
  if (!res.ok)
    return { ok: false, result: { kind: "error", error: res.error } };
  if (!res.data) {
    return {
      ok: false,
      result: issue(
        "cotizacion",
        `No hay cotización USD cargada al ${formatArgentineDate(date)}: pedile al usuario la cotización.`,
      ),
    };
  }
  return { ok: true, value: res.data.rate };
}

const ALLOCATION_INPUT = z
  .enum(["fifo", "a_cuenta"])
  .optional()
  .describe(
    "'fifo' (default): applied to the oldest open documents; 'a_cuenta': " +
      "held on account, applied later.",
  );

// ─── Recibos ─────────────────────────────────────────────────────────────────

export const proposeReceipt = defineAiProposal({
  name: "proposeReceipt",
  domain: "ventas",
  permission: [
    "receipts:write",
    "receipts:read",
    "clients:read",
    "accounts:read",
  ],
  sources: ["receipts", "invoices", "accounts"],
  description:
    "Propose registering a client's payment (cobro: a recibo) for the user " +
    "to accept on a card: client, amount, the treasury account it came into " +
    "(bank, cash, or the check cartera with the check's data), date (default " +
    "today). The server takes the number, the USD rate and the open " +
    "comprobantes, applied oldest first unless allocation is 'a_cuenta'. " +
    "Writes nothing by itself.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name or CUIT, as the user said it."),
    amount,
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Treasury account the money came into, by name."),
    receipt_date: isoDate.optional(),
    currency: z.enum(["ARS", "USD"]).optional(),
    cotizacion: z.number().gt(1).lt(1_000_000).optional(),
    channel: ChannelSideInput,
    allocation: ALLOCATION_INPUT,
    reference: z.string().trim().max(120).optional(),
    check: z
      .object({
        number: z.string().trim().min(1).max(60),
        bank: z.string().trim().min(1).max(120),
        drawer: z.string().trim().min(1).max(120),
        drawer_cuit: z.string().trim().max(20).optional(),
        due_date: isoDate,
      })
      .optional()
      .describe("Only for a payment with a check (a check account)."),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: receiptProposalSpec,
  prepare: async (_ctx, input) => {
    const client = await resolveClient(input.client);
    if (!client.ok) return client.result;
    const account = await resolveAccount(input.account, "account");
    if (!account.ok) return account.result;
    const acc = account.value;
    if (input.currency && input.currency !== acc.currency) {
      return issue(
        "currency",
        `La cuenta ${acc.name} es en ${acc.currency}: elegí una cuenta en ${input.currency}.`,
      );
    }
    if (isCheckAccount(acc.type) && !input.check) {
      return issue(
        "check",
        "Para cobrar con cheque faltan el número, el banco, el librador y la fecha de cobro.",
      );
    }
    const date = input.receipt_date ?? todayInAR();
    const where = await payerChannel(input.channel, acc.currency, (channelId) =>
      listPendingComprobantesForClientAction(client.client.id, channelId),
    );
    if (!where.ok) return where.result;
    const { channel, pending } = where.value;

    const next = await getNextReceiptNumeroAction({ channel_id: channel.id });
    if (!next.ok) return { kind: "error", error: next.error };
    let cotizacion: number | null = null;
    if (acc.currency === "USD") {
      const rate = await usdRate(
        input.cotizacion,
        getReceiptUsdRateAction,
        date,
      );
      if (!rate.ok) return rate.result;
      cotizacion = rate.value;
    }

    const invoices = pending.filter((c) => c.document_type === "invoice");
    const allocations =
      input.allocation === "a_cuenta"
        ? []
        : allocateFifo(invoices, input.amount).map((a) => ({
            invoice_id: a.document_id,
            amount_applied: a.amount_applied,
          }));
    const labels: Record<string, string> = {
      [client.client.id]: client.client.legal_name,
      [acc.id]: accountLabel(acc),
      [channel.id]: channel.name,
    };
    for (const a of allocations) {
      const c = invoices.find((i) => i.id === a.invoice_id);
      if (c)
        labels[c.id] =
          `${comprobanteLabel(c)} del ${formatArgentineDate(c.fecha)}`;
    }
    const check = isCheckAccount(acc.type) ? input.check : undefined;
    return {
      kind: "draft",
      draft: {
        channel_id: channel.id,
        numero: next.data.next,
        client_id: client.client.id,
        receipt_date: date,
        total_amount: input.amount,
        currency: acc.currency,
        cotizacion,
        notes: input.notes ?? null,
        payment_lines: [
          {
            account_id: acc.id,
            amount: input.amount,
            reference: input.reference ?? check?.number ?? null,
            ...(check
              ? {
                  check: {
                    check_number: check.number,
                    bank_name: check.bank,
                    drawer_name: check.drawer,
                    drawer_cuit: check.drawer_cuit ?? "",
                    issue_date: date,
                    due_date: check.due_date,
                  },
                }
              : {}),
          },
        ],
        allocation_mode: allocations.length ? "manual" : "a_cuenta",
        allocations,
        retentions: [],
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    if (
      draft.retentions.length > 0 &&
      !userCan(ctx.access, "retentions:write")
    ) {
      return {
        ok: false,
        error: "No tenés permiso para cargar o editar retenciones.",
      };
    }
    const res = await createReceipt(
      ctx.userId,
      draft,
      listPendingComprobantesForClientAction,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: res.data.id,
        note: `Recibo ${formatReceiptNumber(res.data.punto_venta, res.data.numero)} emitido.`,
      },
    };
  },
});

// ─── Órdenes de pago ─────────────────────────────────────────────────────────

export const proposePaymentOrder = defineAiProposal({
  name: "proposePaymentOrder",
  domain: "compras",
  permission: [
    "payment_orders:write",
    "payment_orders:read",
    "suppliers:read",
    "accounts:read",
  ],
  sources: ["payment_orders", "purchase_invoices", "accounts"],
  description:
    "Propose a payment order (orden de pago) to a supplier for the user to " +
    "accept on a card: supplier, amount, the bank or cash account it is paid " +
    "from, date (default today). The server takes the number, the USD rate " +
    "and the open purchases, applied oldest first unless allocation is " +
    "'a_cuenta'. Paying with checks is done on the page. Writes nothing by " +
    "itself.",
  input: z.object({
    supplier: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Supplier name or CUIT, as the user said it."),
    amount,
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Bank or cash account the money goes out of, by name."),
    payment_date: isoDate.optional(),
    currency: z.enum(["ARS", "USD"]).optional(),
    cotizacion: z.number().gt(1).lt(1_000_000).optional(),
    channel: ChannelSideInput,
    allocation: ALLOCATION_INPUT,
    reference: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(500).optional(),
  }),
  spec: paymentOrderProposalSpec,
  prepare: async (_ctx, input) => {
    const found = await findSupplier(input.supplier, { onlyActive: true });
    if (found.kind === "stop") return found.result;
    const supplier = found.supplier;
    const account = await resolveAccount(
      input.account,
      "account",
      notCheckAccount,
    );
    if (!account.ok) return account.result;
    const acc = account.value;
    if (input.currency && input.currency !== acc.currency) {
      return issue(
        "currency",
        `La cuenta ${acc.name} es en ${acc.currency}: elegí una cuenta en ${input.currency}.`,
      );
    }
    const date = input.payment_date ?? todayInAR();
    const where = await payerChannel(input.channel, acc.currency, (channelId) =>
      listPendingInvoicesForSupplierAction(supplier.id, channelId),
    );
    if (!where.ok) return where.result;
    const { channel, pending } = where.value;

    const next = await getNextPaymentOrderNumeroAction({
      channel_id: channel.id,
    });
    if (!next.ok) return { kind: "error", error: next.error };
    let cotizacion: number | null = null;
    if (acc.currency === "USD") {
      const rate = await usdRate(
        input.cotizacion,
        getPaymentOrderUsdRateAction,
        date,
      );
      if (!rate.ok) return rate.result;
      cotizacion = rate.value;
    }

    const allocations =
      input.allocation === "a_cuenta"
        ? []
        : allocateFifo(pending, input.amount).map((a) => ({
            purchase_invoice_id: a.document_id,
            amount_applied: a.amount_applied,
          }));
    const labels: Record<string, string> = {
      [supplier.id]: supplier.legal_name,
      [acc.id]: accountLabel(acc),
      [channel.id]: channel.name,
    };
    for (const a of allocations) {
      const c = pending.find((i) => i.id === a.purchase_invoice_id);
      if (c)
        labels[c.id] =
          `${comprobanteLabel(c)} del ${formatArgentineDate(c.fecha)}`;
    }
    return {
      kind: "draft",
      draft: {
        channel_id: channel.id,
        numero: next.data.next,
        supplier_id: supplier.id,
        payment_date: date,
        total_amount: input.amount,
        currency: acc.currency,
        cotizacion,
        notes: input.notes ?? null,
        payment_lines: [
          {
            line_kind: "account",
            account_id: acc.id,
            amount: input.amount,
            reference: input.reference ?? null,
          },
        ],
        allocation_mode: allocations.length ? "manual" : "a_cuenta",
        allocations,
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const res = await createPaymentOrder(
      ctx.userId,
      draft,
      listPendingInvoicesForSupplierAction,
    );
    if (!res.ok) return res;
    return {
      ok: true,
      data: {
        id: res.data.id,
        note: `Orden de pago ${formatPaymentOrderNumber(res.data.punto_venta, res.data.numero)} emitida.`,
      },
    };
  },
});

// ─── Caja ────────────────────────────────────────────────────────────────────

export const proposeCashMovement = defineAiProposal({
  name: "proposeCashMovement",
  domain: "tesoreria",
  permission: ["transactions:write", "accounts:read"],
  sources: ["transactions", "accounts"],
  description:
    "Propose a manual cash movement (Caja: ingreso or egreso) on a bank, " +
    "cash or wallet account for the user to accept on a card: kind, amount, " +
    "account, date (default today), description. Not for check accounts " +
    "(checks have their own proposals), receipts or payment orders. Writes " +
    "nothing by itself.",
  input: z.object({
    kind: z.enum(["income", "expense"]),
    amount,
    account: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Treasury account name, as the user said it."),
    transaction_date: isoDate.optional(),
    description: z.string().trim().min(1).max(500),
    channel: ChannelSideInput,
  }),
  spec: cashMovementProposalSpec,
  prepare: async (_ctx, input) => {
    const account = await resolveAccount(
      input.account,
      "account",
      notCheckAccount,
    );
    if (!account.ok) return account.result;
    const chans = await activeChannels();
    if (!chans.ok) return chans.result;
    const channel = channelFor(chans.value, input.channel);
    if (!channel.ok) return channel.result;
    const acc = account.value;
    const date = input.transaction_date ?? todayInAR();
    return {
      kind: "draft",
      draft: {
        account_id: acc.id,
        channel_id: channel.value.id,
        kind: input.kind,
        amount: input.amount,
        currency: acc.currency,
        transaction_date: date,
        accrual_month: monthOf(date),
        description: input.description,
      },
      labels: {
        [acc.id]: accountLabel(acc),
        [channel.value.id]: channel.value.name,
      },
    };
  },
  execute: (ctx, draft) => createTransaction(ctx.userId, draft),
});

export const proposeTransfer = defineAiProposal({
  name: "proposeTransfer",
  domain: "tesoreria",
  permission: ["transactions:write", "accounts:read"],
  sources: ["transactions", "accounts"],
  description:
    "Propose a transfer between two of the company's own treasury accounts " +
    "(same currency) for the user to accept on a card: from, to, amount, " +
    "date (default today). Writes nothing by itself.",
  input: z.object({
    from: z.string().trim().min(1).max(120).describe("Account it leaves."),
    to: z.string().trim().min(1).max(120).describe("Account it enters."),
    amount,
    transaction_date: isoDate.optional(),
    description: z.string().trim().max(500).optional(),
    channel: ChannelSideInput,
  }),
  spec: transferProposalSpec,
  prepare: async (_ctx, input) => {
    const from = await resolveAccount(input.from, "from", notCheckAccount);
    if (!from.ok) return from.result;
    const to = await resolveAccount(input.to, "to", notCheckAccount);
    if (!to.ok) return to.result;
    if (from.value.id === to.value.id) {
      return issue("to", "La cuenta origen y la destino deben ser distintas.");
    }
    if (from.value.currency !== to.value.currency) {
      return {
        kind: "error",
        error: `Moneda incompatible: ${from.value.currency} → ${to.value.currency}.`,
      };
    }
    const chans = await activeChannels();
    if (!chans.ok) return chans.result;
    const channel = channelFor(chans.value, input.channel);
    if (!channel.ok) return channel.result;
    const date = input.transaction_date ?? todayInAR();
    return {
      kind: "draft",
      draft: {
        account_from_id: from.value.id,
        account_to_id: to.value.id,
        channel_id: channel.value.id,
        amount: input.amount,
        currency: from.value.currency,
        transaction_date: date,
        accrual_month: monthOf(date),
        description: input.description ?? null,
      },
      labels: {
        [from.value.id]: accountLabel(from.value),
        [to.value.id]: accountLabel(to.value),
        [channel.value.id]: channel.value.name,
      },
    };
  },
  execute: async (ctx, draft) => {
    const res = await createTransfer(ctx.userId, draft);
    return res.ok ? { ok: true, data: { id: res.data.transfer_out_id } } : res;
  },
});
