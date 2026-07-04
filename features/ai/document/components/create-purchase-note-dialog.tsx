"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useCreatePurchaseNoteFromExtraction } from "../hooks/use-documents";
import { InvoiceExtractionSchema } from "../schemas";

/** Create a purchase NC/ND from a scanned credit_debit_note (supplier side). */
export function CreatePurchaseNoteDialog({
  extractionId,
  payload,
  supplierName,
  open,
  onOpenChange,
  onCreated,
}: {
  extractionId: string;
  payload: unknown;
  supplierName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);

  const [channelId, setChannelId] = useState("");
  const [kind, setKind] = useState<"nc" | "nd">("nc");
  const [motivo, setMotivo] = useState("");
  const create = useCreatePurchaseNoteFromExtraction();

  useEffect(() => {
    if (open) {
      setChannelId(activeChannels[0]?.id ?? "");
      setKind("nc");
      setMotivo("Según documento escaneado");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const parsed = InvoiceExtractionSchema.safeParse(payload);
  const fecha = parsed.success ? parsed.data.date : null;
  const total = parsed.success ? parsed.data.total_amount : null;
  const currency = parsed.success ? (parsed.data.currency ?? "ARS") : "ARS";

  function onSubmit() {
    create.mutate(
      { extractionId, channelId, kind, motivo },
      {
        onSuccess: () => {
          toast.success(
            kind === "nc" ? "Nota de crédito creada." : "Nota de débito creada.",
          );
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
          <DialogTitle>Crear NC/ND de compra</DialogTitle>
          <DialogDescription>
            La nota escaneada se registra como recibida del proveedor, con los
            importes extraídos del documento.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1 text-sm">
            {supplierName && (
              <p>
                <span className="text-muted-foreground">Proveedor: </span>
                <span className="font-medium">{supplierName}</span>
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
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pn-canal">Canal</Label>
              <Select value={channelId} onValueChange={setChannelId}>
                <SelectTrigger id="pn-canal">
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
              <Label htmlFor="pn-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v === "nd" ? "nd" : "nc")}
              >
                <SelectTrigger id="pn-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nc">Nota de Crédito</SelectItem>
                  <SelectItem value="nd">Nota de Débito</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="pn-motivo">Motivo</Label>
              <Input
                id="pn-motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={500}
              />
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
            disabled={
              !channelId || motivo.trim().length === 0 || create.isPending
            }
          >
            Crear {kind === "nc" ? "NC" : "ND"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
