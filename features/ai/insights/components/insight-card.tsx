"use client";

import {
  ClipboardCheck,
  Info,
  OctagonAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { InsightCard as Insight } from "../actions";
import { useSetInsightStatus } from "../hooks/use-insights";
import { buildResolvePrompt } from "../lib/resolve-prompt";
import { IgnoreInsightDialog } from "./ignore-insight-dialog";
import { InsightProposalDialog } from "./insight-proposal-dialog";

const SEVERITY_ICON = {
  info: Info,
  warning: TriangleAlert,
  critical: OctagonAlert,
} as const;

const MONEY_KEY =
  /balance|closing|total|amount|90_plus|in$|out$|loss|interest|cash_change|disbursements|paid$|without_financing/i;
const METRIC_LABELS: Record<string, string> = {
  starting_balance: "Caja hoy",
  total_in: "Entradas",
  total_out: "Salidas",
  lowest_closing: "Saldo más bajo",
  total_90_plus: "+90 días",
  client_count: "Clientes",
  expired: "Vencidos",
  expiring_soon: "Por vencer",
  loss_count: "Viajes",
  total_loss: "Pérdida",
  worst_drop_pts: "Mayor caída (puntos)",
  vehicle_count: "Vehículos",
  worst_rise_pct: "Mayor suba (%)",
  fleet_upper_l100: "Tope típico L/100 km",
  invoice_count: "Comprobantes",
  total_interest: "Interés",
  total_interest_usd: "Interés en dólares",
  no_rate_count: "Sin tasa",
  line_count: "Líneas",
  total_amount: "Monto",
  account_count: "Cuentas",
  shipment_count: "Cargas",
  driver_count: "Choferes",
  draft_count: "Borradores",
  installment_count: "Cuotas",
  overdue_count: "Vencidas",
  total_amount_usd: "En dólares",
  cash_change: "Variación de caja",
  loan_disbursements: "Préstamos recibidos",
  installments_paid: "Cuotas pagadas",
  change_without_financing: "Sin financiamiento",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function formatMetric(key: string, value: number): string {
  if (!MONEY_KEY.test(key)) return value.toLocaleString("es-AR");
  const sign = key.endsWith("_usd") ? "US$" : "$";
  return `${sign}${Math.round(value).toLocaleString("es-AR")}`;
}

function metricChips(
  metrics: unknown,
): { key: string; label: string; value: string }[] {
  if (!isRecord(metrics)) return [];
  return Object.entries(metrics)
    .filter(([key, v]) => typeof v === "number" && key in METRIC_LABELS)
    .slice(0, 4)
    .map(([key, v]) => ({
      key,
      label: METRIC_LABELS[key] ?? key,
      value: formatMetric(key, v as number),
    }));
}

export function InsightCard({
  insight,
  canManage,
  onAsk,
}: {
  insight: Insight;
  canManage: boolean;
  onAsk: (question: string) => void;
}) {
  const setStatus = useSetInsightStatus();
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const Icon =
    SEVERITY_ICON[insight.severity as keyof typeof SEVERITY_ICON] ?? Info;
  const chips = metricChips(insight.metrics);

  function handleAcknowledge() {
    setStatus.mutate(
      { id: insight.id, status: "acknowledged" },
      {
        onError: (err) =>
          toast.error(err instanceof Error ? err.message : "No se pudo."),
      },
    );
  }

  return (
    <Card className={cn(insight.status === "acknowledged" && "opacity-70")}>
      <CardHeader className="flex flex-row items-start gap-2 space-y-0 pb-2">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{insight.title}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pb-2">
        <p className="text-muted-foreground text-sm">{insight.finding}</p>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {chips.map((c) => (
              <span key={c.key} className="text-muted-foreground">
                {c.label}:{" "}
                <span className="text-foreground font-medium tabular-nums">
                  {c.value}
                </span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-wrap gap-2 pt-0">
        {insight.proposal && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setProposalOpen(true)}
          >
            <ClipboardCheck className="size-3.5" />
            {insight.proposal.label}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAsk(buildResolvePrompt(insight))}
        >
          <Sparkles className="size-3.5" />
          Resolver con IA
        </Button>
        {canManage && insight.status === "open" && (
          <Button
            variant="ghost"
            size="sm"
            disabled={setStatus.isPending}
            onClick={handleAcknowledge}
          >
            Visto
          </Button>
        )}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground ml-auto"
            onClick={() => setIgnoreOpen(true)}
          >
            Ignorar
          </Button>
        )}
      </CardFooter>
      {insight.proposal && (
        <InsightProposalDialog
          open={proposalOpen}
          onOpenChange={setProposalOpen}
          insightId={insight.id}
          insightTitle={insight.title}
        />
      )}
      {canManage && (
        <IgnoreInsightDialog
          open={ignoreOpen}
          onOpenChange={setIgnoreOpen}
          insightId={insight.id}
          title={insight.title}
        />
      )}
    </Card>
  );
}
