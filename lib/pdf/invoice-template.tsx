import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

import { invoiceKindLabel } from "@/features/invoices/schema";
import type { InvoiceKind, InvoiceLetter } from "@/lib/afip/codes";
import {
  CONDICION_IVA_RECEPTOR,
  ivaRatePercent,
  type IvaRateId,
} from "@/lib/afip/codes";

// Single PDF template that renders fiscal AND internal comprobantes. The
// `isFiscal` flag toggles the AFIP-specific furniture (letter box, CAE
// leyenda, QR) and a "DOCUMENTO NO FISCAL" watermark in the internal case.
//
// React-pdf doesn't support CSS — only a subset of flexbox + StyleSheet —
// so layouts are explicit. Numbers go through `formatARS` (Argentine peso
// formatter) since `Intl.NumberFormat` is supported in the renderer.

export interface InvoiceTemplateItem {
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate_id: IvaRateId | null;
  line_neto: number;
  line_total: number;
}

export interface InvoiceTemplateData {
  isFiscal: boolean;
  /** ISO timestamp the PDF carries as its creation date, so re-rendering the
   *  same invoice yields the same bytes (and the same `pdf_hash`). */
  emittedAt: string;

  // Issuer (always JouveERP / DZ & Sons)
  emisor: {
    legal_name: string;
    cuit: string;
    iva_condition: string;
    address: string | null;
    division_label: string; // "Logística Jouve"
    iibb_number: string | null; // "no contribuyente" if not registered
    inicio_actividades: string | null; // YYYY-MM-DD
  };

  // Receiver
  receptor: {
    legal_name: string;
    doc_tipo_label: string; // "CUIT" / "DNI" / "CF"
    doc_nro: string;
    iva_condition_label: string | null;
    /** AFIP CondicionIVAReceptorId sent with the voucher; null when internal. */
    condicion_iva_receptor: number | null;
    address: string | null;
  };

  // Comprobante metadata
  kind: InvoiceKind;
  letter: InvoiceLetter | null; // null for internal
  punto_venta: number;
  numero: number;
  fecha: string; // YYYY-MM-DD
  fch_serv_desde: string | null;
  fch_serv_hasta: string | null;
  fch_vto_pago: string | null;
  concepto_label: string;

  // Items + totals
  items: InvoiceTemplateItem[];
  imp_neto: number;
  imp_iva: number;
  imp_trib: number;
  imp_tot_conc: number; // no gravado
  imp_op_ex: number; // exento
  imp_total: number;
  per_rate: Array<{ id: IvaRateId; base: number; importe: number }>;
  moneda: string;
  cotizacion: number;

  // AFIP (only when isFiscal)
  cae: string | null;
  cae_vencimiento: string | null; // YYYY-MM-DD
  qr_data_url: string | null;
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 32,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: "#0a0a0a",
  },
  copyBadge: {
    position: "absolute",
    top: 16,
    right: 32,
    border: "1pt solid #0a0a0a",
    paddingHorizontal: 8,
    paddingVertical: 2,
    fontSize: 8,
    fontWeight: "bold",
  },
  fiscalLeyenda: {
    marginTop: 12,
    padding: 6,
    border: "0.5pt solid #525252",
    fontSize: 8,
    lineHeight: 1.4,
    color: "#525252",
  },
  watermark: {
    position: "absolute",
    top: 320,
    left: 80,
    right: 80,
    transform: "rotate(-22deg)",
    fontSize: 60,
    color: "#e5e5e5",
    fontWeight: "bold",
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    borderBottom: "1pt solid #0a0a0a",
    paddingBottom: 8,
  },
  headerLeft: { flex: 1 },
  letterBox: {
    width: 80,
    height: 80,
    border: "1pt solid #0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
  },
  letterBig: { fontSize: 36, fontWeight: "bold" },
  letterCode: { fontSize: 8, marginTop: 2 },
  headerRight: { flex: 1, textAlign: "right" },
  emisorName: { fontSize: 14, fontWeight: "bold" },
  emisorMeta: { marginTop: 4, lineHeight: 1.4 },
  comprobanteHeading: { fontSize: 14, fontWeight: "bold" },
  comprobanteSubheading: { fontSize: 11, marginTop: 2 },
  metaRow: { flexDirection: "row", marginTop: 12 },
  metaLabel: { fontWeight: "bold", marginRight: 4 },
  receptorBox: {
    marginTop: 16,
    border: "1pt solid #d4d4d4",
    padding: 8,
  },
  receptorTitle: { fontWeight: "bold", marginBottom: 4 },
  receptorRow: { flexDirection: "row", marginTop: 2 },
  itemsTable: { marginTop: 16 },
  itemsHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: "1pt solid #d4d4d4",
    fontWeight: "bold",
  },
  itemsRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: "0.5pt solid #e5e5e5",
  },
  colDescription: { flex: 4 },
  colNumber: { flex: 1, textAlign: "right" },
  totalsBox: {
    marginTop: 16,
    alignSelf: "flex-end",
    width: 240,
    borderTop: "1pt solid #0a0a0a",
    paddingTop: 6,
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalsRowFinal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderTop: "1pt solid #0a0a0a",
    marginTop: 4,
    fontWeight: "bold",
    fontSize: 11,
  },
  footer: {
    marginTop: 24,
    paddingTop: 8,
    borderTop: "1pt solid #d4d4d4",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  footerInfo: { flex: 1 },
  footerLabel: { fontWeight: "bold" },
  qrImage: { width: 110, height: 110 },
  noFiscalNote: {
    marginTop: 24,
    paddingTop: 8,
    borderTop: "1pt solid #d4d4d4",
    fontStyle: "italic",
    color: "#525252",
  },
});

