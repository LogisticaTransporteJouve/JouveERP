"use client";

import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { formatMoneyWithCode } from "@/lib/format";

import { useSoldChecksExposure } from "../hooks/use-check-sales";

/** Tesorería: sold checks not due yet (contingent: if one bounces the buyer
 *  charges it back) and debts to buyers of rejected sold checks. Nothing
 *  renders when there is neither. */
export function SoldChecksExposureCard() {
  const q = useSoldChecksExposure();
  if (q.isLoading) return <Skeleton className="h-20 w-full" />;
  if (q.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        No se pudo calcular el pasivo por cheques vendidos: {q.error.message}
      </p>
    );
  }
  const data = q.data;
  if (!data || (data.contingent.length === 0 && data.debts.length === 0)) {
    return null;
  }
  return (
    <section className="space-y-2 rounded-md border px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Cheques vendidos</h2>
        <Link
          href="/checks"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          Ver cheques
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <span className="block text-xs text-muted-foreground">
            Pasivo contingente (vendidos sin vencer)
          </span>
          {data.contingent.length === 0 ? (
            <span>—</span>
          ) : (
            data.contingent.map((c) => (
              <span key={c.currency} className="block tabular-nums">
                {formatMoneyWithCode(c.amount, c.currency)} · {c.checks}{" "}
                {c.checks === 1 ? "cheque" : "cheques"}
              </span>
            ))
          )}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">
            Deuda con compradores (rechazados sin debitar)
          </span>
          {data.debts.length === 0 ? (
            <span>—</span>
          ) : (
            data.debts.map((d) => (
              <span key={d.currency} className="block tabular-nums">
                {formatMoneyWithCode(d.amount, d.currency)} · {d.count}{" "}
                {d.count === 1 ? "cheque" : "cheques"}
              </span>
            ))
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Endoso con recurso: si un cheque vendido rebota, el comprador lo
        devuelve. No está en el saldo de las cuentas.
      </p>
    </section>
  );
}
