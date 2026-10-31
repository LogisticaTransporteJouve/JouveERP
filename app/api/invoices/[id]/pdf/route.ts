import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { isFiscalOnly, userCan } from "@/lib/auth/permissions";
import { generateInvoicePdfBuffer } from "@/lib/pdf/generate-and-hash";
import { createClient } from "@/lib/supabase/server";

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
  if (!userCan(ctx.access, "invoices:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver comprobantes." },
      { status: 403 },
    );
  }

  const { id } = await params;

  // The PDF is rendered with the service client; a fiscal-only user first
  // proves under RLS that the invoice is one they may read (a fiscal one).
  if (isFiscalOnly(ctx.access)) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("invoices")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) {
      return NextResponse.json(
        { error: "Comprobante no encontrado." },
        { status: 404 },
      );
    }
  }

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
