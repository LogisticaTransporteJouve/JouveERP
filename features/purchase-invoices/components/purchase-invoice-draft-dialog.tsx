"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { FilePreviewSurface } from "@/components/file-preview/file-preview-surface";
import { ReadError } from "@/components/read-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchSignedUrl } from "@/features/files/hooks/use-attachments";

import type {
  PurchaseInvoiceDraft,
  PurchaseInvoiceDraftSource,
} from "../lib/purchase-invoice-draft";
import { PurchaseInvoiceForm } from "./purchase-invoice-form";

function useSignedUrl(fileId: string) {
  const [state, setState] = useState<{
    url: string | null;
    loading: boolean;
  }>({ url: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ url: null, loading: true });
    fetchSignedUrl(fileId)
      .then((signed) => {
        if (!cancelled) setState({ url: signed.url, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

function SourcePreview({ source }: { source: PurchaseInvoiceDraftSource }) {
  const { url, loading, retry } = useSignedUrl(source.fileId);
  return (
    <>
      <div className="hidden min-h-0 border-r bg-muted/20 p-4 lg:block">
        <FilePreviewSurface
          url={url}
          filename={source.filename}
          mimeType={source.mimeType}
          isLoading={loading}
          onRetry={retry}
          className="h-full w-full"
        />
      </div>
      {!url && !loading && (
        <ReadError
          message="No se pudo cargar el archivo."
          onRetry={retry}
          className="px-4 pt-3 text-xs lg:hidden"
        />
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground flex items-center gap-1 px-4 pt-3 text-xs underline underline-offset-2 lg:hidden"
        >
          <ExternalLink className="size-3" />
          Ver {source.filename}
        </a>
      )}
    </>
  );
}

/**
 * Dialog body once a document filled the invoice: the source file on the left
 * (desktop) and the editable form on the right. An ARCA voucher has no file:
 * the form lays out its own two columns (the voucher, then the imputación).
 */
export function PurchaseInvoiceDraftDialogContent({
  draft,
  onCreated,
  onClose,
}: {
  draft: PurchaseInvoiceDraft;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const source = draft.source;
  const fromArca = draft.origin === "arca";
  const formElement = (
    <PurchaseInvoiceForm
      mode="create"
      draft={draft}
      onSuccess={onCreated}
      onCancel={onClose}
    />
  );
  const form = fromArca ? (
    formElement
  ) : (
    <div className="min-h-0 overflow-y-auto p-4">{formElement}</div>
  );
  return (
    <DialogContent
      className={
        source
          ? "flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:h-[92vh] lg:max-w-6xl"
          : fromArca
            ? "flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:max-w-6xl"
            : "flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      }
    >
      <DialogHeader className="border-b px-4 py-3 text-left">
        {fromArca ? (
          <>
            <DialogTitle>Aceptar comprobante recibido de ARCA</DialogTitle>
            <DialogDescription>
              Los datos y los importes vienen de ARCA → Mis Comprobantes y no se
              pueden cambiar. Elegí canal, cuenta y centro de costo, y aceptalo.
            </DialogDescription>
          </>
        ) : (
          <>
            <DialogTitle>Cargar factura de compra</DialogTitle>
            <DialogDescription>
              {source
                ? `Datos leídos de ${source.filename}. Revisalos y corregí lo que haga falta; el archivo queda adjunto a la factura.`
                : "Revisá los datos y corregí lo que haga falta."}
            </DialogDescription>
          </>
        )}
      </DialogHeader>
      {source ? (
        <div className="grid min-h-0 flex-1 lg:grid-cols-2">
          <SourcePreview source={source} />
          {form}
        </div>
      ) : (
        form
      )}
    </DialogContent>
  );
}

/** Standalone dialog for a draft built elsewhere (e.g. the documents tray). */
export function PurchaseInvoiceDraftDialog({
  draft,
  open,
  onOpenChange,
  onCreated,
}: {
  draft: PurchaseInvoiceDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PurchaseInvoiceDraftDialogContent
        draft={draft}
        onCreated={onCreated}
        onClose={() => onOpenChange(false)}
      />
    </Dialog>
  );
}
