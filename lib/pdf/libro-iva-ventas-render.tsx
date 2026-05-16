import "server-only";

import { renderToBuffer } from "@react-pdf/renderer";

import type { LibroIvaVentasRow } from "@/features/libro-iva/schema";
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
  const { data, error } = await supabase.rpc("libro_iva_ventas", {
    p_period: period,
    p_channel_id: channelId ?? undefined,
  });
  if (error) {
    throw new Error(`No se pudo leer libro IVA Ventas: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as LibroIvaVentasRow[];

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

export async function renderLibroIvaVentasPdf(
  data: LibroIvaVentasTemplateData,
): Promise<Buffer> {
  return renderToBuffer(<LibroIvaVentasDocument {...data} />);
}
