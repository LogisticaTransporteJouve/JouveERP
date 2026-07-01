"use client";

import { useState } from "react";
import { toast } from "sonner";

import { useScope } from "@/components/providers/scope-provider";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { ExtractionDetail } from "../actions";
import { useCreatePurchaseInvoice } from "../hooks/use-documents";
import { ChequeBatchExtractionSchema } from "../schemas";

import { CreateChequesDialog } from "./create-cheques-dialog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chequeCount(payload: unknown): number {
  const p = ChequeBatchExtractionSchema.safeParse(payload);
  return p.success ? p.data.cheques.length : 0;
}

/**
 * Create-from-extraction footer for the review dialog. Only purchase invoices
 * are wired for now; other kinds get their create flow in a follow-up.
 */
export function ReviewActions({
  extraction,
  onCreated,
  onNestedOpenChange,
}: {
  extraction: ExtractionDetail;
  onCreated: () => void;
  /** Signals when a nested action dialog opens/closes (to hide the sidecar). */
  onNestedOpenChange?: (open: boolean) => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const [channelId, setChannelId] = useState(activeChannels[0]?.id ?? "");
  const [chequesOpen, setChequesOpen] = useState(false);
  const create = useCreatePurchaseInvoice();

  function setCheques(nextOpen: boolean) {
    setChequesOpen(nextOpen);
    onNestedOpenChange?.(nextOpen);
  }

  if (extraction.detected_type === "check") {
    const count = chequeCount(extraction.payload);
    return (
      <div className="flex items-center gap-2 border-t pt-3">
        <Button
          className="ml-auto"
          disabled={count === 0}
          onClick={() => setCheques(true)}
        >
          Crear cheques en cartera{count > 0 ? ` (${count})` : ""}
        </Button>
        <CreateChequesDialog
          extractionId={extraction.id}
          payload={extraction.payload}
          open={chequesOpen}
          onOpenChange={setCheques}
          onCreated={() => {
            setCheques(false);
            onCreated();
          }}
        />
      </div>
    );
  }

  if (extraction.detected_type !== "purchase_invoice") return null;

  const supplierId =
    isRecord(extraction.matches) &&
    typeof extraction.matches.supplier_id === "string"
      ? extraction.matches.supplier_id
      : null;

  if (!supplierId) {
    return (
      <p className="text-muted-foreground border-t pt-3 text-xs">
        No se encontró el proveedor por CUIT. Cargá el proveedor y volvé a
        escanear para crear la factura automáticamente.
      </p>
    );
  }

  function handleCreate() {
    create.mutate(
      { extractionId: extraction.id, channelId },
      {
        onSuccess: () => {
          toast.success("Factura de compra creada.");
          onCreated();
        },
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "No se pudo crear la factura.",
          ),
      },
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center">
      <Select value={channelId} onValueChange={setChannelId}>
        <SelectTrigger className="sm:w-48">
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
      <Button
        className="sm:ml-auto"
        disabled={!channelId || create.isPending}
        onClick={handleCreate}
      >
        Crear factura de compra
      </Button>
    </div>
  );
}
