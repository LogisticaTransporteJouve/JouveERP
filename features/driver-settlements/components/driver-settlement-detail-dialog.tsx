"use client";

import { FileText } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatArgentineDate,
  formatMoney,
  formatMoneySigned,
} from "@/lib/format";

import { useDriverSettlement } from "../hooks/use-driver-settlements";
import {
  DRIVER_SETTLEMENT_STATUS_LABELS,
  differenceNote,
  formatDriverSettlementNumber,
  settlementDifference,
} from "../schema";

/** A rendición: per carga, what was expected, what came in and how. */
export function DriverSettlementDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detail = useDriverSettlement(id);
  const s = detail.data;
  const note = s
    ? differenceNote(s.difference_charged_to, s.difference_posted)
    : null;

  return (
    <Dialog
      open={id !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Rendición {s ? formatDriverSettlementNumber(s.numero) : ""}
          </DialogTitle>
          <DialogDescription>
            {s
              ? `${s.driver_name} · ${formatArgentineDate(s.settlement_date)} · ${DRIVER_SETTLEMENT_STATUS_LABELS[s.status]}`
              : "Cargando…"}
          </DialogDescription>
        </DialogHeader>
        {detail.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : detail.isError ? (
          <p className="text-sm text-muted-foreground">
            No se pudo cargar la rendición: {detail.error.message}
          </p>
        ) : s ? (
          <div className="space-y-3">
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {s.items.map((i) => {
                const received = i.lines.reduce((t, l) => t + l.amount, 0);
                const diff = settlementDifference(i.expected_amount, received);
                return (
                  <li key={i.id} className="space-y-1 px-3 py-2 text-sm">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {i.client_name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {i.delivery_date
                            ? formatArgentineDate(i.delivery_date)
                            : "Sin fecha"}
                          {i.remito_number
                            ? ` · Remito ${i.remito_number}`
                            : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="block">
                          {formatMoney(received)} de{" "}
                          {formatMoney(i.expected_amount)}
                        </span>
                        {diff !== 0 && (
                          <span className="block text-xs text-muted-foreground">
                            Dif. {formatMoneySigned(diff)}
                          </span>
                        )}
                      </span>
                    </div>
                    {i.lines.map((l) => (
                      <p key={l.id} className="text-xs text-muted-foreground">
                        {l.account_name}: {formatMoney(l.amount)}
                        {l.check_number
                          ? ` · Cheque ${l.check_number} ${l.bank_name ?? ""}`
                          : ""}
                        {l.reference && !l.check_number
                          ? ` · ${l.reference}`
                          : ""}
                      </p>
                    ))}
                    {i.lines.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        No entregó nada por esta carga.
                      </p>
                    )}
                    {i.note && (
                      <p className="text-xs text-muted-foreground">{i.note}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <span className="block text-xs text-muted-foreground">
                  A cobrar
                </span>
                <span className="tabular-nums">
                  {formatMoney(s.expected_total)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Entregado
                </span>
                <span className="tabular-nums">
                  {formatMoney(s.received_total)}
                </span>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">
                  Diferencia
                </span>
                <span className="font-medium tabular-nums">
                  {formatMoneySigned(s.difference)}
                </span>
              </div>
            </div>
            {s.receipts.length > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Recibos: </span>
                {s.receipts.map((r, idx) => (
                  <span key={r.id}>
                    {idx > 0 ? ", " : ""}
                    <Link
                      href={`/receipts/${r.id}`}
                      className="underline underline-offset-4"
                    >
                      {r.label}
                    </Link>
                    {r.canceled ? " (anulado)" : ""}
                    {r.mismatch ? " (editado en Recibos)" : ""}
                  </span>
                ))}
              </div>
            )}
            {s.receipts_out_of_sync && (
              <p className="text-sm text-muted-foreground">
                Un recibo se anuló o se editó en Recibos después de confirmar:
                lo que muestra la rendición ya no coincide con los recibos. Si
                se anularon todos, cancelá la rendición; si se editó uno,
                revisalo.
              </p>
            )}
            {note && <p className="text-sm text-muted-foreground">{note}</p>}
            {s.notes && (
              <p className="text-sm text-muted-foreground">{s.notes}</p>
            )}
          </div>
        ) : null}
        <DialogFooter>
          {s && s.numero !== null && (
            <Button asChild variant="outline">
              <a
                href={`/api/driver-settlements/${s.id}/pdf`}
                target="_blank"
                rel="noreferrer"
              >
                <FileText />
                PDF
              </a>
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
