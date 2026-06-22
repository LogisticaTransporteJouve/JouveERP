"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ACCOUNT_TYPE_LABEL,
  type AccountType,
} from "@/features/accounts/schema";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneyWithCode,
} from "@/lib/format";

import { useTreasurySummary } from "../hooks/use-treasury";
import {
  isCheckAccountType,
  isLiquidAccountType,
  type TreasuryAccountRow,
  type TreasuryCurrency,
} from "../schema";

const ANY = "__any__";

export function TreasuryPage() {
  const query = useTreasurySummary();
  const [search, setSearch] = useState("");
  const [currencyFilter, setCurrencyFilter] = useState<string>(ANY);
  const [typeFilter, setTypeFilter] = useState<string>(ANY);

  const filtered = useMemo(() => {
    const rows = query.data?.accounts ?? [];
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (currencyFilter !== ANY && r.currency !== currencyFilter) return false;
      if (typeFilter !== ANY && r.type !== typeFilter) return false;
      if (term && !r.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [query.data, search, currencyFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tesorería</h1>
        <p className="text-sm text-muted-foreground">
          Liquidez actual por moneda y por cuenta. Saldos calculados en vivo
          desde transacciones; el delta compara con el cierre del mes anterior.
        </p>
      </div>

      {/* Cards de resumen */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Total ARS líquido"
          subtitle="bancos + efectivo + billeteras"
          now={query.data?.totals_now.ARS.liquid}
          prev={query.data?.totals_prev_eom.ARS.liquid}
          currency="ARS"
          loading={query.isLoading}
        />
        <SummaryCard
          label="Total USD líquido"
          subtitle="bancos + efectivo + billeteras"
          now={query.data?.totals_now.USD.liquid}
          prev={query.data?.totals_prev_eom.USD.liquid}
          currency="USD"
          loading={query.isLoading}
          usdRate={query.data?.usd_rate ?? null}
        />
        <SummaryCard
          label="Cheques en cartera ARS"
          subtitle={
            query.data
              ? `${query.data.checks_due_soon.ARS.count} acreditan ≤ 7 días`
              : "—"
          }
          now={query.data?.totals_now.ARS.checks}
          prev={query.data?.totals_prev_eom.ARS.checks}
          currency="ARS"
          loading={query.isLoading}
          tone="muted"
        />
        <SummaryCard
          label="Cheques en cartera USD"
          subtitle={
            query.data
              ? `${query.data.checks_due_soon.USD.count} acreditan ≤ 7 días`
              : "—"
          }
          now={query.data?.totals_now.USD.checks}
          prev={query.data?.totals_prev_eom.USD.checks}
          currency="USD"
          loading={query.isLoading}
          tone="muted"
          usdRate={query.data?.usd_rate ?? null}
        />
      </div>

      {/* Próximos a acreditarse — solo si hay */}
      {query.data &&
        (query.data.checks_due_soon.ARS.count > 0 ||
          query.data.checks_due_soon.USD.count > 0) && (
          <div className="rounded-lg border bg-amber-500/5 p-4 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-400">
              Próximos a acreditarse (≤ 7 días)
            </p>
            <p className="mt-1 text-muted-foreground">
              {query.data.checks_due_soon.ARS.count > 0 && (
                <>
                  {query.data.checks_due_soon.ARS.count} cheques ARS por{" "}
                  <span className="font-mono">
                    {formatMoney(query.data.checks_due_soon.ARS.amount)}
                  </span>
                  {query.data.checks_due_soon.USD.count > 0 ? " · " : ""}
                </>
              )}
              {query.data.checks_due_soon.USD.count > 0 && (
                <>
                  {query.data.checks_due_soon.USD.count} cheques USD por{" "}
                  <span className="font-mono">
                    {formatMoney(query.data.checks_due_soon.USD.amount, "USD")}
                  </span>
                </>
              )}
            </p>
          </div>
        )}

      {/* Filtros + tabla */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Buscar cuenta…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Moneda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todas las monedas</SelectItem>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos los tipos</SelectItem>
            {(
              ["bank", "cash", "wallet", "investment", "checks", "echeq"] as AccountType[]
            ).map((t) => (
              <SelectItem key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {query.data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {filtered.length} de {query.data.accounts.length}
          </span>
        )}
      </div>

      <div className="rounded-lg border bg-card">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Sin cuentas para el filtro actual.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead className="text-right">Saldo actual</TableHead>
                <TableHead className="text-right">Cambio del mes</TableHead>
                <TableHead>Último mov.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((acc) => (
                <AccountRow key={acc.id} acc={acc} />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  subtitle,
  now,
  prev,
  currency,
  loading,
  tone,
  usdRate,
}: {
  label: string;
  subtitle: string;
  now: number | undefined;
  prev: number | undefined;
  currency: TreasuryCurrency;
  loading: boolean;
  tone?: "muted";
  usdRate?: { rate: number; rate_date: string } | null;
}) {
  const delta = now != null && prev != null ? now - prev : null;
  const pct = delta != null && prev ? (delta / prev) * 100 : null;
  // Equivalente en ARS solo para tarjetas USD, si hay cotización cargada.
  const arsEquivalent =
    currency === "USD" && usdRate && now != null ? now * usdRate.rate : null;

  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      {loading ? (
        <Skeleton className="my-2 h-7 w-32" />
      ) : (
        <p
          className={`mt-1 font-mono text-2xl font-semibold ${
            tone === "muted" ? "text-muted-foreground" : ""
          }`}
        >
          {formatMoneyWithCode(now ?? 0, currency)}
        </p>
      )}
      {!loading && arsEquivalent != null && usdRate && (
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
          ≈ {formatMoneyWithCode(arsEquivalent, "ARS")}
          <span className="ml-1 font-sans">
            · dólar {formatMoney(usdRate.rate)} (
            {formatArgentineDate(usdRate.rate_date)})
          </span>
        </p>
      )}
      <div className="mt-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{subtitle}</span>
        {delta != null && (
          <DeltaBadge delta={delta} pct={pct} currency={currency} />
        )}
      </div>
    </div>
  );
}

function DeltaBadge({
  delta,
  pct,
  currency,
}: {
  delta: number;
  pct: number | null;
  currency: TreasuryCurrency;
}) {
  if (Math.abs(delta) < 0.01) {
    return (
      <Badge variant="secondary" className="gap-1 text-[10px]">
        <Minus className="size-3" />
        igual
      </Badge>
    );
  }
  const up = delta > 0;
  return (
    <Badge
      variant="secondary"
      className={`gap-1 text-[10px] ${
        up
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
      }`}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? "+" : ""}
      {formatMoney(delta, currency)}
      {pct != null && Number.isFinite(pct) && (
        <span className="text-muted-foreground">
          ({pct >= 0 ? "+" : ""}
          {pct.toFixed(1)}%)
        </span>
      )}
    </Badge>
  );
}

function AccountRow({ acc }: { acc: TreasuryAccountRow }) {
  const delta = acc.balance_now - acc.balance_prev_eom;
  const isLiquid = isLiquidAccountType(acc.type);
  const isCheck = isCheckAccountType(acc.type);

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          href={`/transactions?account=${acc.id}`}
          className="hover:underline"
          title="Ver movimientos y registrar nuevo"
        >
          {acc.name}
        </Link>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs font-normal">
          {ACCOUNT_TYPE_LABEL[acc.type]}
        </Badge>
      </TableCell>
      <TableCell className="text-xs">{acc.currency}</TableCell>
      <TableCell
        className={`text-right font-mono ${
          isCheck ? "text-muted-foreground" : ""
        } ${!isLiquid && !isCheck ? "text-muted-foreground" : ""}`}
      >
        {formatMoneyWithCode(acc.balance_now, acc.currency)}
      </TableCell>
      <TableCell className="text-right">
        {Math.abs(delta) < 0.01 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <Badge
            variant="secondary"
            className={`gap-1 font-mono text-[10px] ${
              delta > 0
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
            }`}
          >
            {delta > 0 ? (
              <ArrowUpRight className="size-3" />
            ) : (
              <ArrowDownRight className="size-3" />
            )}
            {delta > 0 ? "+" : ""}
            {formatMoney(delta, acc.currency)}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {acc.last_movement_date
          ? formatArgentineDate(acc.last_movement_date)
          : "—"}
      </TableCell>
    </TableRow>
  );
}
