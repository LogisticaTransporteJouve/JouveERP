"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { ListSearch, ListToolbar } from "@/components/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
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

  const columns = useMemo<ColumnDef<TreasuryAccountRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Cuenta",
        cell: ({ row }) => (
          <Link
            href={`/transactions?account=${row.original.id}`}
            className="font-medium hover:underline"
            title="Ver movimientos y registrar nuevo"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: "type",
        header: "Tipo",
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs font-normal">
            {ACCOUNT_TYPE_LABEL[row.original.type]}
          </Badge>
        ),
      },
      {
        accessorKey: "currency",
        header: "Moneda",
        cell: ({ row }) => (
          <span className="text-xs">{row.original.currency}</span>
        ),
      },
      {
        accessorKey: "balance_now",
        header: "Saldo actual",
        meta: { align: "right" },
        cell: ({ row }) => {
          const acc = row.original;
          const isLiquid = isLiquidAccountType(acc.type);
          const isCheck = isCheckAccountType(acc.type);
          return (
            <span
              className={`font-mono ${isCheck ? "text-muted-foreground" : ""} ${
                !isLiquid && !isCheck ? "text-muted-foreground" : ""
              }`}
            >
              {formatMoneyWithCode(acc.balance_now, acc.currency)}
            </span>
          );
        },
      },
      {
        id: "delta",
        header: "Cambio del mes",
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const acc = row.original;
          const delta = acc.balance_now - acc.balance_prev_eom;
          if (Math.abs(delta) < 0.01) {
            return <span className="text-xs text-muted-foreground">—</span>;
          }
          return (
            <Badge
              variant="secondary"
              className={`gap-1 font-mono text-[10px] ${
                delta > 0
                  ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                  : "bg-muted text-foreground dark:text-foreground"
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
          );
        },
      },
      {
        accessorKey: "last_movement_date",
        header: "Último mov.",
        meta: { cellClassName: "text-xs text-muted-foreground" },
        cell: ({ row }) =>
          row.original.last_movement_date
            ? formatArgentineDate(row.original.last_movement_date)
            : "—",
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tesorería</h1>
        <p className="text-sm text-muted-foreground">
          Caja real (todos los canales): no cambia con el alcance elegido
          arriba. Liquidez actual por moneda y por cuenta. Saldos calculados en
          vivo desde transacciones; el delta compara con el cierre del mes
          anterior.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label="Total ARS líquido"
          subtitle="bancos + efectivo + billeteras"
          now={query.data?.liquid_now.ARS}
          prev={query.data?.liquid_prev_eom.ARS}
          currency="ARS"
          loading={query.isLoading}
        />
        <SummaryCard
          label="Total USD líquido"
          subtitle="bancos + efectivo + billeteras"
          now={query.data?.liquid_now.USD}
          prev={query.data?.liquid_prev_eom.USD}
          currency="USD"
          loading={query.isLoading}
          usdRate={query.data?.usd_rate ?? null}
        />
        <SummaryCard
          label="Cheques en cartera ARS"
          subtitle={
            query.data
              ? `${query.data.checks_due_soon.count} acreditan ≤ 7 días`
              : "—"
          }
          now={query.data?.checks_now}
          prev={query.data?.checks_prev_eom}
          currency="ARS"
          loading={query.isLoading}
          tone="muted"
        />
      </div>

      {/* Soon to be credited — only if any */}
      {query.data && query.data.checks_due_soon.count > 0 && (
        <div className="rounded-lg border bg-muted p-4 text-sm">
          <p className="font-medium text-muted-foreground dark:text-muted-foreground">
            Próximos a acreditarse (≤ 7 días)
          </p>
          <p className="mt-1 text-muted-foreground">
            {query.data.checks_due_soon.count} cheques por{" "}
            <span className="font-mono">
              {formatMoney(query.data.checks_due_soon.amount)}
            </span>
          </p>
        </div>
      )}

      {/* Filters + table */}
      <ListToolbar
        isFiltered={
          search.trim() !== "" || currencyFilter !== ANY || typeFilter !== ANY
        }
        onClear={() => {
          setSearch("");
          setCurrencyFilter(ANY);
          setTypeFilter(ANY);
        }}
        actions={
          query.data && (
            <span className="text-sm text-muted-foreground">
              {filtered.length} de {query.data.accounts.length}
            </span>
          )
        }
      >
        <ListSearch
          placeholder="Buscar cuenta"
          value={search}
          onChange={setSearch}
        />
        <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Moneda">
            <SelectValue placeholder="Moneda" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todas las monedas</SelectItem>
            <SelectItem value="ARS">ARS</SelectItem>
            <SelectItem value="USD">USD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[220px]" aria-label="Tipo">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Todos los tipos</SelectItem>
            {(
              [
                "bank",
                "cash",
                "wallet",
                "investment",
                "checks",
                "echeq",
              ] as AccountType[]
            ).map((t) => (
              <SelectItem key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ListToolbar>

      <DataTable
        columns={columns}
        data={filtered}
        getRowId={(acc) => acc.id}
        isLoading={query.isLoading}
        skeletonRows={3}
        emptyMessage="Sin cuentas para el filtro actual."
      />
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
  // ARS equivalent only for USD cards, if an exchange rate is loaded.
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
          ? "bg-muted text-muted-foreground dark:text-muted-foreground"
          : "bg-muted text-foreground dark:text-foreground"
      }`}
    >
      {up ? (
        <ArrowUpRight className="size-3" />
      ) : (
        <ArrowDownRight className="size-3" />
      )}
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
