import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";

import {
  StatGrid,
  StatNote,
  StatTile,
  StatValue,
} from "@/components/ui/stat-tile";
import { formatCurrencyAmounts } from "@/lib/aging";
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
      <StatGrid>
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
          <AgingKpiTile
            href="/aging"
            label="Por cobrar"
            kpis={receivables}
            partyPlural="clientes"
          />
        )}
        {payables && (
          <AgingKpiTile
            href="/aging-suppliers"
            label="Por pagar"
            kpis={payables}
            partyPlural="proveedores"
          />
        )}
      </StatGrid>

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

/** Receivables / payables: one ARS figure (dollars at the latest official
 *  rate) with the per-currency split underneath when there are dollars. */
function AgingKpiTile({
  href,
  label,
  kpis,
  partyPlural,
}: {
  href: string;
  label: string;
  kpis: DashboardAgingKpis;
  partyPlural: string;
}) {
  const hasUsd = kpis.total.usd !== 0;
  const value =
    hasUsd && kpis.total_ars_equivalent !== null
      ? `≈ ${formatMoneyWithCode(kpis.total_ars_equivalent, "ARS")}`
      : formatMoneyWithCode(kpis.total.ars, "ARS");
  const detail = hasUsd
    ? kpis.total_ars_equivalent !== null
      ? formatCurrencyAmounts(kpis.total)
      : `${formatCurrencyAmounts(kpis.total)} · sin cotización cargada`
    : undefined;
  return (
    <KpiTile
      href={href}
      label={label}
      value={value}
      detail={detail}
      subtitle={`${kpis.party_count} ${partyPlural} · +90 días ${formatCurrencyAmounts(
        kpis.bucket_90_plus,
      )}`}
    />
  );
}

function KpiTile({
  href,
  label,
  value,
  detail,
  subtitle,
  delta,
  deltaCurrency,
}: {
  href: string;
  label: string;
  value: string;
  detail?: string;
  subtitle: string;
  delta?: number;
  deltaCurrency?: "ARS" | "USD";
}) {
  return (
    <StatTile href={href} label={label}>
      <StatValue>{value}</StatValue>
      {delta != null && deltaCurrency && (
        <Delta delta={delta} currency={deltaCurrency} />
      )}
      {detail && <StatNote className="truncate">{detail}</StatNote>}
      <StatNote className="truncate">{subtitle}</StatNote>
    </StatTile>
  );
}

// Monochrome: the direction reads from the arrow and the sign, not a color.
function Delta({
  delta,
  currency,
}: {
  delta: number;
  currency: "ARS" | "USD";
}) {
  const flat = Math.abs(delta) < 0.01;
  const up = delta > 0;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <p className="flex items-center gap-1 text-xs font-medium tabular-nums">
      <Icon aria-hidden className="size-3.5" />
      {flat
        ? "Igual que el cierre del mes pasado"
        : `${up ? "+" : ""}${formatMoney(delta, currency)} vs. cierre del mes pasado`}
    </p>
  );
}
