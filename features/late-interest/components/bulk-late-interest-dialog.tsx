"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatArgentineDate, formatMoney } from "@/lib/format";
import { paymentCurrencyOf } from "@/lib/fx";

import { useIssueLateInterestNdsBulk } from "../hooks/use-late-interest";
import { comprobanteLabel } from "../lib/late-interest";
import {
  MAX_BULK_NDS,
  type LateInterestBulkResult,
  type LateInterestCandidate,
} from "../schema";

/** A row the bulk run can charge: days to charge, a rate and interest. */
export function bulkEligible(c: LateInterestCandidate): boolean {
  return c.days > 0 && c.monthly_rate !== null && c.interest > 0;
}

/**
 * "Generar varias ND": one ND per chosen comprobante, each at its own rate
 * (the client's or the general one) and on its comprobante's punto de venta.
 * To change the rate or the punto de venta of one, use its own "Generar ND".
 */
export function BulkLateInterestDialog({
  open,
  candidates,
  asOf,
  onClose,
}: {
  open: boolean;
  candidates: readonly LateInterestCandidate[];
  asOf: string;
  onClose: () => void;
}) {
  const mut = useIssueLateInterestNdsBulk();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<LateInterestBulkResult[] | null>(null);
  // What was sent, kept for the results: the refetch after the run drops
  // every comprobante just charged from `candidates`.
  const [submitted, setSubmitted] = useState<readonly LateInterestCandidate[]>(
    [],
  );

  useEffect(() => {
    if (!open) return;
    setResults(null);
    setChosen(
      new Set(candidates.slice(0, MAX_BULK_NDS).map((c) => c.invoice_id)),
    );
    // Reset when the dialog opens, not on every refetch of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const byId = new Map(submitted.map((c) => [c.invoice_id, c]));
  const selected = candidates.filter((c) => chosen.has(c.invoice_id));
  const totals = new Map<ReturnType<typeof paymentCurrencyOf>, number>();
  for (const c of selected) {
    const cur = paymentCurrencyOf(c.moneda);
    totals.set(cur, (totals.get(cur) ?? 0) + c.interest);
  }

  function toggle(id: string, on: boolean) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onSubmit() {
    setSubmitted(selected);
    mut.mutate(
      {
        as_of: asOf,
        items: selected.map((c) => ({
          invoice_id: c.invoice_id,
          monthly_rate: c.monthly_rate ?? 0,
          punto_venta: c.punto_venta,
        })),
      },
      {
        onSuccess: (data) => {
          setResults(data);
          const issued = data.filter((r) => r.ok).length;
          if (issued === data.length) {
            toast.success(
              issued === 1
                ? "Se emitió 1 nota de débito."
                : `Se emitieron ${issued} notas de débito.`,
            );
          } else {
            toast.error(
              `Se emitieron ${issued} de ${data.length}: revisá las que fallaron.`,
            );
          }
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !mut.isPending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generar notas de débito por mora</DialogTitle>
          <DialogDescription>
            Una ND por comprobante, del día siguiente a lo ya cobrado al{" "}
            {formatArgentineDate(asOf)}, a la tasa del cliente o la general y en
            el punto de venta del comprobante. Hasta {MAX_BULK_NDS} por vez.
          </DialogDescription>
        </DialogHeader>

        {results === null ? (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {candidates.map((c) => (
              <li key={c.invoice_id} className="px-3 py-2 text-sm">
                <label className="flex cursor-pointer items-start gap-3">
                  <Checkbox
                    className="mt-0.5"
                    checked={chosen.has(c.invoice_id)}
                    disabled={
                      !chosen.has(c.invoice_id) && chosen.size >= MAX_BULK_NDS
                    }
                    onCheckedChange={(v) => toggle(c.invoice_id, v === true)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {c.client_name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {comprobanteLabel(c)} · {c.days} días al {c.monthly_rate}%
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(c.interest, paymentCurrencyOf(c.moneda))}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
            {results.map((r) => {
              const c = byId.get(r.invoice_id);
              return (
                <li key={r.invoice_id} className="px-3 py-2 text-sm">
                  <span className="block font-medium">
                    {c ? `${c.client_name} · ${comprobanteLabel(c)}` : "—"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {r.ok ? "ND emitida." : `No se emitió: ${r.error}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <DialogFooter className="items-center">
          {results === null ? (
            <>
              <span className="text-sm text-muted-foreground sm:mr-auto">
                {selected.length} seleccionados
                {[...totals.entries()]
                  .map(([cur, amount]) => ` · ${formatMoney(amount, cur)}`)
                  .join("")}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={mut.isPending}
                onClick={onClose}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={mut.isPending || selected.length === 0}
                onClick={onSubmit}
              >
                {mut.isPending ? "Emitiendo…" : "Emitir"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={onClose}>
              Listo
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
