"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
  formatPeriod,
} from "@/lib/format";

import {
  useLinkTaxDocumentPayment,
  useTaxPaymentCandidates,
} from "../hooks/use-tax-documents";
import {
  LINK_CANDIDATE_DAY_WINDOW,
  taxDocumentLabel,
  type TaxDocument,
  type TaxPaymentCandidate,
} from "../schema";

function daysLabel(days: number): string {
  if (days === 0) return "el día del vencimiento";
  const n = Math.abs(days);
  return `${n} día${n === 1 ? "" : "s"} ${days < 0 ? "antes" : "después"}`;
}

/** Pays the document with an expense already loaded in Caja (the bank
 *  transfer to ARCA or the province) instead of booking a second one. */
export function LinkTaxPaymentDialog({
  doc,
  onClose,
}: {
  doc: TaxDocument | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={doc !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        {doc && <LinkTaxPaymentBody key={doc.id} doc={doc} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LinkTaxPaymentBody({
  doc,
  onClose,
}: {
  doc: TaxDocument;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<TaxPaymentCandidate | null>(null);
  const [confirmDifference, setConfirmDifference] = useState(false);
  const missingAccount = doc.account_id === null;
  const candidates = useTaxPaymentCandidates(
    missingAccount ? null : doc.id,
    page,
  );
  const linkMut = useLinkTaxDocumentPayment();

  const differs = selected !== null && (selected.difference ?? 0) !== 0;
  const data = candidates.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  function submit() {
    if (!selected) return;
    linkMut.mutate(
      {
        id: doc.id,
        transaction_id: selected.id,
        allow_difference: differs && confirmDifference,
      },
      {
        onSuccess: () => {
          toast.success("Impuesto pagado con el movimiento elegido.");
          onClose();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Vincular movimiento existente</DialogTitle>
        <DialogDescription>
          {taxDocumentLabel(doc)} · período {formatPeriod(doc.period)} · vence{" "}
          {formatArgentineDate(doc.due_date)}
          {doc.amount !== null && <> · {formatMoney(doc.amount)}</>}. Elegí el
          egreso que ya está en Caja (la transferencia del pago): queda como el
          pago del impuesto y su asiento pasa a{" "}
          {doc.account_name ?? "la cuenta contable del impuesto"}.
        </DialogDescription>
      </DialogHeader>

      {missingAccount ? (
        <p className="text-sm">
          Antes de vincular el pago, editá el impuesto y elegí su cuenta
          contable.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="max-h-80 space-y-1 overflow-auto rounded-md border p-2">
            {candidates.isPending && <Skeleton className="h-24 w-full" />}
            {candidates.isError && (
              <p className="p-2 text-sm">{candidates.error.message}</p>
            )}
            {data && data.items.length === 0 && (
              <p className="text-muted-foreground p-2 text-sm">
                No hay egresos sueltos en pesos del canal fiscal entre{" "}
                {LINK_CANDIDATE_DAY_WINDOW} días antes y después del
                vencimiento. Si el pago no está cargado, usá &quot;Pagar&quot;.
              </p>
            )}
            {data?.items.map((m) => (
              <label
                key={m.id}
                className="hover:bg-accent/50 has-[:checked]:bg-accent flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm"
              >
                <input
                  type="radio"
                  name="tax-link-candidate"
                  className="accent-primary mt-1"
                  checked={selected?.id === m.id}
                  onChange={() => {
                    setSelected(m);
                    setConfirmDifference(false);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {m.description || "(sin descripción)"}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {formatArgentineDate(m.transaction_date)} (
                    {daysLabel(m.days_from_due)}) · {m.account_name}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block tabular-nums">
                    {formatMoney(m.amount)}
                  </span>
                  {m.difference !== null && m.difference !== 0 && (
                    <span className="text-muted-foreground block text-xs tabular-nums">
                      dif. {formatMoneySigned(m.difference)}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          {data && data.total > data.page_size && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                Página {page + 1} de {pages}
              </span>
              <IconButton
                label="Página anterior"
                type="button"
                variant="outline"
                disabled={page === 0 || candidates.isFetching}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton
                label="Página siguiente"
                type="button"
                variant="outline"
                disabled={page + 1 >= pages || candidates.isFetching}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="size-4" />
              </IconButton>
            </div>
          )}
          {selected && differs && (
            <div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <Checkbox
                id="tax-link-difference"
                checked={confirmDifference}
                onCheckedChange={(v) => setConfirmDifference(v === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="tax-link-difference"
                className="leading-snug font-normal"
              >
                El movimiento es de {formatMoney(selected.amount)} y el impuesto
                de {formatMoney(doc.amount ?? 0)}. Vincularlo igual: el pago
                queda por el importe del movimiento y la diferencia en las
                notas.
              </Label>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={
            !selected ||
            missingAccount ||
            (differs && !confirmDifference) ||
            linkMut.isPending
          }
        >
          {linkMut.isPending ? "Vinculando…" : "Vincular y marcar pagado"}
        </Button>
      </DialogFooter>
    </>
  );
}
