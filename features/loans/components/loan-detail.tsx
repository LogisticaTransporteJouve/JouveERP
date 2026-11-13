"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AccountOptionsError } from "@/features/accounts/components/account-options-gate";
import { useAccountOptions } from "@/features/accounts/hooks/use-accounts";
import { formatArgentineDate, formatMoney, todayInAR } from "@/lib/format";

import { useLoan } from "../hooks/use-loans";
import {
  LOAN_CHARGE_CONCEPT_LABEL,
  LOAN_KIND_LABEL,
  LOAN_STATUS_LABEL,
  type LoanInstallment,
} from "../schema";

import { EditInstallmentDialog } from "./edit-installment-dialog";
import {
  AdoptInstallmentPaymentDialog,
  RecordDisbursementDialog,
} from "./loan-movement-dialogs";
import { LeasingStatementUpload } from "./leasing-statement-upload";
import { LoanBankPayments } from "./loan-bank-payments";
import { PayInstallmentDialog } from "./pay-installment-dialog";
import { RepayCapitalDialog } from "./repay-capital-dialog";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
      {hint && <div className="text-muted-foreground text-xs">{hint}</div>}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b py-1.5 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value ?? "—"}</span>
    </div>
  );
}

const pct = (n: number | null) =>
  n === null
    ? null
    : `${n.toLocaleString("es-AR", { minimumFractionDigits: 2 })} %`;

/** «Cuota 3», «Interés 3» (open-ended) or «Devolución de capital». */
function installmentLabel(i: LoanInstallment, openEnded: boolean): string {
  if (i.kind === "devolucion_capital") return "Devolución de capital";
  return openEnded ? `Interés ${i.number}` : String(i.number);
}

function installmentState(i: LoanInstallment, today: string): string {
  if (i.status === "pagada") {
    return i.paid_outside ? "Pagada (antes de cargar)" : "Pagada";
  }
  return i.due_date < today
    ? "Vencida"
    : `Vence el ${formatArgentineDate(i.due_date)}`;
}

