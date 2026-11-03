import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import {
  differenceNote,
  formatDriverSettlementNumber,
  isDifferenceChargedTo,
  isDifferencePostedKind,
  settlementDifference,
} from "@/features/driver-settlements/schema";
import { formatReceiptNumber } from "@/features/receipts/schema";
import { formatArgentineDate, round2 } from "@/lib/format";
import { loadEmisor, redactEmisor } from "@/lib/pdf/emisor";
import { voucherEmisor } from "@/lib/pdf/voucher-data";
import { getServiceClient } from "@/lib/supabase/service";

import {
  DriverSettlementDocument,
  type DriverSettlementTemplateData,
} from "./driver-settlement-template";

export async function renderDriverSettlementPdf(
  data: DriverSettlementTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<DriverSettlementDocument data={data} />);
}

/** The document of a confirmed (or cancelled) rendición. A draft has no
 *  number and no document. */
export async function buildDriverSettlementTemplateData(
  settlementId: string,
): Promise<DriverSettlementTemplateData> {
  const supabase = getServiceClient();

  const { data: s, error } = await supabase
    .from("driver_settlements")
    .select(
      "id, numero, status, settlement_date, notes, difference_charged_to, driver:drivers(full_name), difference:employee_account_movements(kind, amount)",
    )
    .eq("id", settlementId)
    .maybeSingle();
  if (error || !s) {
    throw new Error(`driver-settlement-pdf: not found (${settlementId})`);
  }
  if (s.numero === null) {
    throw new Error(
      "La rendición es un borrador: confirmala para ver el documento.",
    );
  }

  const { data: items, error: itemsErr } = await supabase
    .from("driver_settlement_items")
    .select(
      "expected_amount, note, shipment:shipments(remito_number, delivery_date, client:clients(legal_name)), lines:driver_settlement_lines(amount, reference, check_number, bank_name, created_at, account:accounts(name), receipt:receipts(punto_venta, numero, status))",
    )
    .eq("settlement_id", settlementId)
    .order("created_at")
    .order("id");
  if (itemsErr) throw new Error("driver-settlement-pdf: failed to load items");

  // Internal document: the division only, like any non-fiscal PDF (D5).
  const { data: channel, error: chErr } = await supabase
    .from("invoicing_channels")
    .select("business_unit_id")
    .eq("is_active", true)
    .order("id")
    .limit(1)
    .maybeSingle();
  if (chErr) throw new Error(`driver-settlement-pdf: ${chErr.message}`);
  const emisor = redactEmisor({
    isFiscal: false,
    emisor: await loadEmisor(supabase, {
      business_unit_id: channel?.business_unit_id ?? null,
    }),
  });

  const receipts = new Set<string>();
  let expected = 0;
  let received = 0;
  const rows = (items ?? []).map((i) => {
    const lines = [...i.lines].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const got = round2(lines.reduce((t, l) => t + Number(l.amount), 0));
    expected += Number(i.expected_amount);
    received += got;
    for (const l of lines) {
      if (l.receipt) {
        receipts.add(
          `${formatReceiptNumber(l.receipt.punto_venta, l.receipt.numero)}${l.receipt.status === "canceled" ? " (anulado)" : ""}`,
        );
      }
    }
    const date = i.shipment?.delivery_date;
    return {
      date: date ? formatArgentineDate(date) : "—",
      client: i.shipment?.client?.legal_name ?? "—",
      remito: i.shipment?.remito_number ?? "—",
      expected: Number(i.expected_amount),
      received: got,
      difference: settlementDifference(Number(i.expected_amount), got),
      lines: lines.map((l) => ({
        account: l.account?.name ?? "—",
        amount: Number(l.amount),
        detail: l.check_number
          ? `Cheque ${l.check_number}${l.bank_name ? ` · ${l.bank_name}` : ""}`
          : l.reference,
      })),
      note: i.note,
    };
  });

  const posted = s.difference[0];
  return {
    emisor: voucherEmisor(emisor),
    number: formatDriverSettlementNumber(s.numero),
    fecha: formatArgentineDate(s.settlement_date),
    driver: s.driver?.full_name ?? "—",
    items: rows,
    expected: round2(expected),
    received: round2(received),
    difference: settlementDifference(expected, received),
    receipts: [...receipts],
    differenceNote: differenceNote(
      isDifferenceChargedTo(s.difference_charged_to)
        ? s.difference_charged_to
        : null,
      posted && isDifferencePostedKind(posted.kind)
        ? { kind: posted.kind, amount: Number(posted.amount) }
        : null,
    ),
    notes: s.notes,
    cancelled: s.status === "cancelled",
  };
}
