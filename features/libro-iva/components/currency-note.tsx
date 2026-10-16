import { Info } from "lucide-react";

import { formatMoney, formatMoneyWithCode, formatRate } from "@/lib/format";

import { countSuspectRates, foreignCurrencyTotals } from "../schema";

type CurrencyDoc = Parameters<typeof foreignCurrencyTotals>[0][number];

/** "US$ 121,00" for dollars, "060 121,00" for any other AFIP currency code. */
function originalMoney(amount: number, moneda: string): string {
  return moneda === "DOL" || moneda === "USD"
    ? formatMoney(amount, "USD")
    : formatMoneyWithCode(amount, moneda);
}

/** Original amount + exchange rate of a foreign-currency document; empty for pesos. */
export function OriginalCurrencyCell({
  moneda,
  cotizacion,
  impTotal,
}: {
  moneda: string;
  cotizacion: number;
  impTotal: number;
}) {
  if (moneda === "PES") return null;
  return (
    <span className="inline-flex flex-col items-end whitespace-nowrap">
      <span>{originalMoney(impTotal, moneda)}</span>
      <span className="text-muted-foreground">TC {formatRate(cotizacion)}</span>
    </span>
  );
}

/** What the peso totals include in foreign currency, and documents whose
 *  stored cotizacion leaves them unconverted. Nothing for an all-peso book. */
export function CurrencyNote({ docs }: { docs: readonly CurrencyDoc[] }) {
  const foreign = foreignCurrencyTotals(docs);
  if (foreign.length === 0) return null;
  const suspect = countSuspectRates(docs);
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm">
      <Info className="size-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p>
          Importes en pesos, como en el asiento de cada comprobante: la moneda
          extranjera se convierte con su cotización (o el dólar oficial del día
          si no tiene):
        </p>
        <ul className="font-mono text-xs">
          {foreign.map((f) => (
            <li key={f.moneda}>
              {f.count} en {f.moneda === "DOL" ? "dólares" : f.moneda}:{" "}
              {originalMoney(f.imp_total_orig, f.moneda)} ={" "}
              {formatMoney(f.imp_total_ars)}
            </li>
          ))}
        </ul>
        {suspect > 0 && (
          <p>
            <span className="font-medium">{suspect}</span> comprobante(s) en
            moneda extranjera{" "}
            <span className="font-medium">sin cotización</span> (cotización 1):
            quedan sin convertir. Revisalos antes de presentar.
          </p>
        )}
      </div>
    </div>
  );
}
