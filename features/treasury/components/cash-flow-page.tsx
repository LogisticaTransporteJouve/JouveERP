"use client";

import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

import { useCashFlow } from "../hooks/use-treasury";
import type { MonthFlow } from "../lib/cash-flow";
import { CASH_FLOW_MONTHS } from "../lib/treasury-queries";

const MES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MES[Number(m) - 1]} ${y}`;
}

/** total + muted "F · I · O" breakdown. */
function Amount({
  total,
  facturado,
  interno,
  otro,
}: {
  total: number;
  facturado: number;
  interno: number;
  otro: number;
}) {
  if (total === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="text-right">
      <div className="font-mono tabular-nums">{formatMoney(total)}</div>
      <div className="text-muted-foreground text-[10px]">
        F {formatMoney(facturado)} · I {formatMoney(interno)}
        {otro > 0 ? ` · O ${formatMoney(otro)}` : ""}
      </div>
    </div>
  );
}

export function CashFlowPage() {
  const { data, isLoading } = useCashFlow(
    CASH_FLOW_MONTHS.back,
    CASH_FLOW_MONTHS.fwd,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Flujo de caja</h1>
        <p className="text-muted-foreground text-sm">
          Mensual, para control interno — incluye lo facturado (F, canal fiscal)
          y lo interno (I, canal interno). Los meses pasados son reales; los
          futuros, proyectados.
        </p>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-6 rounded-lg border bg-card p-4">
            <div>
              <div className="text-muted-foreground text-xs">
                Saldo de caja hoy
              </div>
              <div className="font-mono text-2xl font-semibold tabular-nums">
                {formatMoney(data.cashToday)}
              </div>
            </div>
            {data.deficitMonth && (
              <div className="ml-auto flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                Te quedarías en negativo en{" "}
                <span className="font-medium">
                  {monthLabel(data.deficitMonth)}
                </span>{" "}
                (mínimo {formatMoney(data.lowestClosing ?? 0)}).
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Salidas</TableHead>
                  <TableHead className="text-right">Neto</TableHead>
                  <TableHead className="text-right">Saldo proyectado</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.months.map((m: MonthFlow) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">
                      {monthLabel(m.month)}
                    </TableCell>
                    <TableCell>
                      <Amount
                        total={m.inTotal}
                        facturado={m.inFacturado}
                        interno={m.inInterno}
                        otro={m.inOtro}
                      />
                    </TableCell>
                    <TableCell>
                      <Amount
                        total={m.outTotal}
                        facturado={m.outFacturado}
                        interno={m.outInterno}
                        otro={m.outOtro}
                      />
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        m.net < 0 && "text-destructive",
                      )}
                    >
                      {formatMoney(m.net)}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono tabular-nums",
                        m.closing !== null &&
                          m.closing < 0 &&
                          "text-destructive",
                      )}
                    >
                      {m.closing === null ? "—" : formatMoney(m.closing)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={m.realized ? "secondary" : "outline"}>
                        {m.realized ? "Realizado" : "Proyectado"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-muted-foreground text-xs">
            F = facturado (canal fiscal) · I = interno · O = otros (cheques en
            cartera). Cobranzas, pagos a proveedores y cuotas de préstamos se
            proyectan por su fecha de vencimiento; lo ya vencido se ubica en{" "}
            {monthLabel(data.pendingMonth)}.{" "}
            {data.usdRate !== null
              ? `Todo en ARS; lo que está en USD se convierte al TC oficial ($${data.usdRate.toLocaleString("es-AR")}).`
              : "Solo ARS (sin cotización USD cargada)."}
          </p>
        </>
      )}
    </div>
  );
}
