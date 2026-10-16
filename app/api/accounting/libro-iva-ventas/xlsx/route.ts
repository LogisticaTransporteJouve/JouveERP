import { NextResponse } from "next/server";

import { libroIvaVentasSheet } from "@/features/libro-iva/lib/libro-iva-xlsx";
import { buildXlsx } from "@/lib/export/xlsx";
import { xlsxResponse } from "@/lib/export/xlsx-response";
import { buildLibroIvaVentasTemplateData } from "@/lib/pdf/libro-iva-ventas-render";

import { readLibroIvaRequest } from "../../libro-iva-request";

export async function GET(req: Request) {
  const request = await readLibroIvaRequest(req);
  if (!request.ok) return request.response;
  const { period, channel } = request;

  try {
    const data = await buildLibroIvaVentasTemplateData(period, channel);
    const file = await buildXlsx(libroIvaVentasSheet(data));
    return xlsxResponse(file, `libro-iva-ventas-${period}.xlsx`);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Error generando Excel." },
      { status: 500 },
    );
  }
}
