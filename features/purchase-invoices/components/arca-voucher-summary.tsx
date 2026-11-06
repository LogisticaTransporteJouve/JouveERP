import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { formatArgentineDate, formatMoney } from "@/lib/format";

import { amountOf } from "../lib/header-total";
import {
  PURCHASE_INVOICE_KIND_LABEL,
  formatInvoiceNumber,
  type PurchaseInvoiceKind,
} from "../schema";

const CURRENCY_LABEL: Record<string, string> = {
  PES: "ARS — Peso",
  DOL: "USD — Dólar",
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** The ARCA voucher being accepted, read-only: what ARCA informed and the
 *  purchase is saved with. The supplier slot stays a picker (a new supplier
 *  is created from it). */
export function ArcaVoucherSummary({
  supplier,
  kind,
  letter,
  puntoVenta,
  numero,
  fecha,
  moneda,
  cae,
  caeVto,
  amounts,
  gap,
  linesNote,
}: {
  supplier: ReactNode;
  kind: PurchaseInvoiceKind;
  letter: string;
  puntoVenta: string;
  numero: string;
  fecha: string;
  moneda: string;
  cae: string;
  caeVto: string;
  amounts: {
    imp_neto: string;
    imp_no_gravado: string;
    imp_op_exentas: string;
    imp_iva: string;
    imp_trib: string;
    imp_total: string;
  };
  /** What the total carries above the parts, when ARCA does not detail it. */
  gap: number | null;
  linesNote: ReactNode;
}) {
  const currency = moneda === "DOL" ? "USD" : "ARS";
  const money = (v: string) => formatMoney(amountOf(v), currency);
  const number = formatInvoiceNumber({
    kind,
    letter: letter || null,
    punto_venta: Number(puntoVenta),
    numero: Number(numero),
  });
  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">Comprobante</h3>
      <div className="space-y-4 rounded-md border bg-muted/20 p-4">
        {supplier}
        <dl className="divide-y text-sm">
          <Row label="Número">
            {PURCHASE_INVOICE_KIND_LABEL[kind]}{" "}
            <span className="font-mono">{number}</span>
          </Row>
          <Row label="Fecha">{formatArgentineDate(fecha)}</Row>
          <Row label="Moneda">{CURRENCY_LABEL[moneda] ?? moneda}</Row>
          {cae && (
            <Row label="CAE">
              <span className="font-mono">{cae}</span>
            </Row>
          )}
          {cae && caeVto && (
            <Row label="Vto. CAE">{formatArgentineDate(caeVto)}</Row>
          )}
        </dl>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Importes</h4>
        <dl className="divide-y text-sm">
          <Row label="Neto">
            <span className="font-mono tabular-nums">
              {money(amounts.imp_neto)}
            </span>
          </Row>
          <Row label="No gravado">
            <span className="font-mono tabular-nums">
              {money(amounts.imp_no_gravado)}
            </span>
          </Row>
          <Row label="Exento">
            <span className="font-mono tabular-nums">
              {money(amounts.imp_op_exentas)}
            </span>
          </Row>
          <Row label="IVA">
            <span className="font-mono tabular-nums">
              {money(amounts.imp_iva)}
            </span>
          </Row>
          <Row label="Otros tributos">
            <span className="font-mono tabular-nums">
              {money(amounts.imp_trib)}
            </span>
          </Row>
          <div className="flex items-baseline justify-between gap-4 py-2 font-semibold">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">
              {money(amounts.imp_total)}
            </dd>
          </div>
          {gap !== null && (
            <Row label="Diferencia sin detallar">
              <span className="font-mono tabular-nums">
                {formatMoney(gap, currency)}
              </span>
            </Row>
          )}
        </dl>
        {gap !== null && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            Los importes de ARCA no suman el total: elegí en Imputación a dónde
            va la diferencia.
          </p>
        )}
      </div>
      {linesNote}
    </div>
  );
}
