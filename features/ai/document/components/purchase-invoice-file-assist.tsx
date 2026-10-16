"use client";

import { AlertTriangle, Check, Circle, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FileDropzone } from "@/components/file-upload/file-dropzone";
import { Button } from "@/components/ui/button";
import { PurchaseInvoiceFileAssistProvider } from "@/features/purchase-invoices/components/file-assist-context";
import type { PurchaseInvoiceDraft } from "@/features/purchase-invoices/lib/purchase-invoice-draft";
import { userCan, type Role } from "@/lib/auth/permissions";

import {
  DRAFT_POLL_TIMEOUT_MS,
  usePurchaseInvoiceDraft,
  useScanDocument,
  useSubmitPurchaseInvoiceDraft,
} from "../hooks/use-documents";

const STEPS = [
  "Subiendo el archivo",
  "Leyendo la factura con IA",
  "Completando el formulario",
] as const;

function Progress({ current }: { current: number }) {
  return (
    <ol className="space-y-1.5 text-sm" aria-live="polite">
      {STEPS.map((label, i) => {
        const Icon = i < current ? Check : i === current ? Loader2 : Circle;
        return (
          <li
            key={label}
            className={`flex items-center gap-2 ${i > current ? "text-muted-foreground" : ""}`}
          >
            <Icon
              className={`size-4 shrink-0 ${i === current ? "animate-spin" : ""}`}
            />
            {label}
            {i === current ? "…" : ""}
          </li>
        );
      })}
    </ol>
  );
}

function Problem({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
      <p className="flex flex-1 items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        {message}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

/**
 * "Completar desde archivo": uploads the PDF/photo as a purchase invoice,
 * waits for the extraction and hands the form an editable draft whose save
 * also attaches the file and confirms the extraction.
 */
function ScanToPurchaseInvoiceDraft({
  onDraft,
}: {
  onDraft: (draft: PurchaseInvoiceDraft) => void;
}) {
  const scan = useScanDocument("purchase_invoice");
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [pollUntil, setPollUntil] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const draftQuery = usePurchaseInvoiceDraft(extractionId, pollUntil);
  const submitCreate = useSubmitPurchaseInvoiceDraft(extractionId ?? "");
  const delivered = useRef(false);

  const result = draftQuery.data;
  const processing = extractionId !== null && result?.state === "processing";
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!processing) return;
    const timer = setTimeout(
      () => setTimedOut(true),
      Math.max(0, pollUntil - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [processing, pollUntil]);

  useEffect(() => {
    if (!extractionId || result?.state !== "ready" || delivered.current) {
      return;
    }
    delivered.current = true;
    onDraft({ data: result.draft, source: result.source, submitCreate });
  }, [extractionId, result, onDraft, submitCreate]);

  function reset() {
    scan.reset();
    delivered.current = false;
    setExtractionId(null);
    setUploadError(null);
    setTimedOut(false);
  }

  function keepWaiting() {
    setTimedOut(false);
    setPollUntil(Date.now() + DRAFT_POLL_TIMEOUT_MS);
    void draftQuery.refetch();
  }

  function onFile(file: File) {
    setUploadError(null);
    scan.mutate(file, {
      onSuccess: ({ extractionId: id }) => {
        setPollUntil(Date.now() + DRAFT_POLL_TIMEOUT_MS);
        setExtractionId(id);
      },
      onError: (err) => setUploadError(err.message),
    });
  }

  let body: React.ReactNode;
  if (uploadError) {
    body = (
      <Problem
        message={uploadError}
        action="Probar de nuevo"
        onAction={reset}
      />
    );
  } else if (scan.isPending) {
    body = <Progress current={0} />;
  } else if (!extractionId) {
    body = (
      <FileDropzone
        onFile={onFile}
        onError={setUploadError}
        fileType="documents"
        className="border-none p-2"
        placeholder="Completar desde archivo"
        description="Subí el PDF o sacale una foto a la factura: la IA completa el formulario y el archivo queda adjunto."
      />
    );
  } else if (draftQuery.isError) {
    body = (
      <Problem
        message={draftQuery.error.message}
        action="Probar con otro archivo"
        onAction={reset}
      />
    );
  } else if (!result || result.state === "processing") {
    body = timedOut ? (
      <Problem
        message="Está tardando más de lo normal. Podés cerrar y seguir desde Documentos cuando esté listo."
        action="Seguir esperando"
        onAction={keepWaiting}
      />
    ) : (
      <Progress current={1} />
    );
  } else if (result.state === "ready") {
    body = <Progress current={2} />;
  } else {
    body = (
      <Problem
        message={
          result.state === "unsupported"
            ? "El archivo no parece una factura de compra."
            : result.state === "closed"
              ? "Este documento ya fue procesado o descartado."
              : "No se pudo leer el archivo. Cargá la factura a mano o probá con otra foto."
        }
        action="Probar con otro archivo"
        onAction={reset}
      />
    );
  }

  return <div className="rounded-lg border border-dashed p-3">{body}</div>;
}

function renderScanAssist(onDraft: (draft: PurchaseInvoiceDraft) => void) {
  return <ScanToPurchaseInvoiceDraft onDraft={onDraft} />;
}

/**
 * Offers "fill from file" in the purchase-invoice dialogs below it, to users
 * who can scan documents and load purchase invoices.
 */
export function PurchaseInvoiceFileAssistBinding({
  roles,
  children,
}: {
  roles: readonly Role[];
  children: React.ReactNode;
}) {
  const enabled =
    userCan(roles, "ai:read") &&
    userCan(roles, "files:write") &&
    userCan(roles, "purchase_invoices:write");
  return (
    <PurchaseInvoiceFileAssistProvider
      assist={enabled ? renderScanAssist : null}
    >
      {children}
    </PurchaseInvoiceFileAssistProvider>
  );
}
