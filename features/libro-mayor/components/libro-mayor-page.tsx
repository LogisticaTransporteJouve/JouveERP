"use client";

import { AlertTriangle, ExternalLink, Undo2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ReadError } from "@/components/read-error";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChartOfAccounts } from "@/features/chart-of-accounts/hooks/use-chart-of-accounts";
import {
  journalSourceHref,
  journalSourceLabel,
} from "@/features/journal-entries/schema";
import { formatArgentineDate, formatNumber2 as money } from "@/lib/format";
import { cn } from "@/lib/utils";

import { LEDGER_MAX_ROWS, useLedger } from "../hooks/use-libro-mayor";
import { computeLedgerSummary } from "../schema";

export function LibroMayorPage() {
  const { data: accounts } = useChartOfAccounts({ onlyActive: true });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const ledger = useLedger(accountId, from || null, to || null);
  const rows = useMemo(() => ledger.data?.rows ?? [], [ledger.data]);
  const truncated = ledger.data?.truncated ?? false;
  const opening = ledger.data?.opening ?? 0;
  const summary = useMemo(
    () => computeLedgerSummary(rows, opening),
    [rows, opening],
  );

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
          Movimientos de una cuenta con saldo acumulado por línea, desde el
          saldo anterior a la fecha &quot;Desde&quot;.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="w-full space-y-1 sm:w-auto">
          <label className="text-xs text-muted-foreground">Cuenta</label>
          <Select value={accountId ?? ""} onValueChange={setAccountId}>
            <SelectTrigger className="w-full sm:w-[360px]">
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
          <DatePicker
            value={from}
            onChange={setFrom}
            className="w-[160px]"
            clearable
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Hasta</label>
          <DatePicker
            value={to}
            onChange={setTo}
            className="w-[160px]"
            clearable
          />
        </div>
      </div>

      {/* Only a read ledger has totals: no 0,00 while it loads or after
          it failed. */}
      {accountId && selectedAccount && ledger.data && (
        <div className="grid grid-cols-3 gap-3">
          <Card label="Total Debe" value={money(summary.totalDebit)} />
          <Card label="Total Haber" value={money(summary.totalCredit)} />
          <Card
            label="Saldo final"
            value={money(summary.finalBalance)}
            emphasize
          />
        </div>
      )}

      {accountId ? (
        // A failed background refetch keeps the rows already read.
        ledger.isError && !ledger.data ? (
          <ReadError
            message={ledger.error.message}
            onRetry={() => void ledger.refetch()}
            className="justify-center rounded-lg border bg-card px-6 py-12"
          />
        ) : !ledger.data ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            Cargando…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
            La cuenta no tiene movimientos en el rango.
            {from && (
              <>
                {" "}
                Saldo anterior al {formatArgentineDate(from)}:{" "}
                <span className="font-mono text-foreground">
                  {money(opening)}
                </span>
                .
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {truncated && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-sm"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Datos parciales: el rango tiene más de {LEDGER_MAX_ROWS}{" "}
                  movimientos y se muestran solo los primeros {LEDGER_MAX_ROWS}.
                  Los totales y el saldo final corresponden a esas líneas, no a
                  todo el rango. Acotá las fechas para ver el resto.
                </span>
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
                  {from && (
                    <tr className="border-b bg-muted/30">
                      <td className="sticky left-0 z-10 bg-card px-2 py-1 font-mono text-xs text-muted-foreground">
                        {formatArgentineDate(from)}
                      </td>
                      <td className="px-2 py-1" />
                      <td className="px-2 py-1 font-medium" colSpan={4}>
                        Saldo anterior
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium">
                        {money(opening)}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => {
                    const debit = Number(r.debit);
                    const credit = Number(r.credit);
                    const running = Number(r.running);
                    const href = journalSourceHref(r.source_table, r.source_id);
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
                            <Link
                              href={href}
                              className="inline-flex items-center gap-1 text-xs hover:underline"
                            >
                              <Badge
                                variant="outline"
                                className="text-xs font-normal"
                              >
                                {journalSourceLabel(r.source_table)}
                              </Badge>
                              <ExternalLink className="size-3" />
                            </Link>
                          ) : r.source_table ? (
                            <Badge
                              variant="outline"
                              className="text-xs font-normal"
                            >
                              {journalSourceLabel(r.source_table)}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
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
                    {/* Only the date column is sticky, as in the body: a
                        wider sticky cell covers the totals on a phone. */}
                    <td className="sticky left-0 z-10 bg-card px-2 py-2 text-xs">
                      Totales
                    </td>
                    <td colSpan={3} className="px-2 py-2 text-right text-xs">
                      {rows.length} movimientos
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
