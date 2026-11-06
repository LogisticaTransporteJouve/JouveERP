import { z } from "zod";

import { getStorageBillingAction } from "@/features/storage-billing/actions/billing-actions";
import { storageInvoiceAmounts } from "@/features/storage-billing/lib/billing";
import { invoiceStorage } from "@/lib/commands/invoice-storage";
import { formatArgentineDate, formatInteger, formatMoney } from "@/lib/format";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { IsoDateSchema } from "@/lib/validation/common";

import {
  STORAGE_INVOICE_LABELS,
  storageInvoiceProposalSpec,
} from "../../lib/proposal-specs";
import { defineAiProposal } from "../propose";

import { resolveIssuePoint } from "./issue-refs";
import { resolveClientRef } from "./resolve-client";

// Depósito: invoicing a client's storage for a period, proposed on a card
// with the server's computation (the Facturación de almacenaje preview) and
// issued on accept through lib/commands/invoice-storage, the command the
// page's «Facturar» runs, with the user's session client as there.

export const proposeStorageInvoice = defineAiProposal({
  name: "proposeStorageInvoice",
  domain: "deposito",
  permission: [
    "storage_billing:issue",
    "invoices:issue",
    "storage_billing:read",
  ],
  sources: [
    "pallets",
    "storage_tariffs",
    "client_tariffs",
    "storage_billing_runs",
    "invoicing_channels",
  ],
  description:
    "Propose invoicing a client's storage (almacenaje, carga and descarga " +
    "of its pallets) for a period, for the user to accept on a card: the " +
    "server computes the amounts with the tariffs in force, the card shows " +
    "them, and accepting issues the factura (CAE on the fiscal channel) or " +
    "the remito interno and marks the period billed. Pass the client (name, " +
    "CUIT or id), the period and the punto de venta when there is more than " +
    "one. Writes nothing by itself; never invents amounts.",
  input: z.object({
    client: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .describe("Client name, CUIT or id, as the user said it."),
    period_start: IsoDateSchema,
    period_end: IsoDateSchema,
    punto_venta: z.number().int().min(1).max(99999).optional(),
    channel: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe("Channel name or id, only when the user named one."),
  }),
  spec: storageInvoiceProposalSpec,
  prepare: async (ctx, input) => {
    if (input.period_end < input.period_start) {
      return {
        kind: "issues",
        issues: [
          {
            field: "period_end",
            message: "El hasta no puede ser anterior al desde.",
          },
        ],
      };
    }
    const ref = await resolveClientRef(ctx.access, input.client, "client");
    if (!ref.ok) return ref.result;

    const preview = await getStorageBillingAction({
      periodStart: input.period_start,
      periodEnd: input.period_end,
    });
    if (!preview.ok) return { kind: "error", error: preview.error };
    const row = preview.data.byClient.find((c) => c.client_id === ref.id);
    const lines = preview.data.lines.filter((l) => l.client_id === ref.id);
    if (!row || lines.length === 0) {
      return {
        kind: "error",
        error: "El cliente no tiene pallets en depósito en ese período.",
      };
    }
    if (lines.some((l) => l.missing_rate)) {
      return {
        kind: "error",
        error: `Falta la cotización del dólar al ${formatArgentineDate(input.period_end)} (o anterior) para las tarifas en USD del cliente: cargala en Contabilidad › Cotización USD.`,
      };
    }
    const amounts = storageInvoiceAmounts(lines, ref.id);
    if (amounts.total <= 0) {
      return {
        kind: "error",
        error: "No hay nada para facturar en ese período.",
      };
    }
    if (row.client_is_fiscal === null) {
      return {
        kind: "error",
        error: "No se pudo saber si el cliente es de Ventas o de Otras ventas.",
      };
    }

    const point = await resolveIssuePoint(
      { is_fiscal: row.client_is_fiscal },
      input,
    );
    if (!point.ok) return point.result;
    const { channel, puntoVenta } = point.value;

    // A line the invoice leaves out (nothing to bill) is not shown either.
    const money = (key: string, n: number) =>
      n > 0 ? { [key]: formatMoney(n) } : {};
    const labels = {
      [ref.id]: ref.label ?? row.client_name,
      [STORAGE_INVOICE_LABELS.channel]: channel.name,
      [STORAGE_INVOICE_LABELS.pallets]: formatInteger(lines.length),
      ...money(STORAGE_INVOICE_LABELS.storage, amounts.storage),
      ...money(STORAGE_INVOICE_LABELS.loading, amounts.loading),
      ...money(STORAGE_INVOICE_LABELS.unloading, amounts.unloading),
    };
    return {
      kind: "draft",
      draft: {
        client_id: ref.id,
        period_start: input.period_start,
        period_end: input.period_end,
        channel_id: channel.id,
        punto_venta: puntoVenta,
        expected_total: amounts.total,
      },
      labels,
    };
  },
  execute: async (ctx, draft) => {
    const { expected_total, ...invoice } = draft;
    const res = await invoiceStorage(
      await createSupabaseClient(),
      ctx.userId,
      invoice,
      expected_total,
    );
    return res.ok ? { ok: true, data: { id: res.data.invoiceId } } : res;
  },
});
