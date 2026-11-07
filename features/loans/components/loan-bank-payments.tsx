"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import {
  parseBankLoanReceipt,
  type BankLoanReceipt,
} from "@/lib/loans/bank-receipt";
import { readPdfText } from "@/lib/pdf/pdf-text";

import { useBookLoanOpening, useRecordBankPayments } from "../hooks/use-loans";
import type { LoanDetail } from "../schema";

/** The bank's payment receipts of a loan in course: loaded from their PDFs,
 *  booked without Caja from the start of the fiscal year, plus the debt the
 *  loan carried into the year. */
export function LoanBankPayments({
  loan,
  canWrite,
}: {
  loan: LoanDetail;
  /** accounting:write: load receipts and book the opening debt. */
  canWrite: boolean;
}) {
  const record = useRecordBankPayments();
  const opening = useBookLoanOpening();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const money = (n: number) => formatMoney(n, loan.currency);
  const inCourse = loan.installments.some((i) => i.paid_outside);
  // What the loan owed when the open year began: its debt then, or its
  // disbursement if it was granted within the year.
  const needsOpening =
    inCourse &&
    !loan.opening_booked &&
    loan.start_date !== null &&
    loan.disbursement_transaction_id === null;
  const grantedInYear =
    loan.start_date !== null && loan.start_date >= loan.book_from;

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setReading(true);
    const receipts: BankLoanReceipt[] = [];
    const failed: string[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const parsed = parseBankLoanReceipt(await readPdfText(file));
          if (parsed.ok) receipts.push(parsed.receipt);
          else failed.push(`${file.name}: ${parsed.error}`);
        } catch {
          failed.push(`${file.name}: no se pudo leer el PDF.`);
        }
      }
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
    if (failed.length > 0) {
      toast.error(
        `${failed.length} ${failed.length === 1 ? "archivo no se leyó" : "archivos no se leyeron"}: ${failed[0]}`,
      );
    }
    if (receipts.length === 0) return;
    record.mutate(
      { loan_id: loan.id, payments: receipts },
      {
        onSuccess: ({ inserted, booked, other }) => {
          const parts = [
            `${inserted} ${inserted === 1 ? "comprobante cargado" : "comprobantes cargados"}`,
            `${booked} con asiento`,
            receipts.length - other - inserted > 0
              ? `${receipts.length - other - inserted} ya estaban`
              : null,
            other > 0 ? `${other} de otro préstamo` : null,
          ].filter(Boolean);
          toast.success(parts.join(" · "));
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  if (!inCourse && loan.bank_payments.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Comprobantes del banco</h2>
          <p className="text-muted-foreground text-xs">
            Los pagos hechos antes de cargar el préstamo. Los del ejercicio
            (desde el {formatArgentineDate(loan.book_from)}) generan su asiento
            contra Bancos, sin movimiento en Caja.
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {needsOpening && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={opening.isPending}
                onClick={() =>
                  opening.mutate(loan.id, {
                    onSuccess: () =>
                      toast.success(
                        grantedInYear
                          ? "Desembolso registrado (sin movimiento en Caja)."
                          : "Deuda de apertura registrada.",
                      ),
                    onError: (err) => toast.error(err.message),
                  })
                }
              >
                {grantedInYear && loan.start_date
                  ? `Registrar el desembolso del ${formatArgentineDate(loan.start_date)}`
                  : `Registrar la deuda al ${formatArgentineDate(loan.book_from)}`}
              </Button>
            )}
            <input
              ref={input}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              aria-label="Comprobantes de pago del banco"
              onChange={(e) => void onFiles(e.target.files)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={reading || record.isPending}
              onClick={() => input.current?.click()}
            >
              {reading || record.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileUp className="size-4" />
              )}
              Subir comprobantes
            </Button>
          </div>
        )}
      </div>
      {loan.bank_payments.length > 0 && (
        <div className="bg-card overflow-x-auto rounded-lg border">
          <Table className="min-w-[52rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Comprobante</TableHead>
                <TableHead className="text-right">Cuota</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Capital</TableHead>
                <TableHead className="text-right">Intereses</TableHead>
                <TableHead className="text-right">IVA</TableHead>
                <TableHead className="text-right">Percepciones</TableHead>
                <TableHead>Asiento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loan.bank_payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-sm">
                    {formatArgentineDate(p.paid_date)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {p.receipt_number}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.installment_number}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(p.total)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(p.capital)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(p.interest + p.late_interest)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(p.iva)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {money(p.iva_perception + p.iibb_perception)}
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.journal_entry_id ? "Sí" : "No (ejercicio anterior)"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
