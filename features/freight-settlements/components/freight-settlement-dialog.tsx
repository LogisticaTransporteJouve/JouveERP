"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  FormColumn,
  FormColumns,
  WIDE_FORM_DIALOG,
} from "@/components/form-columns";
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
import { DatePicker } from "@/components/ui/date-picker";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatArgentineDate, formatMoney, round2 } from "@/lib/format";

import {
  ClientPicker,
  type PickedClient,
} from "@/features/invoices/components/client-picker";

import {
  useFreightSettlementCandidates,
  useSaveFreightSettlement,
} from "../hooks/use-freight-settlements";
import {
  FREIGHT_PRICE_SOURCE_LABELS,
  type FreightSettlementDetail,
} from "../schema";

function monthBounds(today: Date): { start: string; end: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(last)}`,
  };
}

function route(origin: string | null, destination: string | null): string {
  if (!origin && !destination) return "—";
  return `${origin ?? "—"} → ${destination ?? "—"}`;
}

/**
 * New liquidación (draft) or edit of a draft: a client, a period and the
 * client's delivered cargas in it, each priced at its flete or the client's
 * freight tariff. Cargas with neither cannot be picked.
 */
export function FreightSettlementDialog({
  settlement,
  open,
  onOpenChange,
}: {
  /** The draft being edited; absent for a new one. */
  settlement?: FreightSettlementDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saveMut = useSaveFreightSettlement();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The client|period whose cargas seeded the selection.
  const [seededFor, setSeededFor] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSeededFor(null);
    if (settlement) {
      setClient({
        id: settlement.client_id,
        legal_name: settlement.client_name,
        display_name: null,
        cuit: null,
        iva_condition: null,
        is_fiscal: settlement.client_is_fiscal,
      });
      setPeriodStart(settlement.period_start);
      setPeriodEnd(settlement.period_end);
      setNotes(settlement.notes ?? "");
      setSelected(new Set(settlement.items.map((i) => i.shipment_id)));
    } else {
      const bounds = monthBounds(new Date());
      setClient(null);
      setPeriodStart(bounds.start);
      setPeriodEnd(bounds.end);
      setNotes("");
      setSelected(new Set());
    }
  }, [open, settlement]);

  const candidates = useFreightSettlementCandidates({
    clientId: open ? (client?.id ?? "") : "",
    periodStart,
    periodEnd,
    settlementId: settlement?.id ?? null,
  });
  const rows = useMemo(() => candidates.data ?? [], [candidates.data]);

  // A new client or period starts with every priced carga picked; an edit
  // first shows the cargas the draft had.
  const initialKey = settlement
    ? `${settlement.client_id}|${settlement.period_start}|${settlement.period_end}`
    : null;
  useEffect(() => {
    if (!candidates.data) return;
    const key = `${client?.id ?? ""}|${periodStart}|${periodEnd}`;
    if (seededFor === key) return;
    setSeededFor(key);
    if (seededFor === null && key === initialKey) return;
    setSelected(
      new Set(
        candidates.data
          .filter((c) => c.amount !== null)
          .map((c) => c.shipment_id),
      ),
    );
  }, [
    candidates.data,
    client?.id,
    periodStart,
    periodEnd,
    seededFor,
    initialKey,
  ]);

  const pickable = rows.filter((r) => r.amount !== null);
  const picked = rows.filter((r) => selected.has(r.shipment_id));
  const total = round2(picked.reduce((s, r) => s + (r.amount ?? 0), 0));
  const unpriced = rows.length - pickable.length;
  const periodValid =
    periodStart !== "" && periodEnd !== "" && periodStart <= periodEnd;

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function onSubmit() {
    if (!client) {
      toast.error("Elegí un cliente.");
      return;
    }
    if (!periodValid) {
      toast.error("Revisá el período.");
      return;
    }
    if (picked.length === 0) {
      toast.error("Elegí al menos una carga.");
      return;
    }
    saveMut.mutate(
      {
        id: settlement?.id ?? null,
        client_id: client.id,
        period_start: periodStart,
        period_end: periodEnd,
        shipment_ids: picked.map((r) => r.shipment_id),
        notes,
      },
      {
        onSuccess: () => {
          toast.success(
            settlement ? "Liquidación guardada." : "Liquidación creada.",
          );
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={WIDE_FORM_DIALOG}>
        <DialogHeader>
          <DialogTitle>
            {settlement ? "Editar liquidación" : "Nueva liquidación"}
          </DialogTitle>
          <DialogDescription>
            Cargas entregadas del cliente en el período. Cada una va con su
            flete o, si no tiene, con la tarifa de flete del cliente.
          </DialogDescription>
        </DialogHeader>
        <FormColumns>
          <FormColumn>
            <div className="space-y-2">
              <Label>Cliente</Label>
              {settlement ? (
                <p className="text-sm font-medium">{settlement.client_name}</p>
              ) : (
                <ClientPicker
                  value={client}
                  onChange={(c) => {
                    setClient(c);
                    setSelected(new Set());
                  }}
                  isFiscal={null}
                />
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="fs-from">Desde</Label>
                <DatePicker
                  id="fs-from"
                  value={periodStart}
                  onChange={setPeriodStart}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fs-to">Hasta</Label>
                <DatePicker
                  id="fs-to"
                  value={periodEnd}
                  onChange={setPeriodEnd}
                />
              </div>
            </div>
            {!periodValid && periodStart !== "" && periodEnd !== "" && (
              <p className="text-sm text-muted-foreground">
                El período termina antes de empezar.
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="fs-notes">Notas</Label>
              <Textarea
                id="fs-notes"
                rows={2}
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {picked.length === 1 ? "1 carga" : `${picked.length} cargas`}
              </span>
              <span className="font-medium tabular-nums">
                {formatMoney(total)}
                {client?.is_fiscal ? " + IVA" : ""}
              </span>
            </div>
          </FormColumn>
          <FormColumn>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Cargas</Label>
                {pickable.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelected(
                        picked.length === pickable.length
                          ? new Set()
                          : new Set(pickable.map((r) => r.shipment_id)),
                      )
                    }
                  >
                    {picked.length === pickable.length ? "Ninguna" : "Todas"}
                  </Button>
                )}
              </div>
              {!client ? (
                <p className="text-sm text-muted-foreground">
                  Elegí un cliente para ver sus cargas.
                </p>
              ) : candidates.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : candidates.isError ? (
                <p className="text-sm text-muted-foreground">
                  No se pudieron cargar las cargas: {candidates.error.message}
                </p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay cargas entregadas sin facturar del cliente en el
                  período.
                </p>
              ) : (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
                  {rows.map((r) => {
                    const disabled = r.amount === null;
                    return (
                      <li key={r.shipment_id}>
                        <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-sm">
                          <Checkbox
                            className="mt-0.5"
                            checked={selected.has(r.shipment_id)}
                            disabled={disabled}
                            onCheckedChange={(v) =>
                              toggle(r.shipment_id, v === true)
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {route(r.origin, r.destination)}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {r.service_date
                                ? formatArgentineDate(r.service_date)
                                : "Sin fecha"}
                              {r.remito_number
                                ? ` · Remito ${r.remito_number}`
                                : ""}
                              {r.price_source
                                ? ` · ${FREIGHT_PRICE_SOURCE_LABELS[r.price_source]}`
                                : ""}
                            </span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {r.amount === null
                              ? "Sin flete ni tarifa"
                              : formatMoney(r.amount)}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {unpriced > 0 && (
                <p className="text-xs text-muted-foreground">
                  {unpriced === 1
                    ? "Una carga no tiene flete ni tarifa de flete vigente: cargá el flete en la carga o la tarifa en el cliente."
                    : `${unpriced} cargas no tienen flete ni tarifa de flete vigente: cargá el flete en la carga o la tarifa en el cliente.`}
                </p>
              )}
            </div>
          </FormColumn>
        </FormColumns>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={saveMut.isPending || picked.length === 0 || !periodValid}
            onClick={onSubmit}
          >
            Guardar borrador
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
