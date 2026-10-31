import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import {
  ACCOUNT_TYPE_LABEL,
  type AccountNameJoin,
  type AccountType,
} from "@/features/accounts/schema";
import type { IvaCondition } from "@/features/clients/schema";
import type {
  ChannelDivisionJoin,
  InvoiceWithChannelRefJoin,
} from "@/features/invoices/schema";
import type { SupplierFullJoin } from "@/features/suppliers/schema";
import { round2 } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";
import { divisionLabel } from "@/lib/pdf/emisor";

import {
  PaymentOrderDocument,
  type PaymentOrderTemplateData,
} from "./payment-order-template";

const IVA_LABEL: Record<IvaCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributo: "Monotributo",
  exento: "Exento",
  consumidor_final: "Consumidor Final",
  no_categorizado: "No Categorizado",
};

export async function renderPaymentOrderPdf(
  data: PaymentOrderTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<PaymentOrderDocument data={data} />);
}

export async function buildPaymentOrderTemplateData(
  paymentOrderId: string,
): Promise<PaymentOrderTemplateData> {
  const supabase = getServiceClient();

  const { data: op, error: opErr } = await supabase
    .from("payment_orders")
    .select(
      "id, channel_id, supplier_id, punto_venta, numero, payment_date, total_amount, currency, notes, status, channel:invoicing_channels(name, division, business_unit_id), supplier:suppliers(legal_name, cuit, iva_condition)",
    )
    .eq("id", paymentOrderId)
    .maybeSingle();

  if (opErr || !op) {
    throw new Error(`payment-order-pdf: OP not found (${paymentOrderId})`);
  }

  const channel = (op as unknown as ChannelDivisionJoin).channel;
  const supplier = (op as unknown as SupplierFullJoin).supplier;
  if (!supplier) throw new Error("payment-order-pdf: supplier missing");

  // Issuer from the channel's business_unit.
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

  // Children: payment_lines + allocations. No withholdings (K.4 dropped).
  const [linesRes, allocsRes] = await Promise.all([
    supabase
      .from("payment_order_payment_lines")
      .select("amount, reference, account_id, account:accounts(name, type)")
      .eq("payment_order_id", paymentOrderId)
      .order("created_at"),
    supabase
      .from("payment_order_allocations")
      .select(
        "amount_applied, purchase_invoice_id, invoice:purchase_invoices(kind, letter, punto_venta, numero, fecha, channel:invoicing_channels(is_fiscal))",
      )
      .eq("payment_order_id", paymentOrderId)
      .order("created_at"),
  ]);

  if (linesRes.error || allocsRes.error) {
    throw new Error("payment-order-pdf: failed to load children");
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

  const allocations = (allocsRes.data ?? []).map((a) => {
    const inv = (a as unknown as InvoiceWithChannelRefJoin).invoice;
    const pos = String(inv?.punto_venta ?? 0).padStart(4, "0");
    const num = String(inv?.numero ?? 0).padStart(8, "0");
    const letter = inv?.letter ?? "";
    const isInternal = inv?.channel?.is_fiscal === false;
    let label: string;
    if (isInternal) {
      label = `Gasto interno ${pos}-${num}`;
    } else if (inv?.kind === "nc") {
      label = `NC ${letter} ${pos}-${num}`;
    } else if (inv?.kind === "nd") {
      label = `ND ${letter} ${pos}-${num}`;
    } else {
      label = `Factura ${letter} ${pos}-${num}`;
    }
    return {
      invoice_label: label.trim().replace(/\s+/g, " "),
      invoice_date: inv?.fecha ?? "",
      amount_applied: Number(a.amount_applied),
    };
  });

  const paymentSum = payment_lines.reduce((acc, l) => acc + l.amount, 0);
  const allocatedSum = allocations.reduce(
    (acc, a) => acc + a.amount_applied,
    0,
  );
  const totalAmount = Number(op.total_amount);

  return {
    emisor: {
      legal_name: emisorLegalName,
      cuit: emisorCuit,
      address: emisorAddress,
      division_label: divisionLabel(channel?.division, channel?.name ?? ""),
    },
    beneficiario: {
      legal_name: supplier.legal_name,
      cuit: supplier.cuit,
      iva_condition_label:
        IVA_LABEL[supplier.iva_condition as IvaCondition] ??
        supplier.iva_condition,
    },
    punto_venta: op.punto_venta,
    numero: op.numero,
    fecha: op.payment_date,
    moneda: op.currency,
    payment_lines,
    allocations,
    total_amount: totalAmount,
    payment_sum: round2(paymentSum),
    allocated_sum: round2(allocatedSum),
    a_cuenta: round2(totalAmount - allocatedSum),
    notes: op.notes ?? null,
    status: op.status as "issued" | "canceled",
  };
}
