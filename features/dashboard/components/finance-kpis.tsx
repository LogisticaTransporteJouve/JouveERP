import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneyWithCode,
} from "@/lib/format";

import type { DashboardAgingKpis, DashboardTreasuryKpis } from "../schema";

export function FinanceKpis({
  treasury,
  receivables,
  payables,
}: {
  treasury: DashboardTreasuryKpis | null;
  receivables: DashboardAgingKpis | null;
  payables: DashboardAgingKpis | null;
}) {
  if (!treasury && !receivables && !payables) return null;

  return (
    <section className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {treasury && (
          <KpiTile
            href="/treasury"
            label="Caja ARS"
            value={formatMoneyWithCode(treasury.liquid_now.ARS, "ARS")}
            subtitle="bancos + efectivo + billeteras"
            delta={treasury.liquid_now.ARS - treasury.liquid_prev_eom.ARS}
            deltaCurrency="ARS"
          />
        )}
        {treasury && (
          <KpiTile
            href="/treasury"
            label="Caja USD"
            value={formatMoneyWithCode(treasury.liquid_now.USD, "USD")}
            subtitle={
              treasury.usd_rate
                ? `≈ ${formatMoneyWithCode(
                    treasury.liquid_now.USD * treasury.usd_rate.rate,
                    "ARS",
                  )} · dólar ${formatMoney(treasury.usd_rate.rate)} (${formatArgentineDate(
                    treasury.usd_rate.rate_date,
                  )})`
                : "sin cotización cargada"
            }
            delta={treasury.liquid_now.USD - treasury.liquid_prev_eom.USD}
            deltaCurrency="USD"
          />
        )}
        {receivables && (
          <KpiTile
            href="/aging"
            label="Por cobrar"
            value={formatMoneyWithCode(receivables.total_open, "ARS")}
            subtitle={`${receivables.party_count} clientes · +90 días ${formatMoney(
              receivables.bucket_90_plus,
            )}`}
          />
        )}
        {payables && (
          <KpiTile
            href="/aging-suppliers"
            label="Por pagar"
            value={formatMoneyWithCode(payables.total_open, "ARS")}
            subtitle={`${payables.party_count} proveedores · +90 días ${formatMoney(
              payables.bucket_90_plus,
            )}`}
          />
        )}
      </div>

      {treasury && treasury.checks_now > 0 && (
        <Link
          href="/checks"
          className="block rounded-lg border bg-card p-3 text-sm hover:bg-accent/50"
        >
          Cheques en cartera:{" "}
          <span className="font-mono font-medium">
            {formatMoneyWithCode(treasury.checks_now, "ARS")}
          </span>
          {treasury.checks_due_soon.count > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {treasury.checks_due_soon.count} acreditan ≤ 7 días por{" "}
              <span className="font-mono">
                {formatMoney(treasury.checks_due_soon.amount)}
              </span>
            </span>
          )}
        </Link>
      )}
    </section>
  );
}

function KpiTile({
  href,
  label,
  value,
  subtitle,
  delta,
  deltaCurrency,
}: {
  href: string;
  label: string;
  value: string;
  subtitle: string;
  delta?: number;
  deltaCurrency?: "ARS" | "USD";
}) {
  return (
    <Link href={href} className="rounded-lg border bg-card p-4 hover:bg-accent/50">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold">{value}</p>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{subtitle}</span>
        {delta != null && deltaCurrency && (
          <DeltaBadge delta={delta} currency={deltaCurrency} />
        )}
      </div>
    </Link>
  );
}

function DeltaBadge({
  delta,
  currency,
}: {
  delta: number;
  currency: "ARS" | "USD";
}) {
  if (Math.abs(delta) < 0.01) {
    return (
      <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
        <Minus className="size-3" />
        igual
      </Badge>
    );
  }
  const up = delta > 0;
  return (
    <Badge
      variant="secondary"
      className={`shrink-0 gap-1 font-mono text-[10px] ${
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
    </Badge>
  );
}
