import { NextResponse } from "next/server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import {
  buildLibroIvaVentasTemplateData,
  renderLibroIvaVentasPdf,
} from "@/lib/pdf/libro-iva-ventas-render";

const PERIOD_RE = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export async function GET(req: Request) {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "accounting:read")) {
    return NextResponse.json(
      { error: "No tenés permiso para ver el libro IVA." },
      { status: 403 },
    );
  }

  const url = new URL(req.url);
  const period = url.searchParams.get("period");
  const channel = url.searchParams.get("channel");

  if (!period || !PERIOD_RE.test(period)) {
    return NextResponse.json(
      { error: "Parámetro period inválido (esperado YYYY-MM)." },
      { status: 400 },
    );
  }

  try {
    const data = await buildLibroIvaVentasTemplateData(period, channel);
    const buffer = await renderLibroIvaVentasPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="libro-iva-ventas-${period}.pdf"`,
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
