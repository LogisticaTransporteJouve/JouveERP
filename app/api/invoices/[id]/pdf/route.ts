import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { generateInvoicePdfBuffer } from "@/lib/pdf/generate-and-hash";

// M.0 — Always regenerate the PDF on-demand. The hash (`pdf_hash` on the
// invoice row) is computed at issuance and persisted to provide
// cryptographic proof of integrity: regenerating with the same data
// must yield a bit-for-bit identical PDF and therefore the same hash.
//
// `?preview=1` is kept for backward compatibility with /admin/afip/preview-pdf
// but its behavior is identical to the normal mode.

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
