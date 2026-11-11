"use client";

import { CalendarRange } from "lucide-react";

import { Section } from "@/components/ui/section";
import {
  StatGrid,
  StatNote,
  StatTile,
  StatValue,
} from "@/components/ui/stat-tile";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney, formatMoneySigned, formatPeriod } from "@/lib/format";

import { useChannelSummary } from "../hooks/use-channel-summary";
import { sumChannelSummary, type ChannelSummaryInput } from "../schema";

/** The Resumen of a segregated channel's section: its result per month from
 *  its own journal entries, and what its payment orders paid. */
export function ChannelSummary({ input }: { input: ChannelSummaryInput }) {
  const { data: months } = useChannelSummary(input);
  const totals = sumChannelSummary(months);

  return (
    <div className="grid gap-6">
      <StatGrid>
        <StatTile label="Ventas netas">
          <StatValue>{formatMoney(totals.sales)}</StatValue>
          <StatNote>Netas de IVA, de sus propias cuentas.</StatNote>
        </StatTile>
        <StatTile label="Costos">
          <StatValue>{formatMoney(totals.costs)}</StatValue>
          <StatNote>Compras y gastos del canal, sin IVA.</StatNote>
        </StatTile>
        <StatTile label="Margen">
          <StatValue>{formatMoneySigned(totals.margin)}</StatValue>
          <StatNote>Ventas netas menos costos.</StatNote>
        </StatTile>
        <StatTile label="Pagado a proveedores">
          <StatValue>{formatMoney(totals.payments)}</StatValue>
          <StatNote>
            {totals.pendingUsd > 0
              ? `Más ${formatMoney(totals.pendingUsd, "USD")} sin cotización.`
              : "Órdenes de pago emitidas."}
          </StatNote>
        </StatTile>
      </StatGrid>

      <Section
        title="Por mes"
        icon={CalendarRange}
        description="Desde los asientos del canal: el mismo libro diario, con sus cuentas de ventas y costos."
      >
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">Ventas netas</TableHead>
                <TableHead className="text-right">Costos</TableHead>
                <TableHead className="text-right">Margen</TableHead>
                <TableHead className="text-right">Pagado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((m) => (
                <TableRow key={m.month}>
                  <TableCell className="capitalize">
                    {formatPeriod(m.month)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(m.sales)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(m.costs)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoneySigned(m.margin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(m.payments)}
                    {m.pendingUsd > 0 &&
                      ` + ${formatMoney(m.pendingUsd, "USD")}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(totals.sales)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(totals.costs)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoneySigned(totals.margin)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(totals.payments)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </Section>
    </div>
  );
}
