import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import { fetchLibroIvaComprasRows } from "@/features/libro-iva/lib/fetch-books";
import { fetchLibroIvaHeader } from "@/features/libro-iva/lib/fetch-header";
import { formatArgentineDateTime } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";

import {
  LibroIvaComprasDocument,
  type LibroIvaComprasTemplateData,
} from "./libro-iva-compras-template";

export async function buildLibroIvaComprasTemplateData(
  period: string,
  channelId: string | null,
): Promise<LibroIvaComprasTemplateData> {
  const supabase = getServiceClient();
  const { data: rows, error } = await fetchLibroIvaComprasRows(
    supabase,
    period,
    channelId,
  );
  if (error) {
    throw new Error(`Could not read libro IVA Compras: ${error.message}`);
  }

  const header = await fetchLibroIvaHeader(supabase, period, channelId);
  if (header.error) {
    throw new Error(
      `Could not read the libro IVA Compras header: ${header.error.message}`,
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

export async function renderLibroIvaComprasPdf(
  data: LibroIvaComprasTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<LibroIvaComprasDocument {...data} />);
}
