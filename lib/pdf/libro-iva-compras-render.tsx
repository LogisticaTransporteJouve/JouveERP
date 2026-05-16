import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import type { LibroIvaComprasRow } from "@/features/libro-iva/schema";
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
  const { data, error } = await supabase.rpc("libro_iva_compras", {
    p_period: period,
    p_channel_id: channelId ?? undefined,
  });
  if (error) {
    throw new Error(`No se pudo leer libro IVA Compras: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as LibroIvaComprasRow[];

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
    generatedAt: new Date().toLocaleString("es-AR"),
    rows,
  };
}

export async function renderLibroIvaComprasPdf(
  data: LibroIvaComprasTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<LibroIvaComprasDocument {...data} />);
}
