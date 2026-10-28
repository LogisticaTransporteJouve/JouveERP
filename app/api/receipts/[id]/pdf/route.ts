import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildReceiptTemplateData,
  renderReceiptPdf,
} from "@/lib/pdf/receipt-render";

// Receipts are non-fiscal in Argentina so we don't persist the PDF in
// storage — render on-the-fly each request. Inline cache for 60s so
// repeated views of the same receipt are cheap.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver recibos." },
      { status: 403 },
    );
  }

  const { id } = await params;
  try {
    const data = await buildReceiptTemplateData(id);
    const buffer = await renderReceiptPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
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
