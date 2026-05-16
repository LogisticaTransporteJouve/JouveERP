import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { generateInvoicePdfBuffer } from "@/lib/pdf/generate-and-hash";

// M.0 — Siempre regenera el PDF on-demand. El hash (`pdf_hash` en la fila
// de la invoice) se calcula en la emisión y se persiste para tener
// prueba criptográfica de integridad: regenerar con los mismos datos
// debe dar bit-a-bit el mismo PDF y por ende el mismo hash.
//
// `?preview=1` queda para retrocompatibilidad con /admin/afip/preview-pdf
// pero su comportamiento es idéntico al modo normal.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "invoices:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver comprobantes." },
      { status: 403 },
    );
  }

  const { id } = await params;

  try {
    const result = await generateInvoicePdfBuffer(id);
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
        "X-PDF-Hash": result.pdfHash,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando PDF." },
      { status: 500 },
    );
  }
}
