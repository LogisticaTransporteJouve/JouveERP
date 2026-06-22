"use client";

import { Lock, Unlock } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";

import {
  useClosePayrollPeriod,
  usePayrollPeriod,
  useReopenPayrollPeriod,
  useUpdatePayrollEntry,
} from "../hooks/use-payroll";
import {
  PAYROLL_STATUS_LABEL,
  formatPayrollPeriod,
} from "../payroll-schema";

import { BulkPayrollPaymentDialog } from "./bulk-payroll-payment-dialog";
import { InlineMoneyInput } from "./inline-money-input";
import { PayrollExtrasDialog } from "./payroll-extras-dialog";
import { PayrollPaymentsDialog } from "./payroll-payments-dialog";

import { formatMoney } from "@/lib/format";

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return formatMoney(n);
}

export function PayrollPeriodGrid({
  year,
  month,
  actorRoles,
}: {
  year: number;
  month: number;
  actorRoles: Role[];
}) {
  const { data } = usePayrollPeriod(year, month);
  const updateMut = useUpdatePayrollEntry();
  const closeMut = useClosePayrollPeriod();
  const reopenMut = useReopenPayrollPeriod();
  const { channels } = useScope();

  const canWrite = userCan(actorRoles, "hr:write");
  const canAdmin = userCan(actorRoles, "hr:admin");

  const period = data.period;
  const entries = data.entries;
  const isClosed = period?.status === "closed";
  const canEdit = canWrite && !!period && !isClosed;
  // Payments can be recorded even when the period is closed (that's the
  // idea: you lock the amounts and then pay in installments). It only
  // requires hr:write.
  const canManagePayments = canWrite && !!period;

  const activeChannels = useMemo(
    () => channels.filter((c) => c.is_active),
    [channels],
  );
  const bulkEmployees = useMemo(
    () =>
      entries.map((e) => ({
        entry_id: e.id,
        employee_id: e.employee_id,
        employee_name: e.employee_legal_name,
        saldo: e.saldo ?? 0,
      })),
    [entries],
  );

  function commit(
    entryId: string,
    field:
      | "sueldo_neto"
      | "vacaciones_monto"
      | "viaticos"
      | "deudas"
      | "telefono",
    value: number,
  ) {
    return new Promise<void>((resolve, reject) => {
      updateMut.mutate(
        {
          id: entryId,
          [field]: value,
          period_year: year,
          period_month: month,
        },
        {
          onSuccess: () => resolve(),
          onError: (err) => {
            toast.error(err.message);
            reject(err);
          },
        },
      );
    });
  }

  const totals = entries.reduce(
    (acc, e) => ({
      sueldo: acc.sueldo + e.sueldo_neto,
      extras: acc.extras + e.extras_total,
      vacaciones: acc.vacaciones + e.vacaciones_monto,
      viaticos: acc.viaticos + e.viaticos,
      deudas: acc.deudas + e.deudas,
      telefono: acc.telefono + e.telefono,
      total: acc.total + e.total_a_pagar,
      paid: acc.paid + e.paid_total,
      saldo: acc.saldo + e.saldo,
    }),
    {
      sueldo: 0,
      extras: 0,
      vacaciones: 0,
      viaticos: 0,
      deudas: 0,
      telefono: 0,
      total: 0,
      paid: 0,
      saldo: 0,
    },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Planilla {formatPayrollPeriod(year, month)}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {period ? (
              <Badge
                variant={isClosed ? "secondary" : "outline"}
                className={
                  isClosed
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                    : ""
                }
              >
                {PAYROLL_STATUS_LABEL[period.status]}
              </Badge>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">
                Sin generar todavía.
              </span>
            )}
            {entries.length > 0 && (
              <span>
                · {entries.length} empleado{entries.length !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </div>
        {period && (
          <div className="flex items-center gap-2">
            {canManagePayments && bulkEmployees.length > 0 && (
              <BulkPayrollPaymentDialog
                employees={bulkEmployees}
                channels={activeChannels}
                year={year}
                month={month}
              />
            )}
            {!isClosed && canWrite && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  closeMut.mutate(period.id, {
                    onSuccess: () => toast.success("Período cerrado."),
                    onError: (err) => toast.error(err.message),
                  })
                }
                disabled={closeMut.isPending}
              >
                <Lock className="size-4" />
                Cerrar período
              </Button>
            )}
            {isClosed && canAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  reopenMut.mutate(period.id, {
                    onSuccess: () => toast.success("Período reabierto."),
                    onError: (err) => toast.error(err.message),
                  })
                }
                disabled={reopenMut.isPending}
              >
                <Unlock className="size-4" />
                Reabrir
              </Button>
            )}
          </div>
        )}
      </div>

      {!period ? (
        <p className="text-sm text-muted-foreground">
          Generá el período para empezar a cargar la planilla.
        </p>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-44">Empleado</TableHead>
                <TableHead className="w-32 text-right">Sueldo</TableHead>
                <TableHead className="w-32 text-right">Extras</TableHead>
                <TableHead className="w-32 text-right">Vacaciones</TableHead>
                <TableHead className="w-32 text-right">Viáticos</TableHead>
                <TableHead className="w-32 text-right">Deudas</TableHead>
                <TableHead className="w-32 text-right">Teléfono</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead className="w-32 text-right">Pagado</TableHead>
                <TableHead className="w-32 text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Sin entries. ¿No hay empleados activos?
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow
                    key={e.id}
                    className={!e.employee_is_active ? "opacity-60" : undefined}
                  >
                    <TableCell className="font-medium">
                      {e.employee_legal_name}
                      <Badge
                        variant="outline"
                        className="ml-2 text-[10px] font-normal"
                      >
                        {e.employee_pay_frequency}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.sueldo_neto}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "sueldo_neto", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <PayrollExtrasDialog
                        entryId={e.id}
                        employeeName={e.employee_legal_name}
                        total={e.extras_total}
                        year={year}
                        month={month}
                        disabled={!canEdit}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.vacaciones_monto}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "vacaciones_monto", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.viaticos}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "viaticos", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.deudas}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "deudas", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.telefono}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "telefono", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {money(e.total_a_pagar)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {money(e.paid_total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PayrollPaymentsDialog
                        entryId={e.id}
                        employeeName={e.employee_legal_name}
                        total={e.total_a_pagar}
                        paid={e.paid_total}
                        saldo={e.saldo}
                        year={year}
                        month={month}
                        disabled={!canManagePayments}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {entries.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Totales</TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.sueldo)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.extras)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.vacaciones)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.viaticos)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.deudas)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {money(totals.telefono)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {money(totals.total)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {money(totals.paid)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {money(totals.saldo)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}
