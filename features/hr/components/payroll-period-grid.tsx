"use client";

import { Lock, RotateCcw, Unlock, UserPlus } from "lucide-react";
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
import type { Access } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";

import {
  useAddMissingPayrollEntries,
  useClosePayrollPeriod,
  usePayrollPeriod,
  useReopenPayrollPeriod,
  useResetPayrollDeudas,
  useUpdatePayrollEntry,
} from "../hooks/use-payroll";
import { payrollOtros, suggestedSplit } from "../lib/payroll-split";
import {
  PAYROLL_STATUS_LABEL,
  formatPayrollPeriod,
  type PayrollEntryResolved,
  type PayrollPeriodKind,
} from "../payroll-schema";

import { BulkPayrollPaymentDialog } from "./bulk-payroll-payment-dialog";
import { InlineMoneyInput } from "./inline-money-input";
import { PayrollExtrasDialog } from "./payroll-extras-dialog";
import { PayrollPaymentsDialog } from "./payroll-payments-dialog";
import { TripExtrasDialog } from "./trip-extras-dialog";

import { formatMoney } from "@/lib/format";

function money(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return formatMoney(n);
}

export function PayrollPeriodGrid({
  year,
  month,
  kind = "monthly",
  actorAccess,
}: {
  year: number;
  month: number;
  kind?: PayrollPeriodKind;
  actorAccess: Access;
}) {
  const { data } = usePayrollPeriod(year, month, kind);
  const updateMut = useUpdatePayrollEntry();
  const closeMut = useClosePayrollPeriod();
  const reopenMut = useReopenPayrollPeriod();
  const addMissingMut = useAddMissingPayrollEntries();
  const resetDeudasMut = useResetPayrollDeudas(year, month);
  const { channels } = useScope();

  const canWrite = userCan(actorAccess, "hr:write");
  const canAdmin = userCan(actorAccess, "hr:admin");

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
  function commit(
    entryId: string,
    field:
      | "sueldo_neto"
      | "recibo_neto"
      | "vacaciones_monto"
      | "viaticos"
      | "deudas"
      | "telefono"
      | "embargo",
    value: number | null,
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
      recibo: acc.recibo + (e.recibo_neto ?? 0),
      otros: acc.otros + (payrollOtros(e) ?? 0),
      embargo: acc.embargo + e.embargo,
      transferencia:
        acc.transferencia + (suggestedSplit(e)?.transferencia ?? 0),
      efectivo: acc.efectivo + (suggestedSplit(e)?.efectivo ?? 0),
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
      recibo: 0,
      otros: 0,
      embargo: 0,
      transferencia: 0,
      efectivo: 0,
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
            {kind === "sac"
              ? formatPayrollPeriod(year, month, kind)
              : `Planilla ${formatPayrollPeriod(year, month)}`}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {period ? (
              <Badge
                variant={isClosed ? "secondary" : "outline"}
                className={
                  isClosed
                    ? "bg-muted text-muted-foreground dark:text-muted-foreground"
                    : ""
                }
              >
                {PAYROLL_STATUS_LABEL[period.status]}
              </Badge>
            ) : (
              <span className="text-muted-foreground dark:text-muted-foreground">
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
            {canManagePayments && entries.length > 0 && (
              <BulkPayrollPaymentDialog
                entries={entries}
                channels={activeChannels}
                year={year}
                month={month}
              />
            )}
            {!isClosed && canWrite && kind === "monthly" && (
              <TripExtrasDialog year={year} month={month} />
            )}
            {!isClosed && canWrite && (
              <Button
                variant="outline"
                size="sm"
                title="Suma a este período a los empleados activos que no figuran (altas posteriores a generarlo)."
                onClick={() =>
                  addMissingMut.mutate(period.id, {
                    onSuccess: ({ added }) =>
                      toast.success(
                        added > 0
                          ? `Se agregaron ${added} empleado(s).`
                          : "No faltan empleados.",
                      ),
                    onError: (err) => toast.error(err.message),
                  })
                }
                disabled={addMissingMut.isPending}
              >
                <UserPlus className="size-4" />
                Agregar faltantes
              </Button>
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
                <TableHead className="w-32 text-right">
                  {kind === "sac" ? "SAC" : "Sueldo"}
                </TableHead>
                <TableHead
                  className="w-32 text-right"
                  title="Neto del recibo del liquidador. Vacío = sin recibo cargado."
                >
                  Recibo
                </TableHead>
                <TableHead
                  className="w-28 text-right"
                  title="Sueldo pactado − neto del recibo."
                >
                  Otros
                </TableHead>
                <TableHead className="w-32 text-right">Extras</TableHead>
                <TableHead className="w-32 text-right">Vacaciones</TableHead>
                <TableHead className="w-32 text-right">Viáticos</TableHead>
                <TableHead
                  className="w-32 text-right"
                  title="Cuota de los planes activos en pesos de la cuenta corriente del empleado. Editable por mes; al cerrar el período pasa a su cuenta corriente."
                >
                  Deudas
                </TableHead>
                <TableHead className="w-32 text-right">Teléfono</TableHead>
                <TableHead className="w-32 text-right">Embargo</TableHead>
                <TableHead className="w-32 text-right">Total</TableHead>
                <TableHead
                  className="w-36 text-right"
                  title="Transferencia = recibo − embargo − descuentos; efectivo = el resto del total."
                >
                  Transf. / Efectivo
                </TableHead>
                <TableHead className="w-32 text-right">Pagado</TableHead>
                <TableHead className="w-32 text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={14}
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
                      <InlineMoneyInput
                        nullable
                        value={e.recibo_neto}
                        placeholder="—"
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "recibo_neto", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {e.recibo_neto === null
                        ? "—"
                        : money(payrollOtros(e) ?? 0)}
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
                      <div className="flex items-center justify-end gap-1">
                        {e.deudas_override && canEdit && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            title="Cargado a mano. Volver a la cuota de los planes."
                            aria-label="Volver a la cuota de los planes"
                            disabled={resetDeudasMut.isPending}
                            onClick={() =>
                              resetDeudasMut.mutate(e.id, {
                                onError: (err) => toast.error(err.message),
                              })
                            }
                          >
                            <RotateCcw className="size-3" />
                          </Button>
                        )}
                        <InlineMoneyInput
                          value={e.deudas}
                          disabled={!canEdit}
                          onCommit={(v) => commit(e.id, "deudas", v)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.telefono}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "telefono", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <InlineMoneyInput
                        value={e.embargo}
                        disabled={!canEdit}
                        onCommit={(v) => commit(e.id, "embargo", v)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">
                      {money(e.total_a_pagar)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      <SplitCell entry={e} />
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
                    {money(totals.recibo)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">
                    {money(totals.otros)}
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
                  <TableCell className="text-right font-mono">
                    {money(totals.embargo)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold">
                    {money(totals.total)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    <div>{money(totals.transferencia)}</div>
                    <div>{money(totals.efectivo)}</div>
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

function SplitCell({ entry }: { entry: PayrollEntryResolved }) {
  const split = suggestedSplit(entry);
  if (!split) return <span title="Cargá el neto del recibo">—</span>;
  return (
    <>
      <div title="Transferencia sugerida">{money(split.transferencia)}</div>
      <div title="Efectivo sugerido">{money(split.efectivo)}</div>
    </>
  );
}
