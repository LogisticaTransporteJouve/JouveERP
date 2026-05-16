import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildPaymentOrderTemplateData,
  renderPaymentOrderPdf,
} from "@/lib/pdf/payment-order-render";

// Payment orders son internas (no AFIP) — render on-the-fly cada request.
// Inline cache 60s para refresh / re-prints rápidos. Mismo patrón que
// /api/receipts/[id]/pdf.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "payment_orders:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver órdenes de pago." },
      { status: 403 },
    );
  }

  const { id } = await params;
  try {
    const data = await buildPaymentOrderTemplateData(id);
    const buffer = await renderPaymentOrderPdf(data);
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
