"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  useDefaultChannel,
  useScope,
} from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEnabledPos } from "@/features/invoices/hooks/use-invoices";

import { useCreateSalesInvoiceFromExtraction } from "../hooks/use-documents";
import { InvoiceExtractionSchema } from "../schemas";

/**
 * Emit a sales invoice from its extraction. The comprobante goes through the
 * normal issue workflow (AFIP CAE on fiscal channels, local numbering on
 * internal ones) — the scanned numero is not reused, so this is for
 * registering operations that never entered the system, not for re-emitting.
 */
export function CreateSalesInvoiceDialog({
  extractionId,
  payload,
  clientName,
  duplicate,
  open,
  onOpenChange,
  onCreated,
}: {
  extractionId: string;
  payload: unknown;
  clientName: string | null;
  duplicate: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const defaultChannel = useDefaultChannel();

  const [channelId, setChannelId] = useState("");
  const [pos, setPos] = useState("");
  const posQuery = useEnabledPos(channelId || null, { enabled: open });
  const posOptions = useMemo(() => posQuery.data ?? [], [posQuery.data]);
  const create = useCreateSalesInvoiceFromExtraction();

  useEffect(() => {
    if (open) {
      setChannelId(defaultChannel ?? "");
      setPos("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !pos && posOptions.length === 1) {
      setPos(String(posOptions[0]!.numero));
    }
  }, [open, posOptions, pos]);

  const parsed = InvoiceExtractionSchema.safeParse(payload);
  const fecha = parsed.success ? parsed.data.date : null;
  const total = parsed.success ? parsed.data.total_amount : null;
  const currency = parsed.success ? (parsed.data.currency ?? "ARS") : "ARS";
  const itemCount = parsed.success ? parsed.data.items.length : 0;

  function onSubmit() {
    create.mutate(
      { extractionId, channelId, puntoVenta: Number(pos) },
      {
        onSuccess: () => {
          toast.success("Factura enviada a emisión.");
          onCreated();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Emitir factura de venta</DialogTitle>
          <DialogDescription>
            Se emite un comprobante nuevo por el flujo normal (AFIP en canales
            fiscales) con la numeración que corresponda — el número del escaneo
            no se reutiliza.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1 text-sm">
            {clientName && (
              <p>
                <span className="text-muted-foreground">Cliente: </span>
                <span className="font-medium">{clientName}</span>
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Fecha: </span>
              {fecha ?? "—"}
              <span className="text-muted-foreground"> · Total: </span>
              <span className="font-mono">
                {total != null
                  ? `${currency} ${total.toLocaleString("es-AR")}`
                  : "—"}
              </span>
              <span className="text-muted-foreground"> · Ítems: </span>
              {itemCount > 0 ? itemCount : "1 (total del comprobante)"}
            </p>
          </div>

          {duplicate && (
            <p className="text-sm font-medium">
              Ese comprobante ya está registrado en el sistema — no se puede
              volver a emitir desde acá.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="si-canal">Canal</Label>
              <Select
                value={channelId}
                onValueChange={(v) => {
                  setChannelId(v);
                  setPos("");
                }}
              >
                <SelectTrigger id="si-canal">
                  <SelectValue placeholder="Canal" />
                </SelectTrigger>
                <SelectContent>
                  {activeChannels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="si-pos">Punto de venta</Label>
              <Select value={pos} onValueChange={setPos}>
                <SelectTrigger id="si-pos">
                  <SelectValue
                    placeholder={
                      posOptions.length === 0 ? "Sin POS habilitado" : "POS"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {posOptions.map((p) => (
                    <SelectItem key={p.numero} value={String(p.numero)}>
                      {String(p.numero).padStart(5, "0")}
                      {p.nickname ? ` — ${p.nickname}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

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
            onClick={onSubmit}
            disabled={duplicate || !channelId || !pos || create.isPending}
          >
            Emitir factura
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
