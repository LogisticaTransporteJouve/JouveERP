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
import { formatArgentineDate, formatMoney } from "@/lib/format";

import { useFreightSettlement } from "../hooks/use-freight-settlements";
import {
  FREIGHT_PRICE_SOURCE_LABELS,
  FREIGHT_SETTLEMENT_STATUS_LABELS,
  formatSettlementNumber,
} from "../schema";

function route(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

/** A liquidación's cargas, prices and invoice. */
export function FreightSettlementDetailDialog({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detail = useFreightSettlement(id);
  const s = detail.data;

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
            Liquidación {s ? formatSettlementNumber(s.numero) : ""}
          </DialogTitle>
          <DialogDescription>
            {s
              ? `${s.client_name} · ${formatArgentineDate(s.period_start)} al ${formatArgentineDate(s.period_end)} · ${FREIGHT_SETTLEMENT_STATUS_LABELS[s.status]}`
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
            No se pudo cargar la liquidación: {detail.error.message}
          </p>
        ) : s ? (
          <div className="space-y-3">
            {s.status === "cancelled" && (
              <p className="text-sm text-muted-foreground">
                Cancelada: sus cargas quedaron libres para otra liquidación.
              </p>
            )}
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {s.items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {route(i.origin, i.destination)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {i.service_date
                        ? formatArgentineDate(i.service_date)
                        : "Sin fecha"}
                      {i.remito_number ? ` · Remito ${i.remito_number}` : ""}
                      {` · ${FREIGHT_PRICE_SOURCE_LABELS[i.price_source]}`}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(i.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {s.items.length === 1 ? "1 carga" : `${s.items.length} cargas`}
              </span>
              <span className="font-medium tabular-nums">
                {formatMoney(s.total)}
                {s.client_is_fiscal ? " + IVA" : ""}
              </span>
            </div>
            {s.notes && (
              <p className="text-sm text-muted-foreground">{s.notes}</p>
            )}
            {s.invoice_id && (
              <p className="text-sm">
                Factura:{" "}
                <Link
                  href={`/invoices/${s.invoice_id}`}
                  className="underline underline-offset-4"
                >
                  ver comprobante
                </Link>
              </p>
            )}
          </div>
        ) : null}
        <DialogFooter>
          {s?.numero != null && (
            <Button variant="outline" asChild>
              <a
                href={`/api/freight-settlements/${s.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText />
                Ver R
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
