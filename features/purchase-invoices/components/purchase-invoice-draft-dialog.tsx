"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { FilePreviewSurface } from "@/components/file-preview/file-preview-surface";
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

function useSignedUrl(fileId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    fetchSignedUrl(fileId)
      .then((signed) => {
        if (!cancelled) setUrl(signed.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fileId]);
  return url;
}

function SourcePreview({ source }: { source: PurchaseInvoiceDraftSource }) {
  const url = useSignedUrl(source.fileId);
  return (
    <>
      <div className="hidden min-h-0 border-r bg-muted/20 p-4 lg:block">
        <FilePreviewSurface
          url={url}
          filename={source.filename}
          mimeType={source.mimeType}
          isLoading={url === null}
          className="h-full w-full"
        />
      </div>
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
 * (desktop) and the editable form on the right.
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
  return (
    <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl lg:h-[92vh] lg:max-w-6xl">
      <DialogHeader className="border-b px-4 py-3 text-left">
        <DialogTitle>Cargar factura de compra</DialogTitle>
        <DialogDescription>
          Datos leídos de {draft.source.filename}. Revisalos y corregí lo que
          haga falta; el archivo queda adjunto a la factura.
        </DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <SourcePreview source={draft.source} />
        <div className="min-h-0 overflow-y-auto p-4">
          <PurchaseInvoiceForm
            mode="create"
            draft={draft}
            onSuccess={onCreated}
            onCancel={onClose}
          />
        </div>
      </div>
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
