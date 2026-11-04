import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import { fetchLibroIvaVentasRows } from "@/features/libro-iva/lib/fetch-books";
import { fetchLibroIvaHeader } from "@/features/libro-iva/lib/fetch-header";
import { formatArgentineDateTime } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";

import {
  LibroIvaVentasDocument,
  type LibroIvaVentasTemplateData,
} from "./libro-iva-ventas-template";

export async function buildLibroIvaVentasTemplateData(
  period: string,
  channelId: string | null,
): Promise<LibroIvaVentasTemplateData> {
  const supabase = getServiceClient();
  const { data: rows, error } = await fetchLibroIvaVentasRows(
    supabase,
    period,
    channelId,
  );
  if (error) {
    throw new Error(`Could not read libro IVA Ventas: ${error.message}`);
  }

  const header = await fetchLibroIvaHeader(supabase, period, channelId);
  if (header.error) {
    throw new Error(
      `Could not read the libro IVA Ventas header: ${header.error.message}`,
    );
  }

  let channelName = "Todos los canales fiscales";
  if (channelId) {
    const ch = await supabase
      .from("invoicing_channels")
      .select("name")
      .eq("id", channelId)
      .maybeSingle();
    channelName = ch.data?.name ?? channelId;
  }

  return {
    period,
    channelName,
    generatedAt: formatArgentineDateTime(new Date().toISOString()),
    header: header.data,
    rows,
  };
}

export async function renderLibroIvaVentasPdf(
  data: LibroIvaVentasTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<LibroIvaVentasDocument {...data} />);
}
