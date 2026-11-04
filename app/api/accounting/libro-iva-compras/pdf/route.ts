import { NextResponse } from "next/server";

import {
  buildLibroIvaComprasTemplateData,
  renderLibroIvaComprasPdf,
} from "@/lib/pdf/libro-iva-compras-render";
import { pdfFailureResponse } from "@/lib/pdf/pdf-failure-response";

import { readLibroIvaRequest } from "../../libro-iva-request";

export async function GET(req: Request) {
  const request = await readLibroIvaRequest(req);
  if (!request.ok) return request.response;
  const { period, channel } = request;

  try {
    const data = await buildLibroIvaComprasTemplateData(period, channel);
    const buffer = await renderLibroIvaComprasPdf(data);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="libro-iva-compras-${period}.pdf"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    return pdfFailureResponse("libro_iva.compras.pdf.failed", err, { period });
  }
}
