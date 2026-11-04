import { inferIvaRateId } from "@/features/libro-iva/schema";
import {
  IVA_RATE_PERCENT,
  ivaRatePercent,
  type InvoiceLetter,
  type IvaRateId,
} from "@/lib/afip/codes";
import { round2 } from "@/lib/format";

// The figures an invoice prints, shared by the PDF (invoice-template.tsx) and
// the detail page (app/(dashboard)/invoices/[id]/page.tsx) so both answer
// "what makes up this total" the same way. Pure: no renderer, no I/O.

export interface PerRate {
  id: IvaRateId;
  base: number;
  importe: number;
}

export interface InvoiceFigures {
  isFiscal: boolean;
  letter: InvoiceLetter | null;
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_tot_conc: number;
  imp_op_ex: number;
  imp_total: number;
  per_rate: PerRate[];
}

export interface InvoiceFiguresItem {
  quantity: number;
  unit_price: number;
  line_neto: number;
  line_total: number;
}

export interface TotalsRow {
  label: string;
  amount: number;
}

function isIvaRateId(id: number): id is IvaRateId {
  return id in IVA_RATE_PERCENT;
}

/** IVA per rate from the items, low rate id first. An invoice imported from
 *  ARCA without its breakdown has only the header: its one bucket goes under
 *  the rate the Libro IVA infers for it, so Subtotal + IVA = Total and the
 *  figures agree with the book. */
export function invoicePerRate(
  header: { isFiscal: boolean; imp_neto: number; imp_iva: number },
  items: ReadonlyArray<{
    iva_rate_id: number | null;
    line_neto: number;
    line_iva: number;
  }>,
): PerRate[] {
  const buckets = new Map<IvaRateId, { base: number; importe: number }>();
  for (const it of items) {
    if (it.iva_rate_id === null || !isIvaRateId(it.iva_rate_id)) continue;
    const bucket = buckets.get(it.iva_rate_id) ?? { base: 0, importe: 0 };
    bucket.base = round2(bucket.base + it.line_neto);
    bucket.importe = round2(bucket.importe + it.line_iva);
    buckets.set(it.iva_rate_id, bucket);
  }
  const perRate = [...buckets].map(([id, b]) => ({ id, ...b }));
  perRate.sort((a, b) => a.id - b.id);
  if (header.isFiscal && items.length === 0 && header.imp_neto > 0) {
    const id = inferIvaRateId({ neto: header.imp_neto, iva: header.imp_iva });
    if (id !== null && isIvaRateId(id)) {
      perRate.push({ id, base: header.imp_neto, importe: header.imp_iva });
    }
  }
  return perRate;
}

/** Only an A voucher itemizes IVA. RG 1415: a B voucher's prices and
 *  total include it; a remito interno carries none. */
export function discriminatesIva(data: InvoiceFigures): boolean {
  return data.isFiscal && data.letter !== "B" && data.letter !== "C";
}

/** The rows above «Total». An A voucher sums them to the total; a B one shows
 *  the IVA-inclusive subtotal and only the tributos added on top. */
export function invoiceTotalsRows(data: InvoiceFigures): TotalsRow[] {
  if (!data.isFiscal) return [];
  if (!discriminatesIva(data)) {
    return data.imp_trib > 0
      ? [
          { label: "Subtotal", amount: round2(data.imp_total - data.imp_trib) },
          { label: "Otros tributos", amount: data.imp_trib },
        ]
      : [];
  }
  const rows: TotalsRow[] = [{ label: "Subtotal", amount: data.imp_neto }];
  if (data.imp_tot_conc > 0)
    rows.push({ label: "No gravado", amount: data.imp_tot_conc });
  if (data.imp_op_ex > 0)
    rows.push({ label: "Exento", amount: data.imp_op_ex });
  for (const rate of data.per_rate) {
    rows.push({
      label: `IVA ${ivaRatePercent(rate.id)}%`,
      amount: rate.importe,
    });
  }
  // A header-only invoice whose rate is unknown still shows its IVA.
  if (data.per_rate.length === 0 && data.imp_iva > 0)
    rows.push({ label: "IVA", amount: data.imp_iva });
  if (data.imp_trib > 0)
    rows.push({ label: "Otros tributos", amount: data.imp_trib });
  return rows;
}

/** The unit price a line prints: net on an A voucher, IVA included on a B. */
export function itemUnitPrice(
  data: InvoiceFigures,
  item: InvoiceFiguresItem,
): number {
  if (discriminatesIva(data) || !data.isFiscal || item.quantity === 0) {
    return item.unit_price;
  }
  return round2(item.line_total / item.quantity);
}

/** The line's «Subtotal», on the basis of its unit price and of the totals'
 *  «Subtotal»: the neto on an A voucher, so its lines add up to `imp_neto`;
 *  IVA included on a B. */
export function itemSubtotal(
  data: InvoiceFigures,
  item: InvoiceFiguresItem,
): number {
  return discriminatesIva(data) ? item.line_neto : item.line_total;
}
