"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PurchaseInvoiceDraftDialog } from "@/features/purchase-invoices/components/purchase-invoice-draft-dialog";

import type { ExtractionDetail } from "../actions";
import {
  usePurchaseInvoiceDraft,
  useSubmitPurchaseInvoiceDraft,
} from "../hooks/use-documents";
import { ChequeBatchExtractionSchema } from "../schemas";

import { CreateChequesDialog } from "./create-cheques-dialog";
import { CreatePaymentDocDialog } from "./create-payment-doc-dialog";
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
 * Purchase invoice / supplier NC-ND: opens the regular purchase-invoice form
 * prefilled from the extraction (editable), next to the scanned file.
 */
function PurchaseDraftAction({
  extractionId,
  label,
  open,
  setOpen,
  onCreated,
}: {
  extractionId: string;
  label: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  onCreated: () => void;
}) {
  const draftQuery = usePurchaseInvoiceDraft(extractionId);
  const submitCreate = useSubmitPurchaseInvoiceDraft(extractionId);
  const result = draftQuery.data;

  const problem = draftQuery.isError
    ? draftQuery.error.message
    : result?.state === "closed"
      ? "Este documento ya fue procesado o descartado."
      : null;
  if (problem) {
    return (
      <p className="text-muted-foreground border-t pt-3 text-xs">{problem}</p>
    );
  }
  return (
    <div className="flex items-center gap-2 border-t pt-3">
      <Button
        className="ml-auto"
        disabled={result?.state !== "ready"}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {result?.state === "ready" && (
        <PurchaseInvoiceDraftDialog
          draft={{ data: result.draft, source: result.source, submitCreate }}
          open={open}
          onOpenChange={setOpen}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}

/**
 * Create-from-extraction footer for the review dialog. Every extractable kind
 * with a create target is wired: purchase invoice and NC/ND de compra (through
 * the editable purchase form), cheques, recibo, orden de pago and factura de
 * venta. Remitos and extractos stay read-only (no entity to create /
 * reconciliation handles them).
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
  const [nestedOpen, setNestedOpenState] = useState(false);

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
      return (
        <MissingMatchHint entity={needsClient ? "cliente" : "proveedor"} />
      );
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

  if (kind === "purchase_invoice" || kind === "credit_debit_note") {
    return (
      <PurchaseDraftAction
        extractionId={extraction.id}
        label={
          kind === "purchase_invoice"
            ? "Revisar y cargar factura de compra"
            : "Revisar y cargar NC/ND de compra"
        }
        open={nestedOpen}
        setOpen={setNested}
        onCreated={handleCreated}
      />
    );
  }

  return null;
}
