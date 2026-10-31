import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import type { ClientIdentityJoin } from "@/features/clients/schema";
import type {
  ChannelIssuerJoin,
  InvoiceRefJoin,
} from "@/features/invoices/schema";
import {
  RETENTION_KIND_LABEL,
  RETENTION_TAX_TYPE_LABEL,
  type RetentionKind,
  type RetentionTaxType,
} from "@/features/receipts/schema";
import { round2 } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";
import { formatInvoiceNumero } from "@/features/invoices/schema";
import { loadEmisor, redactEmisor } from "@/lib/pdf/emisor";
import {
  voucherEmisor,
  voucherParty,
  voucherPaymentLines,
} from "@/lib/pdf/voucher-data";

import { ReceiptDocument, type ReceiptTemplateData } from "./receipt-template";

export async function renderReceiptPdf(
  data: ReceiptTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument data={data} />);
}

export async function buildReceiptTemplateData(
  receiptId: string,
): Promise<ReceiptTemplateData> {
  const supabase = getServiceClient();

  const { data: receipt, error: rErr } = await supabase
    .from("receipts")
    .select(
      "id, channel_id, client_id, punto_venta, numero, receipt_date, total_amount, currency, notes, status, channel:invoicing_channels(name, is_fiscal, business_unit_id), client:clients(legal_name, cuit, iva_condition)",
    )
    .eq("id", receiptId)
    .maybeSingle();

  if (rErr || !receipt) {
    throw new Error(`receipt-pdf: receipt not found (${receiptId})`);
  }

  const channel = (receipt as unknown as ChannelIssuerJoin).channel;
  const client = (receipt as unknown as ClientIdentityJoin).client;
  if (!client) throw new Error("receipt-pdf: client missing");

  // Issuer comes from the business unit's fiscal fields; an internal
  // receipt carries none of them (D5).
  const isFiscal = channel?.is_fiscal ?? true;
  const emisor = redactEmisor({
    isFiscal,
    emisor: await loadEmisor(supabase, {
      business_unit_id: channel?.business_unit_id ?? null,
    }),
  });

  // Child rows: payment lines, retentions, allocations.
  const [linesRes, retentionsRes, allocsRes, checkAllocsRes] =
    await Promise.all([
      supabase
        .from("receipt_payment_lines")
        .select("amount, reference, account_id, account:accounts(name, type)")
        .eq("receipt_id", receiptId)
        .order("created_at"),
      supabase
        .from("receipt_retentions")
        .select(
          "kind, tax_type, jurisdiction, certificate_number, certificate_date, amount",
        )
        .eq("receipt_id", receiptId)
        .order("created_at"),
      supabase
        .from("receipt_allocations")
        .select(
          "amount_applied, invoice_id, invoice:invoices(letter, kind, punto_venta, numero, fecha)",
        )
        .eq("receipt_id", receiptId)
        .order("created_at"),
      supabase
        .from("receipt_rejected_check_allocations")
        .select("amount_applied, check:checks(check_number, bank_name)")
        .eq("receipt_id", receiptId)
        .order("created_at"),
    ]);

  if (
    linesRes.error ||
    retentionsRes.error ||
    allocsRes.error ||
    checkAllocsRes.error
  ) {
    throw new Error("receipt-pdf: failed to load children");
  }

  const payment_lines = voucherPaymentLines(linesRes.data ?? []);

  const retentions = (retentionsRes.data ?? []).map((r) => ({
    kind_label: RETENTION_KIND_LABEL[r.kind as RetentionKind] ?? r.kind,
    tax_type_label:
      RETENTION_TAX_TYPE_LABEL[r.tax_type as RetentionTaxType] ?? r.tax_type,
    jurisdiction: r.jurisdiction ?? null,
    certificate_number: r.certificate_number,
    certificate_date: r.certificate_date,
    amount: Number(r.amount),
  }));

  const allocations = (allocsRes.data ?? []).map((a) => {
    const inv = (a as unknown as InvoiceRefJoin).invoice;
    const numero = inv
      ? formatInvoiceNumero(inv.kind, inv.letter, inv.punto_venta, inv.numero)
      : "—";
    // Allocations share the receipt's channel: internal ones never read
    // "Factura".
    const label =
      inv?.kind === "factura"
        ? `${isFiscal ? "Factura" : "Comprobante interno"} ${numero}`
        : numero;
    return {
      invoice_label: label.trim().replace(/\s+/g, " "),
      invoice_date: inv?.fecha ?? "",
      amount_applied: Number(a.amount_applied),
    };
  });
  // What the receipt settled of the client's rejected checks.
  for (const a of checkAllocsRes.data ?? []) {
    allocations.push({
      invoice_label: a.check
        ? `Cheque rechazado ${a.check.check_number} ${a.check.bank_name}`
        : "Cheque rechazado",
      invoice_date: "",
      amount_applied: Number(a.amount_applied),
    });
  }

  const paymentSum = payment_lines.reduce((acc, l) => acc + l.amount, 0);
  const retentionSum = retentions.reduce((acc, r) => acc + r.amount, 0);
  const allocatedSum = allocations.reduce(
    (acc, a) => acc + a.amount_applied,
    0,
  );
  const totalAmount = Number(receipt.total_amount);

  return {
    ...(isFiscal ? {} : { title: "RECIBO INTERNO" }),
    emisor: voucherEmisor(emisor),
    receptor: voucherParty(client),
    punto_venta: receipt.punto_venta,
    numero: receipt.numero,
    fecha: receipt.receipt_date,
    moneda: receipt.currency,
    payment_lines,
    retentions,
    allocations,
    total_amount: totalAmount,
    payment_sum: round2(paymentSum),
    retention_sum: round2(retentionSum),
    allocated_sum: round2(allocatedSum),
    a_cuenta: round2(totalAmount - allocatedSum),
    notes: receipt.notes ?? null,
    status: receipt.status as "issued" | "canceled",
  };
}
