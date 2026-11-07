"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";

import { ReadError } from "@/components/read-error";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmployeeCashDialog } from "@/features/hr/components/employee-cash-dialog";
import { PayDialog } from "@/features/payment-orders/components/pay-dialog";
import { CollectDialog } from "@/features/receipts/components/collect-dialog";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneyWithCode,
} from "@/lib/format";

import { useTreasurySummary } from "../hooks/use-treasury";
import type { TreasuryCurrency } from "../schema";

/** `canCollect` / `canPay`: receipts:write / payment_orders:write, for the
 *  "Cobrar a cliente" / "Pagar a proveedor" entry points; `canAdvance`:
 *  hr:write + transactions:write, for "Adelanto a empleado". */
export function TreasuryPage({
  canCollect = false,
  canPay = false,
  canAdvance = false,
  canEditRetentions = false,
}: {
  canCollect?: boolean;
  canPay?: boolean;
  canAdvance?: boolean;
  /** retentions:write, for the "Cobrar a cliente" receipt form. */
  canEditRetentions?: boolean;
}) {
  const query = useTreasurySummary();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tesorería</h1>
          <p className="text-sm text-muted-foreground">
            Liquidez actual por moneda y cheques en cartera, en vivo desde los
            movimientos; el cambio compara con el cierre del mes anterior.
          </p>
        </div>
        {(canCollect || canPay || canAdvance) && (
          <div className="flex flex-wrap gap-2">
            {canCollect && (
              <CollectDialog canEditRetentions={canEditRetentions} />
            )}
            {canPay && <PayDialog />}
            {canAdvance && <EmployeeCashDialog kind="advance" />}
            {canAdvance && <EmployeeCashDialog kind="loan" />}
          </div>
        )}
      </div>

      {query.isError && !query.data ? (
        <ReadError
          message="No se pudo cargar el resumen de tesorería."
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
            {query.data &&
              (query.data.checks_usd_now !== 0 ||
                query.data.checks_usd_prev_eom !== 0) && (
                <SummaryCard
                  label="Cheques en cartera USD"
                  subtitle="cheques y e-cheq en dólares"
                  now={query.data.checks_usd_now}
                  prev={query.data.checks_usd_prev_eom}
                  currency="USD"
                  loading={false}
                  tone="muted"
                />
              )}
          </div>

          {/* Soon to be credited — only if any */}
          {query.data && query.data.checks_due_soon.count > 0 && (
            <div className="rounded-lg border bg-muted p-4 text-sm">
              <p className="font-medium text-muted-foreground dark:text-muted-foreground">
                Próximos a acreditarse (≤ 7 días)
              </p>
              <p className="mt-1 text-muted-foreground">
                {query.data.checks_due_soon.count} cheques en pesos por{" "}
                <span className="font-mono">
                  {formatMoneyWithCode(
                    query.data.checks_due_soon.amount,
                    "ARS",
                  )}
                </span>
              </p>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            El saldo de cada cuenta está en{" "}
            <Link href="/accounts" className="underline">
              Cuentas
            </Link>
            .
          </p>
        </>
      )}
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