const arsFormatter = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatARS(n: number): string {
  return arsFormatter.format(n);
}

function formatPaddedNumero(numero: number): string {
  return String(numero).padStart(8, "0");
}

function formatPaddedPtoVta(ptoVta: number): string {
  return String(ptoVta).padStart(5, "0");
}

type CopyLabel = "ORIGINAL" | "DUPLICADO" | null;

const REGIMEN_TRANSPARENCIA_LEYENDA =
  "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743). El monto de IVA discriminado y los demás impuestos nacionales indirectos contenidos en esta operación se detallan a continuación.";

const MONOTRIBUTO_RECEPTOR_LEYENDA =
  "El crédito fiscal discriminado en el presente comprobante sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley N° 27.618.";

const MONOTRIBUTO_RECEPTOR_CONDITIONS: readonly number[] = [
  CONDICION_IVA_RECEPTOR.MONOTRIBUTO,
  CONDICION_IVA_RECEPTOR.MONOTRIBUTO_SOCIAL,
  CONDICION_IVA_RECEPTOR.MONOTRIBUTO_PROMOVIDO,
];

export function isFacturaBToConsumidorFinal(
  data: InvoiceTemplateData,
): boolean {
  return (
    data.isFiscal &&
    data.kind === "factura" &&
    data.letter === "B" &&
    data.receptor.condicion_iva_receptor ===
      CONDICION_IVA_RECEPTOR.CONSUMIDOR_FINAL
  );
}

/** RG 5003: an A voucher to a monotributista carries the Ley 27.618 legend. */
export function isLetterAToMonotributo(data: InvoiceTemplateData): boolean {
  return (
    data.isFiscal &&
    data.letter === "A" &&
    data.receptor.condicion_iva_receptor !== null &&
    MONOTRIBUTO_RECEPTOR_CONDITIONS.includes(
      data.receptor.condicion_iva_receptor,
    )
  );
}

export function InvoiceDocument({ data }: { data: InvoiceTemplateData }) {
  if (!data.isFiscal) {
    return (
      <Document creationDate={new Date(data.emittedAt)} producer="JouveERP">
        <InvoicePage data={data} copyLabel={null} />
      </Document>
    );
  }
  // RG 1415: every fiscal invoice is printed twice — ORIGINAL keeps with the
  // receptor, DUPLICADO with the emisor.
  return (
    <Document creationDate={new Date(data.emittedAt)} producer="JouveERP">
      <InvoicePage data={data} copyLabel="ORIGINAL" />
      <InvoicePage data={data} copyLabel="DUPLICADO" />
    </Document>
  );
}

