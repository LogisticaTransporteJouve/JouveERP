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
import { PayInstallmentDialog } from "./pay-installment-dialog";

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
}: {
  loanId: string;
  accountOptions: { id: string; name: string }[];
}) {
  const { data: loan } = useLoan(loanId);
  const [payTarget, setPayTarget] = useState<LoanInstallment | null>(null);
  const [editTarget, setEditTarget] = useState<LoanInstallment | null>(null);

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
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Capital" value={formatMoney(loan.principal)} />
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
                  {i.status === "pendiente" && loan.status === "active" && (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditTarget(i)}
                      >
                        Editar
                      </Button>
                      <Button size="sm" onClick={() => setPayTarget(i)}>
                        Pagar
                      </Button>
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
        accountOptions={accountOptions}
        onClose={() => setPayTarget(null)}
      />
      <EditInstallmentDialog
        installment={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}
