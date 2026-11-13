"use client";

import { Loader2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

type Props = {
  /** Same-origin PDF route (it needs the user's session). */
  pdfUrl: string;
  /** Name of the attached file, e.g. "Factura A 0003-00000123.pdf". */
  fileName: string;
  /** Message that goes with the PDF. */
  text: string;
};

const PDF_TYPE = "application/pdf";

/** Whether the browser can hand a PDF file to another app (phones). */
function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || !navigator.canShare) return false;
  try {
    return navigator.canShare({
      files: [new File([""], "x.pdf", { type: PDF_TYPE })],
    });
  } catch {
    return false;
  }
}

/**
 * «WhatsApp»: sends a document's PDF through the user's own WhatsApp. On a
 * phone it opens the share sheet with the PDF attached (pick WhatsApp and the
 * chat). Elsewhere it opens WhatsApp with the message written and downloads
 * the PDF to attach by hand. No link to the document leaves the app.
 */
export function ShareWhatsAppButton({ pdfUrl, fileName, text }: Props) {
  const [pending, setPending] = useState(false);

  async function loadPdf(): Promise<File> {
    const res = await fetch(pdfUrl, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    return new File([blob], fileName, { type: PDF_TYPE });
  }

  async function onClick() {
    if (canShareFiles()) {
      setPending(true);
      try {
        const file = await loadPdf();
        await navigator.share({ files: [file], text });
      } catch (err) {
        // Closing the share sheet is not an error.
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          toast.error("No se pudo compartir el PDF.");
        }
      } finally {
        setPending(false);
      }
      return;
    }

    // Opened before any await, so the browser does not block the new tab.
    const chat = window.open(
      `https://wa.me/?text=${encodeURIComponent(text)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setPending(true);
    try {
      const file = await loadPdf();
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        chat
          ? "Se descargó el PDF: adjuntalo en el chat de WhatsApp."
          : "Se descargó el PDF. Abrí WhatsApp y adjuntalo.",
      );
    } catch {
      toast.error("No se pudo descargar el PDF.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void onClick()}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : <MessageCircle />}
      WhatsApp
    </Button>
  );
}