function InvoicePage({
  data,
  copyLabel,
}: {
  data: InvoiceTemplateData;
  copyLabel: CopyLabel;
}) {
  const subtitle = data.isFiscal
    ? data.letter
      ? `Letra ${data.letter}`
      : "Sin letra"
    : "Documento no fiscal";
  const heading = invoiceKindLabel(data.kind, data.isFiscal);

  return (
    <Page size="A4" style={styles.page}>
      {!data.isFiscal && <Text style={styles.watermark}>NO FISCAL</Text>}
      {copyLabel && <Text style={styles.copyBadge}>{copyLabel}</Text>}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.emisorName}>{data.emisor.legal_name}</Text>
          <View style={styles.emisorMeta}>
            {data.emisor.division_label && (
              <Text>{data.emisor.division_label}</Text>
            )}
            {data.emisor.cuit && <Text>CUIT {data.emisor.cuit}</Text>}
            {data.emisor.iva_condition && (
              <Text>{data.emisor.iva_condition}</Text>
            )}
            {data.emisor.iibb_number && (
              <Text>Ingresos Brutos: {data.emisor.iibb_number}</Text>
            )}
            {data.emisor.inicio_actividades && (
              <Text>
                INICIO DE ACTIVIDADES: {data.emisor.inicio_actividades}
              </Text>
            )}
            {data.emisor.address && <Text>{data.emisor.address}</Text>}
          </View>
        </View>

        {data.isFiscal && data.letter && (
          <View style={styles.letterBox}>
            <Text style={styles.letterBig}>{data.letter}</Text>
            <Text style={styles.letterCode}>
              COD. {kindAfipCode(data.kind, data.letter)}
            </Text>
          </View>
        )}

        <View style={styles.headerRight}>
          <Text style={styles.comprobanteHeading}>{heading}</Text>
          <Text style={styles.comprobanteSubheading}>{subtitle}</Text>
          <Text style={{ marginTop: 8 }}>
            N°{" "}
            <Text style={{ fontWeight: "bold" }}>
              {formatPaddedPtoVta(data.punto_venta)}-
              {formatPaddedNumero(data.numero)}
            </Text>
          </Text>
          <Text style={{ marginTop: 4 }}>
            Fecha: <Text style={{ fontWeight: "bold" }}>{data.fecha}</Text>
          </Text>
        </View>
      </View>

      {/* Service period if applicable */}
      {(data.fch_serv_desde || data.fch_serv_hasta || data.fch_vto_pago) && (
        <View style={styles.metaRow}>
          {data.fch_serv_desde && (
            <Text>
              <Text style={styles.metaLabel}>Período desde:</Text>{" "}
              {data.fch_serv_desde}
            </Text>
          )}
          {data.fch_serv_hasta && (
            <Text style={{ marginLeft: 16 }}>
              <Text style={styles.metaLabel}>hasta:</Text> {data.fch_serv_hasta}
            </Text>
          )}
          {data.fch_vto_pago && (
            <Text style={{ marginLeft: 16 }}>
              <Text style={styles.metaLabel}>Vto. pago:</Text>{" "}
              {data.fch_vto_pago}
            </Text>
          )}
        </View>
      )}

      {/* Receptor */}
      <View style={styles.receptorBox}>
        <Text style={styles.receptorTitle}>Receptor</Text>
        <View style={styles.receptorRow}>
          <Text style={{ flex: 2 }}>{data.receptor.legal_name}</Text>
          {data.isFiscal && (
            <Text style={{ flex: 1, textAlign: "right" }}>
              {data.receptor.doc_tipo_label} {data.receptor.doc_nro}
            </Text>
          )}
        </View>
        <View style={styles.receptorRow}>
          <Text style={{ flex: 1 }}>
            {data.receptor.iva_condition_label ?? ""}
          </Text>
          {data.receptor.address && (
            <Text style={{ flex: 2, textAlign: "right" }}>
              {data.receptor.address}
            </Text>
          )}
        </View>
      </View>

      {/* Items */}
      <View style={styles.itemsTable}>
        <View style={styles.itemsHeader}>
          <Text style={styles.colDescription}>Descripción</Text>
          <Text style={styles.colNumber}>Cant.</Text>
          <Text style={styles.colNumber}>P. Unit.</Text>
          {data.isFiscal && <Text style={styles.colNumber}>IVA</Text>}
          <Text style={styles.colNumber}>Subtotal</Text>
        </View>
        {data.items.map((item, idx) => (
          <View key={idx} style={styles.itemsRow}>
            <Text style={styles.colDescription}>{item.description}</Text>
            <Text style={styles.colNumber}>{formatARS(item.quantity)}</Text>
            <Text style={styles.colNumber}>{formatARS(item.unit_price)}</Text>
            {data.isFiscal && (
              <Text style={styles.colNumber}>
                {item.iva_rate_id !== null
                  ? `${ivaRatePercent(item.iva_rate_id)}%`
                  : "—"}
              </Text>
            )}
            <Text style={styles.colNumber}>{formatARS(item.line_total)}</Text>
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={styles.totalsBox}>
        {data.isFiscal && (
          <>
            <View style={styles.totalsRow}>
              <Text>Subtotal</Text>
              <Text>${formatARS(data.imp_neto)}</Text>
            </View>
            {data.imp_tot_conc > 0 && (
              <View style={styles.totalsRow}>
                <Text>No gravado</Text>
                <Text>${formatARS(data.imp_tot_conc)}</Text>
              </View>
            )}
            {data.imp_op_ex > 0 && (
              <View style={styles.totalsRow}>
                <Text>Exento</Text>
                <Text>${formatARS(data.imp_op_ex)}</Text>
              </View>
            )}
            {data.per_rate.map((rate) => (
              <View key={rate.id} style={styles.totalsRow}>
                <Text>IVA {ivaRatePercent(rate.id)}%</Text>
                <Text>${formatARS(rate.importe)}</Text>
              </View>
            ))}
            {data.imp_trib > 0 && (
              <View style={styles.totalsRow}>
                <Text>Otros tributos</Text>
                <Text>${formatARS(data.imp_trib)}</Text>
              </View>
            )}
            {data.moneda !== "PES" && (
              <View style={styles.totalsRow}>
                <Text>Tipo de cambio</Text>
                <Text>
                  {data.moneda} @ {formatARS(data.cotizacion)}
                </Text>
              </View>
            )}
          </>
        )}
        <View style={styles.totalsRowFinal}>
          <Text>Total</Text>
          <Text>${formatARS(data.imp_total)}</Text>
        </View>
      </View>

      {/* Régimen de Transparencia Fiscal — Factura B a CF desde abril 2025 */}
      {isFacturaBToConsumidorFinal(data) && (
        <View style={styles.fiscalLeyenda}>
          <Text>{REGIMEN_TRANSPARENCIA_LEYENDA}</Text>
          <View style={[styles.totalsRow, { marginTop: 4 }]}>
            <Text>IVA Contenido</Text>
            <Text>${formatARS(data.imp_iva)}</Text>
          </View>
          {data.imp_trib > 0 && (
            <View style={styles.totalsRow}>
              <Text>Otros impuestos nacionales indirectos</Text>
              <Text>${formatARS(data.imp_trib)}</Text>
            </View>
          )}
        </View>
      )}

      {isLetterAToMonotributo(data) && (
        <View style={styles.fiscalLeyenda}>
          <Text>{MONOTRIBUTO_RECEPTOR_LEYENDA}</Text>
        </View>
      )}

      {/* Footer with CAE + QR (fiscal only) */}
      {data.isFiscal && data.cae && (
        <View style={styles.footer}>
          <View style={styles.footerInfo}>
            <Text style={styles.footerLabel}>CAE</Text>
            <Text>{data.cae}</Text>
            {data.cae_vencimiento && (
              <>
                <Text style={[styles.footerLabel, { marginTop: 6 }]}>
                  Vencimiento CAE
                </Text>
                <Text>{data.cae_vencimiento}</Text>
              </>
            )}
          </View>
          {data.qr_data_url && (
            // eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image is not an HTML <img>
            <Image src={data.qr_data_url} style={styles.qrImage} />
          )}
        </View>
      )}

      {!data.isFiscal && (
        <Text style={styles.noFiscalNote}>
          Este comprobante no constituye factura ni tiene efectos tributarios.
          Es de uso interno de JouveERP.
        </Text>
      )}
    </Page>
  );
}

// Mirrors the table in lib/afip/codes.ts. Kept inline because the PDF-side
// only needs the int code as a string for display next to the letter.
function kindAfipCode(kind: InvoiceKind, letter: InvoiceLetter): string {
  if (kind === "factura")
    return letter === "A" ? "01" : letter === "B" ? "06" : "11";
  if (kind === "nd")
    return letter === "A" ? "02" : letter === "B" ? "07" : "12";
  return letter === "A" ? "03" : letter === "B" ? "08" : "13";
}
