import { NextResponse } from "next/server";

import { libroIvaComprasSheet } from "@/features/libro-iva/lib/libro-iva-xlsx";
import { buildXlsx } from "@/lib/export/xlsx";
import { xlsxResponse } from "@/lib/export/xlsx-response";
import { buildLibroIvaComprasTemplateData } from "@/lib/pdf/libro-iva-compras-render";

import { readLibroIvaRequest } from "../../libro-iva-request";

export async function GET(req: Request) {
  const request = await readLibroIvaRequest(req);
  if (!request.ok) return request.response;
  const { period, channel } = request;

  try {
    const data = await buildLibroIvaComprasTemplateData(period, channel);
    const file = await buildXlsx(libroIvaComprasSheet(data));
    return xlsxResponse(file, `libro-iva-compras-${period}.xlsx`);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando Excel." },
      { status: 500 },
    );
  }
}
