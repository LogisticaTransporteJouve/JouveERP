"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { parseLeasingStatement } from "@/lib/loans/leasing-statement";
import { readPdfText } from "@/lib/pdf/pdf-text";

import { useApplyInstallmentStatement } from "../hooks/use-loans";
import type { LoanDetail } from "../schema";

/** «Cargar resumen de cuota»: the leasing's statement PDF sets the pending
 *  cuota it bills (capital, interest, IVA, seguro, patentes and mora). */
export function LeasingStatementUpload({ loan }: { loan: LoanDetail }) {
  const apply = useApplyInstallmentStatement();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    let parsed: ReturnType<typeof parseLeasingStatement>;
    try {
      parsed = parseLeasingStatement(await readPdfText(file));
    } catch {
      parsed = { ok: false, error: "No se pudo leer el PDF." };
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
    if (!parsed.ok) {
      toast.error(`${file.name}: ${parsed.error}`);
      return;
    }
    const s = parsed.statement;
    const overdue = s.charges.some((c) => c.description === "Deuda anterior");
    apply.mutate(
      {
        loan_id: loan.id,
        operation: s.operation,
        installment_number: s.installment_number,
        capital: s.capital,
        interest: s.interest,
        iva: s.iva,
        charges: s.charges,
      },
      {
        onSuccess: ({ installment_number, amount }) =>
          toast.success(
            `Cuota ${installment_number}: ${formatMoney(amount, loan.currency)}${
              overdue
                ? ". Incluye deuda anterior: si esa cuota sigue pendiente acá, no la pagues dos veces."
                : "."
            }`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        aria-label="Resumen de cuota del leasing"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={reading || apply.isPending}
        onClick={() => input.current?.click()}
      >
        {reading || apply.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        Cargar resumen de cuota
      </Button>
    </>
  );
}
