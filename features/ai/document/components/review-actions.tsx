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
import { CreatePaymentDocDialog } from "./create-payment-doc-dialog";
import { CreatePurchaseNoteDialog } from "./create-purchase-note-dialog";
import { CreateSalesInvoiceDialog } from "./create-sales-invoice-dialog";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chequeCount(payload: unknown): number {
  const p = ChequeBatchExtractionSchema.safeParse(payload);
  return p.success ? p.data.cheques.length : 0;
}

function matchString(matches: unknown, key: string): string | null {
  return isRecord(matches) && typeof matches[key] === "string"
    ? matches[key]
    : null;
}

/** Footer button that opens a create dialog, with the shared nested-dialog wiring. */
function DialogTrigger({
  label,
  open,
  setOpen,
  children,
}: {
  label: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 border-t pt-3">
      <Button className="ml-auto" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? children : null}
    </div>
  );
}

function MissingMatchHint({ entity }: { entity: "cliente" | "proveedor" }) {
  return (
    <p className="text-muted-foreground border-t pt-3 text-xs">
      No se encontró el {entity} por CUIT. Cargá el {entity} y volvé a escanear
      para crear el documento automáticamente.
    </p>
  );
}

/**
 * Create-from-extraction footer for the review dialog. Every extractable kind
 * with a create target is wired: purchase invoice, cheques, recibo, orden de
 * pago, factura de venta and NC/ND de compra. Remitos and extractos stay
 * read-only (no entity to create / reconciliation handles them).
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
  const [nestedOpen, setNestedOpenState] = useState(false);
  const create = useCreatePurchaseInvoice();

  function setNested(nextOpen: boolean) {
    setNestedOpenState(nextOpen);
    onNestedOpenChange?.(nextOpen);
  }

  function handleCreated() {
    setNested(false);
    onCreated();
  }

  const kind = extraction.detected_type;
  const clientId = matchString(extraction.matches, "client_id");
  const clientName = matchString(extraction.matches, "client_name");
  const supplierId = matchString(extraction.matches, "supplier_id");
  const supplierName = matchString(extraction.matches, "supplier_name");
  const duplicate = matchString(extraction.matches, "duplicate_of") !== null;

  if (kind === "check") {
    const count = chequeCount(extraction.payload);
    return (
      <div className="flex items-center gap-2 border-t pt-3">
        <Button
          className="ml-auto"
          disabled={count === 0}
          onClick={() => setNested(true)}
        >
          Crear cheques en cartera{count > 0 ? ` (${count})` : ""}
        </Button>
        <CreateChequesDialog
          extractionId={extraction.id}
          payload={extraction.payload}
          open={nestedOpen}
          onOpenChange={setNested}
          onCreated={handleCreated}
        />
      </div>
    );
  }

  if (kind === "receipt" || kind === "payment_order") {
    const needsClient = kind === "receipt";
    if (needsClient ? !clientId : !supplierId) {
      return <MissingMatchHint entity={needsClient ? "cliente" : "proveedor"} />;
    }
    return (
      <DialogTrigger
        label={kind === "receipt" ? "Crear recibo" : "Crear orden de pago"}
        open={nestedOpen}
        setOpen={setNested}
      >
        <CreatePaymentDocDialog
          kind={kind}
          extractionId={extraction.id}
          payload={extraction.payload}
          counterpartyName={needsClient ? clientName : supplierName}
          open={nestedOpen}
          onOpenChange={setNested}
          onCreated={handleCreated}
        />
      </DialogTrigger>
    );
  }

  if (kind === "sales_invoice") {
    if (!clientId) return <MissingMatchHint entity="cliente" />;
    return (
      <DialogTrigger
        label="Emitir factura de venta"
        open={nestedOpen}
        setOpen={setNested}
      >
        <CreateSalesInvoiceDialog
          extractionId={extraction.id}
          payload={extraction.payload}
          clientName={clientName}
          duplicate={duplicate}
          open={nestedOpen}
          onOpenChange={setNested}
          onCreated={handleCreated}
        />
      </DialogTrigger>
    );
  }

  if (kind === "credit_debit_note") {
    if (!supplierId) return <MissingMatchHint entity="proveedor" />;
    return (
      <DialogTrigger
        label="Crear NC/ND de compra"
        open={nestedOpen}
        setOpen={setNested}
      >
        <CreatePurchaseNoteDialog
          extractionId={extraction.id}
          payload={extraction.payload}
          supplierName={supplierName}
          open={nestedOpen}
          onOpenChange={setNested}
          onCreated={handleCreated}
        />
      </DialogTrigger>
    );
  }

  if (kind !== "purchase_invoice") return null;

  if (!supplierId) return <MissingMatchHint entity="proveedor" />;

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
