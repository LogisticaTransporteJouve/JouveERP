import { NextResponse } from "next/server";

import {
  buildLibroIvaVentasTemplateData,
  renderLibroIvaVentasPdf,
} from "@/lib/pdf/libro-iva-ventas-render";
import { pdfFailureResponse } from "@/lib/pdf/pdf-failure-response";

import { readLibroIvaRequest } from "../../libro-iva-request";

export async function GET(req: Request) {
  const request = await readLibroIvaRequest(req);
  if (!request.ok) return request.response;
  const { period, channel } = request;

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
    return pdfFailureResponse("libro_iva.ventas.pdf.failed", err, { period });
  }
}