export function LoanDetail({
  loanId,
  canWrite,
  canMoveCash,
}: {
  loanId: string;
  /** accounting:write: edit a cuota. */
  canWrite: boolean;
  /** Also transactions:write: pay, disburse and link (they move Caja). */
  canMoveCash: boolean;
}) {
  const { data: loan } = useLoan(loanId);
  // A savings plan is an asset that grows with each cuota: no disbursement
  // and no capital owed.
  const isPlan = loan.kind === "plan_ahorro";
  const openEnded = loan.is_open_ended;
  const today = todayInAR();
  const money = (n: number) => formatMoney(n, loan.currency);
  const [payTarget, setPayTarget] = useState<LoanInstallment | null>(null);
  const [editTarget, setEditTarget] = useState<LoanInstallment | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<LoanInstallment | null>(null);
  const [disbursing, setDisbursing] = useState(false);
  const [repaying, setRepaying] = useState(false);
  const {
    accounts,
    error: accountsError,
    pending: accountsPending,
    retry: retryAccounts,
  } = useAccountOptions();
  // «Pagar» and «Registrar desembolso» pick an account: offered once the
  // accounts are read, with the reason in their place otherwise.
  const canPickAccount = !accountsError && !accountsPending;
  // An active account in the loan's currency that moves money (not a cartera).
  const loanAccounts = accounts.filter(
    (a) =>
      a.is_active &&
      a.type !== "checks" &&
      a.type !== "echeq" &&
      a.currency === loan.currency,
  );
  // A USD cuota or capital can also be paid from a peso account, at a rate.
  const payAccounts = accounts.filter(
    (a) =>
      a.is_active &&
      a.type !== "checks" &&
      a.type !== "echeq" &&
      (a.currency === loan.currency ||
        (loan.currency === "USD" && a.currency === "ARS")),
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/loans"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Préstamos
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            {loan.description}
          </h1>
          <Badge variant="outline">{LOAN_KIND_LABEL[loan.kind]}</Badge>
          <Badge variant={loan.status === "active" ? "secondary" : "outline"}>
            {LOAN_STATUS_LABEL[loan.status]}
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {[
            loan.lender,
            loan.loan_number ? `Préstamo ${loan.loan_number}` : null,
            loan.account_name ? `Débito en ${loan.account_name}` : null,
            loan.currency,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {openEnded && (
            <span className="text-muted-foreground">
              Sin vencimiento ·{" "}
              {(loan.monthly_rate ?? 0).toLocaleString("es-AR", {
                maximumFractionDigits: 4,
              })}{" "}
              % mensual
            </span>
          )}
          {openEnded &&
            loan.status === "active" &&
            canMoveCash &&
            canPickAccount &&
            loan.capital_outstanding > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRepaying(true)}
              >
                Devolución de capital…
              </Button>
            )}
          {isPlan ? (
            <span className="text-muted-foreground">
              Las cuotas pagadas suman a Rodados en plan de ahorro; no hay
              desembolso.
              {loan.salary_employee_name &&
                ` Se le imputa a ${loan.salary_employee_name}: cada cuota pagada figura en su planilla del mes como pago recibido.`}
            </span>
          ) : loan.installments.some((i) => i.paid_outside) ? (
            <span className="text-muted-foreground">
              Préstamo en curso: se cargó con cuotas ya pagadas, el desembolso
              fue antes de usar el sistema.
            </span>
          ) : loan.disbursement_transaction_id ? (
            <span className="text-muted-foreground">
              Desembolso registrado en Caja.
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">
                El desembolso no está registrado en Caja.
              </span>
              {loan.status !== "cancelled" && canMoveCash && canPickAccount && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDisbursing(true)}
                >
                  Registrar desembolso
                </Button>
              )}
            </>
          )}
        </div>
        {canMoveCash && accountsError && (
          <AccountOptionsError
            message={accountsError}
            onRetry={retryAccounts}
            className="mt-2 justify-start"
          />
        )}
      </div>

      <div
        className={`grid grid-cols-2 gap-3 ${isPlan ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
      >
        {isPlan ? (
          <>
            <Stat label="Falta pagar" value={money(loan.pending_total)} />
            <Stat
              label="Acumulado en el plan"
              value={money(loan.accumulated)}
            />
          </>
        ) : (
          <Stat
            label="Capital adeudado"
            value={money(loan.capital_outstanding)}
          />
        )}
        <Stat
          label="Cuotas pagas"
          value={
            openEnded
              ? String(loan.paid_count)
              : `${loan.paid_count}/${loan.installments.length}`
          }
        />
        <Stat
          label="Próxima cuota"
          value={
            loan.next_due_amount === null ? "—" : money(loan.next_due_amount)
          }
        />
        <Stat
          label="Vencimiento próxima cuota"
          value={
            loan.next_due_date ? formatArgentineDate(loan.next_due_date) : "—"
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium">General</h2>
          <Fact label="Estado" value={LOAN_STATUS_LABEL[loan.status]} />
          <Fact
            label="Monto original"
            value={money(loan.original_amount ?? loan.principal)}
          />
          <Fact
            label="Fecha de alta"
            value={
              loan.start_date ? formatArgentineDate(loan.start_date) : null
            }
          />
          <Fact
            label="Plazo"
            value={
              openEnded
                ? "Sin vencimiento"
                : `${loan.installments.length} cuotas`
            }
          />
          <Fact label="Cuotas restantes" value={String(loan.pending_count)} />
          <Fact label="Pendiente de pago" value={money(loan.pending_total)} />
          <Fact
            label="Pagado desde el sistema"
            value={money(loan.paid_total)}
          />
        </section>
        <section className="bg-card rounded-lg border p-4">
          <h2 className="mb-2 text-sm font-medium">Tasas</h2>
          <Fact label="Tasa nominal anual (TNA)" value={pct(loan.tna)} />
          <Fact label="Tasa efectiva anual (TEA)" value={pct(loan.tea)} />
          <Fact label="Costo financiero total (CFT)" value={pct(loan.cft)} />
          <Fact label="Intereses pagados" value={money(loan.interest_paid)} />
          {loan.notes && <Fact label="Notas" value={loan.notes} />}
        </section>
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium">Plan de cuotas</h2>
            {loan.kind === "leasing" && (
              <p className="text-muted-foreground text-xs">
                «Otros» incluye seguro, patentes y mora. El resumen de cuota del
                dador completa la cuota que vence.
              </p>
            )}
          </div>
          {loan.kind === "leasing" && loan.status === "active" && canWrite && (
            <LeasingStatementUpload loan={loan} />
          )}
        </div>
        <div className="bg-card overflow-x-auto rounded-lg border">
          <Table className="min-w-[56rem]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead className="text-right">Total a pagar</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Intereses</TableHead>
                <TableHead className="text-right">Otros</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loan.installments.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-muted-foreground tabular-nums whitespace-nowrap">
                    {installmentLabel(i, openEnded)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatArgentineDate(i.due_date)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(i.amount)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.split ? money(i.split.capital) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.split ? money(i.split.interest) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.split
                      ? money(
                          i.split.other +
                            i.split.perception +
                            i.split.iva_perception,
                        )
                      : "—"}
                    {i.charges.length > 0 && (
                      <span className="text-muted-foreground block font-sans text-xs whitespace-nowrap">
                        {i.charges
                          .map(
                            (c) =>
                              `${c.description ?? LOAN_CHARGE_CONCEPT_LABEL[c.concept]} ${money(c.amount + c.iva_amount)}`,
                          )
                          .join(" · ")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {i.split ? money(i.split.iva) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {installmentState(i, today)}
                    {i.status === "pagada" &&
                      !i.paid_outside &&
                      i.paid_date && (
                        <span className="text-muted-foreground block text-xs">
                          {formatArgentineDate(i.paid_date)} ·{" "}
                          {money(i.paid_amount ?? 0)}
                          {i.paid_amount_ars !== null &&
                            i.paid_rate !== null &&
                            ` · ${formatMoney(i.paid_amount_ars, "ARS")} (${i.paid_rate.toLocaleString("es-AR", { maximumFractionDigits: 2 })})`}
                        </span>
                      )}
                  </TableCell>
                  <TableCell className="text-right">
                    {i.status === "pendiente" &&
                      loan.status === "active" &&
                      canWrite && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditTarget(i)}
                          >
                            Editar
                          </Button>
                          {canMoveCash && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setAdoptTarget(i)}
                                title="Usar un egreso ya cargado en Caja"
                              >
                                Vincular egreso
                              </Button>
                              {canPickAccount && (
                                <Button
                                  size="sm"
                                  onClick={() => setPayTarget(i)}
                                >
                                  Pagar
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <LoanBankPayments loan={loan} canWrite={canWrite} />

      <PayInstallmentDialog
        installment={payTarget}
        loanCurrency={loan.currency}
        // The loan's currency, or pesos for a USD loan (at a rate).
        accountOptions={payAccounts}
        onClose={() => setPayTarget(null)}
      />
      {openEnded && (
        <RepayCapitalDialog
          loan={loan}
          accountOptions={payAccounts}
          open={repaying}
          onClose={() => setRepaying(false)}
        />
      )}
      <EditInstallmentDialog
        installment={editTarget}
        onClose={() => setEditTarget(null)}
      />
      <AdoptInstallmentPaymentDialog
        loan={loan}
        installment={adoptTarget}
        onClose={() => setAdoptTarget(null)}
      />
      <RecordDisbursementDialog
        loan={loan}
        accountOptions={loanAccounts}
        open={disbursing}
        onClose={() => setDisbursing(false)}
      />
    </div>
  );
}
