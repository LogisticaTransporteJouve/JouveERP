import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import {
  ACCOUNT_TYPE_LABEL,
  type AccountNameJoin,
  type AccountType,
} from "@/features/accounts/schema";
import type {
  ClientIdentityJoin,
  IvaCondition,
} from "@/features/clients/schema";
import type {
  ChannelDivisionJoin,
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

import {
  ReceiptDocument,
  type ReceiptTemplateData,
} from "./receipt-template";

const IVA_LABEL: Record<IvaCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
  consumidor_final: "Consumidor Final",
  no_categorizado: "No Categorizado",
};

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
      "id, channel_id, client_id, punto_venta, numero, receipt_date, total_amount, currency, notes, status, channel:invoicing_channels(name, division, business_unit_id), client:clients(legal_name, cuit, iva_condition)",
    )
    .eq("id", receiptId)
    .maybeSingle();

  if (rErr || !receipt) {
    throw new Error(`receipt-pdf: receipt not found (${receiptId})`);
  }

  const channel = (receipt as unknown as ChannelDivisionJoin).channel;
  const client = (receipt as unknown as ClientIdentityJoin).client;
  if (!client) throw new Error("receipt-pdf: client missing");

  // Issuer comes from the business unit's fiscal fields.
  const buId = channel?.business_unit_id;
  let emisorLegalName = "DZ & Sons S.A.";
  let emisorCuit = "";
  let emisorAddress: string | null = null;
  if (buId) {
    const { data: bu } = await supabase
      .from("business_units")
      .select("name, cuit, tax_address")
      .eq("id", buId)
      .maybeSingle();
    if (bu) {
      emisorLegalName = bu.name ?? emisorLegalName;
      emisorCuit = bu.cuit ?? "";
      emisorAddress = bu.tax_address ?? null;
    }
  }

  // Child rows: payment lines, retentions, allocations.
  const [linesRes, retentionsRes, allocsRes] = await Promise.all([
    supabase
      .from("receipt_payment_lines")
      .select(
        "amount, reference, account_id, account:accounts(name, type)",
      )
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
  ]);

  if (linesRes.error || retentionsRes.error || allocsRes.error) {
    throw new Error("receipt-pdf: failed to load children");
  }

  const payment_lines = (linesRes.data ?? []).map((l) => {
    const acc = (l as unknown as AccountNameJoin).account;
    return {
      account_name: acc?.name ?? "—",
      account_type_label:
        ACCOUNT_TYPE_LABEL[acc?.type as AccountType] ?? acc?.type ?? "",
      amount: Number(l.amount),
      reference: l.reference ?? null,
    };
  });

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
    const pos = String(inv?.punto_venta ?? 0).padStart(4, "0");
    const num = String(inv?.numero ?? 0).padStart(8, "0");
    const letter = inv?.letter ?? "";
    const label =
      inv?.kind === "factura"
        ? `Factura ${letter} ${pos}-${num}`
        : inv?.kind === "credit_note"
          ? `NC ${letter} ${pos}-${num}`
          : inv?.kind === "debit_note"
            ? `ND ${letter} ${pos}-${num}`
            : `${pos}-${num}`;
    return {
      invoice_label: label.trim().replace(/\s+/g, " "),
      invoice_date: inv?.fecha ?? "",
      amount_applied: Number(a.amount_applied),
    };
  });

  const paymentSum = payment_lines.reduce((acc, l) => acc + l.amount, 0);
  const retentionSum = retentions.reduce((acc, r) => acc + r.amount, 0);
  const allocatedSum = allocations.reduce(
    (acc, a) => acc + a.amount_applied,
    0,
  );
  const totalAmount = Number(receipt.total_amount);

  return {
    emisor: {
      legal_name: emisorLegalName,
      cuit: emisorCuit,
      address: emisorAddress,
      division_label:
        channel?.division === "jouve"
          ? "Logística Jouve"
          : channel?.division === "dz"
            ? "DZ Instalaciones"
            : channel?.name ?? "",
    },
    receptor: {
      legal_name: client.legal_name,
      cuit: client.cuit,
      iva_condition_label:
        IVA_LABEL[client.iva_condition as IvaCondition] ?? client.iva_condition,
    },
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
