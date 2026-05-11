import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildTemplateData,
  generateAndStoreInvoicePdf,
} from "@/lib/pdf/generate-and-store";
import { renderInvoicePdf } from "@/lib/pdf/render";

// Two modes:
//   GET /api/invoices/<id>/pdf            → returns the stored PDF (or
//                                              regenerates+stores if missing)
//   GET /api/invoices/<id>/pdf?preview=1  → renders fresh on the fly
//                                              without uploading. Used by
//                                              /admin/afip/preview-pdf.

export async function GET(
  req: Request,
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
  const url = new URL(req.url);
  const previewOnly = url.searchParams.get("preview") === "1";

  try {
    // No `filename` in Content-Disposition: the browser would prefer the
    // server-supplied name over the `download` attribute on the anchor,
    // and we set the desired filename (with the comprobante number + the
    // client name) at the link level.
    if (previewOnly) {
      const data = await buildTemplateData(id);
      const buffer = await renderInvoicePdf(data);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": "inline",
          "Cache-Control": "no-store",
        },
      });
    }

    const result = await generateAndStoreInvoicePdf(id);
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando PDF." },
      { status: 500 },
    );
  }
}
