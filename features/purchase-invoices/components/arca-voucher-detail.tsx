"use client";

import { formatCuit } from "@/lib/validation/cuit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ivaRatePercent } from "@/lib/afip/codes";
import { formatArgentineDate, formatMoney } from "@/lib/format";

import {
  arcaGapTargetLabel,
  receivedGapText,
  receivedVoucherGap,
} from "../lib/arca-received-draft";
import type { ReceivedVoucher } from "../schema";

const TRIBUTES = [
  ["perc_iva", "Percepción de IVA"],
  ["perc_nacionales", "Percepción Ganancias y otros nacionales"],
  ["perc_iibb", "Percepción de IIBB"],
  ["municipales", "Impuestos municipales"],
  ["internos", "Impuestos internos"],
] as const;

const percentLabel = (p: number) =>
  `${p.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1.5 text-sm ${strong ? "font-medium" : ""}`}
    >
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

/** What ARCA lists for a received voucher: identity and every amount, so
 *  it can be checked before accepting. */
export function ArcaVoucherDetailDialog({
  voucher: v,
  number,
  onClose,
}: {
  voucher: ReceivedVoucher;
  number: string;
  onClose: () => void;
}) {
  const currency = v.moneda === "DOL" ? "USD" : "ARS";
  const money = (n: number) => formatMoney(n, currency);
  const tributes = TRIBUTES.flatMap(([key, label]) => {
    const value = v.trib_breakdown[key];
    return value ? [{ label, value }] : [];
  });
  const bOrC = v.letter === "B" || v.letter === "C";
  const gap = receivedVoucherGap(v);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-mono">{number}</DialogTitle>
          <DialogDescription>
            {v.issuer_name} · CUIT {formatCuit(v.issuer_cuit)}
          </DialogDescription>
        </DialogHeader>

        <dl className="divide-y">
          <Line label="Fecha" value={formatArgentineDate(v.fecha)} />
          <Line label="CAE" value={v.cae ?? "—"} />
          {v.moneda === "DOL" && (
            <Line
              label="Moneda"
              value={`USD${v.cotizacion ? ` · cotización ${v.cotizacion}` : ""}`}
            />
          )}
        </dl>

        <dl className="divide-y">
          {v.iva_breakdown.map((l) => (
            <div key={l.iva_rate_id}>
              <Line
                label={`Neto gravado ${percentLabel(ivaRatePercent(l.iva_rate_id))}`}
                value={money(l.neto)}
              />
              <Line
                label={`IVA ${percentLabel(ivaRatePercent(l.iva_rate_id))}`}
                value={money(l.iva)}
              />
            </div>
          ))}
          <Line label="Neto gravado" value={money(v.imp_neto_gravado)} />
          <Line label="No gravado" value={money(v.imp_no_gravado)} />
          <Line label="Exento" value={money(v.imp_op_exentas)} />
          <Line label="IVA" value={money(v.imp_iva)} />
          <Line label="Otros tributos" value={money(v.imp_trib)} />
          {tributes.map((t) => (
            <Line key={t.label} label={`· ${t.label}`} value={money(t.value)} />
          ))}
          <Line label="Total" value={money(v.imp_total)} strong />
          {gap !== null && (
            <Line label="Diferencia sin detallar" value={money(gap)} />
          )}
        </dl>

        <div className="space-y-1 text-xs text-muted-foreground">
          {gap !== null && (
            <p>
              {`${receivedGapText(gap, v.moneda)}. Al aceptar elegís si va a otros tributos o a ${arcaGapTargetLabel("no_gravado", v.letter).toLowerCase()}.`}
            </p>
          )}
          {bOrC && (
            <p>
              En facturas {v.letter} el IVA no se discrimina: va todo en el
              neto.
            </p>
          )}
          {v.imp_trib > 0 && tributes.length === 0 && (
            <p>
              ARCA informa solo el total de otros tributos. Al aceptar lo
              repartís entre percepción de IVA, Ganancias y otros nacionales,
              IIBB, municipales e internos.
            </p>
          )}
          <p>
            Los importes son los que el proveedor informó a ARCA y no se
            modifican. Al aceptar elegís cuenta y el reparto de otros tributos.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
