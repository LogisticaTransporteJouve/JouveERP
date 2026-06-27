import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CircleDot,
  CircleX,
  type LucideIcon,
} from "lucide-react";

import type { ExtractionStatus } from "../types";

/** Human label per document kind (shared by the tray, table and detail). */
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  factura_compra: "Factura de compra",
  factura_venta: "Factura de venta",
  nc_nd: "NC / ND",
  recibo: "Recibo",
  orden_pago: "Orden de pago",
  remito: "Remito",
  cheque: "Cheque",
  extracto: "Extracto bancario",
  otro: "Otro",
};

/** One-line description per kind (tooltips). */
export const DOCUMENT_TYPE_DESCRIPTIONS: Record<string, string> = {
  factura_compra: "Factura recibida de un proveedor.",
  factura_venta: "Factura emitida a un cliente.",
  nc_nd: "Nota de crédito o débito.",
  recibo: "Comprobante de cobro o pago recibido.",
  orden_pago: "Orden de pago a un proveedor.",
  remito: "Remito de mercadería — productos y cantidades, sin importes.",
  cheque: "Cheque propio, de tercero o diferido.",
  extracto: "Extracto bancario con movimientos y saldos.",
  otro: "Documento sin tipo estructurado.",
};

export function documentTypeLabel(kind: string | null | undefined): string {
  if (!kind) return "—";
  return DOCUMENT_TYPE_LABELS[kind] ?? kind;
}

export type StatusConfig = {
  label: string;
  icon: LucideIcon;
  className: string;
};

/** Monochrome status visuals (icon + copy; danger reserved for failures). */
export const EXTRACTION_STATUS_CONFIG: Record<ExtractionStatus, StatusConfig> = {
  pending_review: { label: "Pendiente", icon: CircleDot, className: "text-foreground" },
  confirmed: { label: "Confirmado", icon: CheckCircle2, className: "text-foreground" },
  discarded: { label: "Descartado", icon: CircleX, className: "text-muted-foreground" },
  failed: { label: "Falló", icon: AlertTriangle, className: "text-destructive" },
};

export function statusConfig(status: string): StatusConfig {
  return (
    EXTRACTION_STATUS_CONFIG[status as ExtractionStatus] ??
    EXTRACTION_STATUS_CONFIG.pending_review
  );
}

export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(confidence: number | null): ConfidenceBand | null {
  if (confidence == null) return null;
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export const CONFIDENCE_CONFIG: Record<
  ConfidenceBand,
  { label: string; icon: LucideIcon }
> = {
  high: { label: "Alta", icon: ArrowUp },
  medium: { label: "Media", icon: ArrowRight },
  low: { label: "Baja", icon: ArrowDown },
};
