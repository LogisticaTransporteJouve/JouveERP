import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildDriverSettlementTemplateData,
  renderDriverSettlementPdf,
} from "@/lib/pdf/driver-settlement-render";
import { pdfFailureResponse } from "@/lib/pdf/pdf-failure-response";

const IdSchema = z.string().uuid();

// The rendición is an internal treasury document (not AFIP): rendered on
// every request, like /api/freight-settlements/[id]/pdf.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.access, "receipts:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver rendiciones." },
      { status: 403 },
    );
  }

  const parsed = IdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return NextResponse.json({ error: "Rendición inválida." }, { status: 400 });
  }
  try {
    const data = await buildDriverSettlementTemplateData(parsed.data);
    const buffer = await renderDriverSettlementPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return pdfFailureResponse("driver_settlement.pdf.failed", err, {
      id: parsed.data,
    });
  }
}
