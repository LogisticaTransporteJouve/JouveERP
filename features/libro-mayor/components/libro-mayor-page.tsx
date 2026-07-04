"use client";

import { ExternalLink, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChartOfAccounts } from "@/features/chart-of-accounts/hooks/use-chart-of-accounts";
import {
  SOURCE_HREF_PREFIX,
  SOURCE_LABEL,
  isKnownSource,
} from "@/features/journal-entries/schema";
import { formatArgentineDate, formatNumber2 as money } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useLedger } from "../hooks/use-libro-mayor";
import { computeLedgerSummary } from "../schema";

export function LibroMayorPage() {
  const { data: accounts } = useChartOfAccounts({ onlyActive: true });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const ledger = useLedger(accountId, from || null, to || null);
  const rows = ledger.data?.rows ?? [];
  const truncated = ledger.data?.truncated ?? false;
  const summary = useMemo(() => computeLedgerSummary(rows), [rows]);

  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort((a, b) => {
        // Numeric sort by code segments
        const pa = a.code.split(".").map(Number);
        const pb = b.code.split(".").map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          const av = pa[i] ?? 0,
            bv = pb[i] ?? 0;
          if (av !== bv) return av - bv;
        }
        return 0;
      }),
    [accounts],
  );

  const selectedAccount = accounts.find((a) => a.id === accountId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Libro mayor</h1>
        <p className="text-sm text-muted-foreground">
          Movimientos de una cuenta con saldo running por línea.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Cuenta</label>
          <Select value={accountId ?? ""} onValueChange={setAccountId}>
            <SelectTrigger className="w-[360px]">
              <SelectValue placeholder="Elegí una cuenta" />
            </SelectTrigger>
            <SelectContent>
              {sortedAccounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  <span className="font-mono text-xs">{a.code}</span> {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Desde</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-[160px]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Hasta</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-[160px]"
          />
        </div>
      </div>

      {accountId && selectedAccount && (
        <div className="grid grid-cols-3 gap-3">
          <Card label="Total Debe" value={money(summary.totalDebit)} />
          <Card label="Total Haber" value={money(summary.totalCredit)} />
          <Card label="Saldo final" value={money(summary.finalBalance)} emphasize />
        </div>
      )}

      {accountId ? (
        ledger.isLoading ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            La cuenta no tiene movimientos en el rango.
          </div>
        ) : (
          <div className="space-y-3">
            {truncated && (
              <div className="rounded-lg border border-border bg-muted p-3 text-sm">
                ⚠ La cuenta tiene más de 1000 movimientos. Mostrando los
                primeros 1000 — filtrá por rango de fechas para ver el
                resto.
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-left text-xs">
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-2 py-2 font-medium">
                    Fecha
                  </th>
                  <th className="px-2 py-2 font-medium">Período</th>
                  <th className="px-2 py-2 font-medium">Descripción</th>
                  <th className="px-2 py-2 font-medium">Origen</th>
                  <th className="px-2 py-2 text-right font-medium">Debe</th>
                  <th className="px-2 py-2 text-right font-medium">Haber</th>
                  <th className="px-2 py-2 text-right font-medium">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const debit = Number(r.debit);
                  const credit = Number(r.credit);
                  const running = Number(r.running);
                  const href =
                    isKnownSource(r.source_table) && r.source_id
                      ? `${SOURCE_HREF_PREFIX[r.source_table]}/${r.source_id}`
                      : null;
                  return (
                    <tr
                      key={r.line_id}
                      className={cn(
                        "group border-b last:border-b-0 hover:bg-muted/20",
                        r.is_reversal && "bg-muted",
                      )}
                    >
                      <td className="sticky left-0 z-10 bg-card px-2 py-1 font-mono text-xs text-muted-foreground group-hover:bg-muted/20">
                        {formatArgentineDate(r.entry_date)}
                      </td>
                      <td className="px-2 py-1 font-mono text-xs text-muted-foreground">
                        {r.accrual_period}
                      </td>
                      <td className="px-2 py-1">
                        {r.is_reversal && (
                          <Undo2 className="mr-1 inline-block size-3 text-foreground" />
                        )}
                        <span title={r.line_desc ?? ""}>{r.description}</span>
                      </td>
                      <td className="px-2 py-1">
                        {href ? (
                          <Link href={href} className="inline-flex items-center gap-1 text-xs hover:underline">
                            <Badge variant="outline" className="text-xs font-normal">
                              {isKnownSource(r.source_table)
                                ? SOURCE_LABEL[r.source_table]
                                : r.source_table}
                            </Badge>
                            <ExternalLink className="size-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {debit > 0 ? money(debit) : ""}
                      </td>
                      <td className="px-2 py-1 text-right font-mono">
                        {credit > 0 ? money(credit) : ""}
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium">
                        {money(running)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 bg-muted/30 font-semibold">
                <tr>
                  <td colSpan={4} className="sticky left-0 z-10 bg-card px-2 py-2 text-right text-xs">
                    Totales ({rows.length} movimientos)
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {money(summary.totalDebit)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {money(summary.totalCredit)}
                  </td>
                  <td className="px-2 py-2 text-right font-mono">
                    {money(summary.finalBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          </div>
        )
      ) : (
        <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          Elegí una cuenta para ver sus movimientos.
        </div>
      )}
    </div>
  );
}

function Card({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        emphasize && "border-foreground/20 bg-muted/20",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-xl", emphasize && "font-semibold")}>
        {value}
      </p>
    </div>
  );
}
