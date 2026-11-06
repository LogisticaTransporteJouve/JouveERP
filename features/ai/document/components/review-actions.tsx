"use client";

import { useState } from "react";

import { DisabledHint } from "@/components/disabled-hint";
import { PageSideProvider } from "@/components/providers/scope-provider";
import { ReadError } from "@/components/read-error";
import { Button } from "@/components/ui/button";
import { PurchaseInvoiceDraftDialog } from "@/features/purchase-invoices/components/purchase-invoice-draft-dialog";
import type { Access } from "@/lib/auth/permissions";
import { normalizeCuit } from "@/lib/validation/cuit";

import type { ExtractionDetail } from "../actions";
import {
  usePurchaseInvoiceDraft,
  useSubmitPurchaseInvoiceDraft,
} from "../hooks/use-documents";
import { reviewCreateDeniedReason } from "../lib/review-gates";
import { ChequeBatchExtractionSchema, duplicateCheckOf } from "../schemas";

import { CreateChequesDialog } from "./create-cheques-dialog";
import { CreatePaymentDocDialog } from "./create-payment-doc-dialog";
import { CreateSalesInvoiceDialog } from "./create-sales-invoice-dialog";
import { RemitoShipments } from "./remito-shipments";

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

function FooterHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground border-t pt-3 text-xs">{children}</p>
  );
}

/** Why the scan has no client/supplier: the lookup failed on every attempt,
 *  it did not run (the uploader may not read that table), no CUIT was read
 *  as 11 digits to look up, or it found none. */
type MissingMatchReason = "failed" | "unchecked" | "no_cuit" | "not_found";

function missingMatchReason(extraction: ExtractionDetail): MissingMatchReason {
  const matches = isRecord(extraction.matches) ? extraction.matches : {};
  if (matches.lookup_failed === true) return "failed";
  if (matches.counterparty_unchecked === true) return "unchecked";
  const cuit = isRecord(extraction.payload)
    ? extraction.payload.counterparty_cuit
    : null;
  return typeof cuit === "string" && normalizeCuit(cuit) !== null
    ? "not_found"
    : "no_cuit";
}

function MissingMatchHint({
  entity,
  reason,
}: {
  entity: "cliente" | "proveedor";
  reason: MissingMatchReason;
}) {
  if (reason === "no_cuit") {
    return (
      <FooterHint>
        No se leyó el CUIT del {entity} en el documento, así que no se lo pudo
        buscar. Cargá el comprobante a mano.
      </FooterHint>
    );
  }
  if (reason === "failed") {
    return (
      <FooterHint>
        No se pudo verificar el {entity}: la búsqueda falló al procesar el
        escaneo. Cargá el comprobante a mano o volvé a escanearlo.
      </FooterHint>
    );
  }
  if (reason === "unchecked") {
    return (
      <FooterHint>
        No se pudo verificar el {entity} (sin permiso): quien escaneó el
        documento no tiene acceso a{" "}
        {entity === "cliente" ? "Clientes" : "Proveedores"}. Si podés verlos,
        volvé a escanearlo vos.
      </FooterHint>
    );
  }
  return (
    <FooterHint>
      No se encontró el {entity} por CUIT. Cargá el {entity} y volvé a escanear
      para crear el documento automáticamente.
    </FooterHint>
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

  if (draftQuery.isError) {
    return (
      <ReadError
        message={draftQuery.error.message}
        onRetry={() => void draftQuery.refetch()}
        className="border-t pt-3"
      />
    );
  }
  if (result?.state === "closed") {
    return (
      <FooterHint>Este documento ya fue procesado o descartado.</FooterHint>
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
 * venta. A remito shows the cargas that carry its number; extractos stay
 * read-only (reconciliation handles them).
 */
export function ReviewActions(props: ReviewActionsProps) {
  // A scanned voucher is a fiscal document with a CUIT: its forms offer only
  // the fiscal side (Ventas / Compras).
  return (
    <PageSideProvider side="fiscal">
      <ReviewActionsInner {...props} />
    </PageSideProvider>
  );
}

type ReviewActionsProps = {
  extraction: ExtractionDetail;
  /** The viewer's access: each create action shows only when it passes. */
  access: Access;
  onCreated: () => void;
  /** Signals when a nested action dialog opens/closes (to hide the sidecar). */
  onNestedOpenChange?: (open: boolean) => void;
};

function ReviewActionsInner({
  extraction,
  access,
  onCreated,
  onNestedOpenChange,
}: ReviewActionsProps) {
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
  const duplicate = duplicateCheckOf(extraction.matches);
  const missingReason = missingMatchReason(extraction);
  const denied = reviewCreateDeniedReason(access, kind);
  if (denied) return <FooterHint>{denied}</FooterHint>;

  if (kind === "check") {
    const count = chequeCount(extraction.payload);
    return (
      <div className="flex items-center gap-2 border-t pt-3">
        <DisabledHint
          reason={
            count === 0 ? "No se detectaron cheques en el documento." : null
          }
          className="ml-auto"
        >
          <Button
            className="ml-auto"
            disabled={count === 0}
            onClick={() => setNested(true)}
          >
            Crear cheques en cartera{count > 0 ? ` (${count})` : ""}
          </Button>
        </DisabledHint>
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
        <MissingMatchHint
          entity={needsClient ? "cliente" : "proveedor"}
          reason={missingReason}
        />
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
    if (!clientId) {
      return <MissingMatchHint entity="cliente" reason={missingReason} />;
    }
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

  if (kind === "delivery_note") {
    return <RemitoShipments payload={extraction.payload} />;
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
