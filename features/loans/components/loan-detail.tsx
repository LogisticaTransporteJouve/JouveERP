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
import { formatMoney } from "@/lib/format";

import { useLoan } from "../hooks/use-loans";
import {
  INSTALLMENT_STATUS_LABEL,
  LOAN_KIND_LABEL,
  LOAN_STATUS_LABEL,
  type LoanInstallment,
} from "../schema";

import { EditInstallmentDialog } from "./edit-installment-dialog";
import {
  AdoptInstallmentPaymentDialog,
  RecordDisbursementDialog,
} from "./loan-movement-dialogs";
import { PayInstallmentDialog } from "./pay-installment-dialog";

function splitSummary(i: LoanInstallment): string | null {
  if (!i.split) return null;
  const charges = i.split.interest + i.split.other;
  const taxes = i.split.iva + i.split.perception;
  return `Capital ${formatMoney(i.split.capital)} · Interés y cargos ${formatMoney(charges)}${
    taxes > 0 ? ` · IVA y percepción ${formatMoney(taxes)}` : ""
  }`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

export function LoanDetail({
  loanId,
  accountOptions,
  canWrite,
  canMoveCash,
}: {
  loanId: string;
  accountOptions: { id: string; name: string; currency: string }[];
  /** accounting:write: edit a cuota. */
  canWrite: boolean;
  /** Also transactions:write: pay, disburse and link (they move Caja). */
  canMoveCash: boolean;
}) {
  const { data: loan } = useLoan(loanId);
  const [payTarget, setPayTarget] = useState<LoanInstallment | null>(null);
  const [editTarget, setEditTarget] = useState<LoanInstallment | null>(null);
  const [adoptTarget, setAdoptTarget] = useState<LoanInstallment | null>(null);
  const [disbursing, setDisbursing] = useState(false);
  const loanAccounts = accountOptions.filter(
    (a) => a.currency === loan.currency,
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
          {loan.lender ? `${loan.lender} · ` : ""}
          {loan.channel_name ?? "—"} · {loan.currency}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {loan.disbursement_transaction_id ? (
            <span className="text-muted-foreground">
              Desembolso registrado en Caja.
            </span>
          ) : (
            <>
              <span className="text-muted-foreground">
                El desembolso no está registrado en Caja.
              </span>
              {loan.status !== "cancelled" && canMoveCash && (
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
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Capital" value={formatMoney(loan.principal)} />
        <Stat
          label="Saldo de capital (pasivo)"
          value={formatMoney(loan.capital_outstanding)}
        />
        <Stat label="Pagado" value={formatMoney(loan.paid_total)} />
        <Stat label="Pendiente" value={formatMoney(loan.pending_total)} />
        <Stat
          label="Cuotas pendientes"
          value={`${loan.pending_count} / ${loan.installments_count}`}
        />
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              <TableHead>Vencimiento</TableHead>
              <TableHead className="text-right">Monto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Pago</TableHead>
              <TableHead className="w-32" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loan.installments.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="text-muted-foreground tabular-nums">
                  {i.number}
                </TableCell>
                <TableCell className="text-sm">{i.due_date}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMoney(i.amount)}
                  {i.split && (
                    <div className="font-sans text-[11px] text-muted-foreground">
                      {splitSummary(i)}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={i.status === "pagada" ? "outline" : "secondary"}
                  >
                    {INSTALLMENT_STATUS_LABEL[i.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {i.status === "pagada" && i.paid_date
                    ? `${i.paid_date} · ${formatMoney(i.paid_amount ?? 0)}`
                    : "—"}
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
                            <Button size="sm" onClick={() => setPayTarget(i)}>
                              Pagar
                            </Button>
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

      <PayInstallmentDialog
        installment={payTarget}
        // An installment is paid from an account in the loan's currency.
        accountOptions={loanAccounts}
        onClose={() => setPayTarget(null)}
      />
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
