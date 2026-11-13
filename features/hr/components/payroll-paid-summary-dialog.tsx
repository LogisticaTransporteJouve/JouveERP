"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { ReadError } from "@/components/read-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatMoney as money } from "@/lib/format";

import { usePayrollPaidSummary } from "../hooks/use-payroll";
import {
  PAYROLL_PAYMENT_METHOD_LABEL,
  type PayrollPaidLine,
} from "../payroll-schema";

type Props = {
  entryId: string;
  employeeName: string;
  periodLabel: string;
  total: number;
  paid: number;
  saldo: number;
};

/** The Pagado cell: opens how the month's salary was paid, read only. */
export function PayrollPaidSummaryDialog({
  entryId,
  employeeName,
  periodLabel,
  total,
  paid,
  saldo,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 font-mono text-muted-foreground"
          title="Ver cómo se pagó el sueldo"
        >
          {money(paid)}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Cómo cobró {periodLabel} — {employeeName}
          </DialogTitle>
          <DialogDescription>
            Total {money(total)} · Pagado {money(paid)} · Saldo {money(saldo)}
          </DialogDescription>
        </DialogHeader>
        {open ? <SummaryBody entryId={entryId} paid={paid} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryBody({ entryId, paid }: { entryId: string; paid: number }) {
  const { data, isLoading, isError, refetch } = usePayrollPaidSummary(entryId);
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Cargando…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <ReadError
        message="No se pudo cargar cómo se pagó el sueldo."
        onRetry={() => void refetch()}
      />
    );
  }
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no se pagó nada de este sueldo.
      </p>
    );
  }
  const listed = data.reduce((sum, line) => sum + line.amount, 0);
  return (
    <div className="max-h-[60vh] overflow-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Concepto</TableHead>
            <TableHead>Cuenta</TableHead>
            <TableHead className="text-right">Monto</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((line) => (
            <TableRow key={`${line.kind}-${line.id}`}>
              <TableCell className="whitespace-nowrap font-mono text-xs">
                {formatArgentineDate(line.date)}
              </TableCell>
              <TableCell className="text-sm">
                <div>{lineTitle(line)}</div>
                {line.description && (
                  <div className="text-xs text-muted-foreground">
                    {line.description}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {line.account_name ?? "—"}
              </TableCell>
              <TableCell className="text-right font-mono">
                {money(line.amount)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3}>Total pagado</TableCell>
            <TableCell className="text-right font-mono">
              {money(listed)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      {Math.abs(listed - paid) >= 0.01 && (
        <p className="mt-2 text-xs text-muted-foreground">
          La lista suma {money(listed)} y la planilla muestra {money(paid)}:
          recargá la planilla para ver los últimos cambios.
        </p>
      )}
    </div>
  );
}

function lineTitle(line: PayrollPaidLine): string {
  switch (line.kind) {
    case "payment": {
      const method = line.method
        ? PAYROLL_PAYMENT_METHOD_LABEL[line.method]
        : "Pago";
      return `${method} · ${line.is_fiscal ? "Libros" : "Gestión"}`;
    }
    case "advance":
      return "Adelanto de sueldo";
    case "savings_plan":
      return "Cuota de plan de ahorro";
  }
}
