import { NextResponse } from "next/server";

import { libroIvaVentasSheet } from "@/features/libro-iva/lib/libro-iva-xlsx";
import { exportSlug } from "@/lib/export/download";
import { buildXlsx } from "@/lib/export/xlsx";
import { xlsxResponse } from "@/lib/export/xlsx-response";
import { logger } from "@/lib/logger";
import { buildLibroIvaVentasTemplateData } from "@/lib/pdf/libro-iva-ventas-render";

import { readLibroIvaRequest } from "../../libro-iva-request";

export async function GET(req: Request) {
  const request = await readLibroIvaRequest(req);
  if (!request.ok) return request.response;
  const { period, channel } = request;

  try {
    const data = await buildLibroIvaVentasTemplateData(period, channel);
    const file = await buildXlsx(libroIvaVentasSheet(data));
    const channelSlug = channel ? exportSlug(data.channelName) : "";
    return xlsxResponse(
      file,
      `libro-iva-ventas-${period}${channelSlug ? `-${channelSlug}` : ""}.xlsx`,
    );
  } catch (error) {
    logger.error("libro_iva.ventas.xlsx.failed", { period, error });
    return NextResponse.json(
      { error: "Error generando el Excel." },
      { status: 500 },
    );
  }
}
