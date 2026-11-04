import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildFreightSettlementTemplateData,
  renderFreightSettlementPdf,
} from "@/lib/pdf/freight-settlement-render";
import { pdfFailureResponse } from "@/lib/pdf/pdf-failure-response";

// The liquidación's R document is internal (not AFIP): rendered on every
// request, like /api/receipts/[id]/pdf.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "invoices:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver liquidaciones." },
      { status: 403 },
    );
  }

  const { id } = await params;
  try {
    const data = await buildFreightSettlementTemplateData(id, ctx.access);
    const buffer = await renderFreightSettlementPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return pdfFailureResponse("freight_settlement.pdf.failed", err, { id });
  }
}
