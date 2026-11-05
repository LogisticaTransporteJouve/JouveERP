import { formatMoney } from "@/lib/format";

import { PURCHASE_IVA_RATE_PERCENT, type PurchaseIvaRateId } from "../schema";

/** In place of «Cargar con detalle por ítem» on an ARCA voucher: the lines
 *  the purchase is saved with come from ARCA and are not edited here. */
export function ArcaLinesNote({
  lines,
}: {
  lines: { iva_rate_id: PurchaseIvaRateId; neto: number; iva: number }[];
}) {
  if (lines.length === 0) {
    return (
      <p className="rounded-md border bg-muted/10 p-4 text-xs text-muted-foreground">
        Se guarda con los totales que informó ARCA, sin detalle por ítem.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-md border bg-muted/10 p-4">
      <p className="text-xs text-muted-foreground">
        Se guarda con una línea por alícuota, con los importes de ARCA:
      </p>
      <ul className="space-y-1 text-sm">
        {lines.map((l) => (
          <li key={l.iva_rate_id} className="flex justify-between gap-4">
            <span className="shrink-0">
              IVA{" "}
              {PURCHASE_IVA_RATE_PERCENT[l.iva_rate_id].toLocaleString("es-AR")}{" "}
              %
            </span>
            <span className="text-right font-mono tabular-nums">
              neto {formatMoney(l.neto)} · IVA {formatMoney(l.iva)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
