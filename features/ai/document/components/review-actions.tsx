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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Create-from-extraction footer for the review dialog. Only purchase invoices
 * are wired for now; other kinds get their create flow in a follow-up.
 */
export function ReviewActions({
  extraction,
  onCreated,
}: {
  extraction: ExtractionDetail;
  onCreated: () => void;
}) {
  const { channels } = useScope();
  const activeChannels = channels.filter((c) => c.is_active);
  const [channelId, setChannelId] = useState(activeChannels[0]?.id ?? "");
  const create = useCreatePurchaseInvoice();

  if (extraction.detected_type !== "factura_compra") return null;

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
