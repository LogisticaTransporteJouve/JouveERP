import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  formatVoucherAmount,
  voucherStyles,
  type VoucherEmisor,
  type VoucherParty,
} from "./voucher-template";

// A fiscal liquidación de fletes as its "R" document: the Remito R (or, for
// one confirmed before it, the legacy "LIQUIDACIÓN DE FLETES R-…"). The
// issuer, an "R" letter box with "Documento no válido como factura", the
// client, the period and one row per carga. The invoice that bills it is
// printed apart.

export interface FreightSettlementTemplateItem {
  date: string; // DD/MM/YYYY or "—"
  remito: string;
  route: string;
  description: string;
  amount: number;
}

export interface FreightSettlementTemplateData {
  emisor: VoucherEmisor;
  client: VoucherParty;
  heading: "REMITO" | "LIQUIDACIÓN DE FLETES";
  number: string; // "R9002-00000001", or the legacy "R-00000012"
  fecha: string; // DD/MM/YYYY (confirmation)
  period: string; // "01/10/2026 al 31/10/2026"
  items: FreightSettlementTemplateItem[];
  total: number;
  /** A Ventas client is invoiced net + IVA; an Otras ventas one at the total. */
  plusIva: boolean;
  invoiceLabel: string | null;
  notes: string | null;
  cancelled: boolean;
}

const styles = StyleSheet.create({
  letterBox: {
    alignSelf: "center",
    alignItems: "center",
    width: 70,
    border: "1pt solid #0a0a0a",
    paddingVertical: 4,
    marginHorizontal: 12,
  },
  letter: { fontSize: 26, fontWeight: "bold" },
  letterNote: { fontSize: 6, textAlign: "center", marginTop: 2 },
  colDate: { flex: 1.2 },
  colRemito: { flex: 1.6 },
  colRoute: { flex: 3 },
  colDescription: { flex: 2.4 },
});

export function FreightSettlementDocument({
  data,
}: {
  data: FreightSettlementTemplateData;
}) {
  const v = voucherStyles;
  const money = (n: number) => formatVoucherAmount(n, "ARS");
  return (
    <Document>
      <Page size="A4" style={v.page}>
        {data.cancelled && <Text style={v.watermark}>CANCELADA</Text>}

        <View style={v.header}>
          <View style={v.headerLeft}>
            <Text style={v.emisorName}>{data.emisor.legal_name}</Text>
            <View style={v.meta}>
              {data.emisor.cuit && <Text>CUIT {data.emisor.cuit}</Text>}
              {data.emisor.address && <Text>{data.emisor.address}</Text>}
              {data.emisor.division_label && (
                <Text>{data.emisor.division_label}</Text>
              )}
            </View>
          </View>
          <View style={styles.letterBox}>
            <Text style={styles.letter}>R</Text>
            <Text style={styles.letterNote}>
              Documento no válido como factura
            </Text>
          </View>
          <View style={v.headerRight}>
            <Text style={v.heading}>{data.heading}</Text>
            <Text style={v.subheading}>{data.number}</Text>
            <View style={[v.meta, { textAlign: "right" }]}>
              {data.heading === "REMITO" && <Text>Liquidación de fletes</Text>}
              <Text>Fecha: {data.fecha}</Text>
              <Text>Período: {data.period}</Text>
            </View>
          </View>
        </View>

        <View style={v.receptorBox}>
          <Text style={v.sectionTitle}>Cliente</Text>
          <View style={v.receptorRow}>
            <Text style={v.metaLabel}>Razón social:</Text>
            <Text>{data.client.legal_name}</Text>
          </View>
          {data.client.cuit && (
            <View style={v.receptorRow}>
              <Text style={v.metaLabel}>CUIT:</Text>
              <Text>{data.client.cuit}</Text>
            </View>
          )}
          {data.client.iva_condition_label && (
            <View style={v.receptorRow}>
              <Text style={v.metaLabel}>Condición IVA:</Text>
              <Text>{data.client.iva_condition_label}</Text>
            </View>
          )}
        </View>

        <View style={v.block}>
          <Text style={v.sectionTitle}>Cargas</Text>
          <View style={v.tableHeader}>
            <Text style={styles.colDate}>Fecha</Text>
            <Text style={styles.colRemito}>Remito</Text>
            <Text style={styles.colRoute}>Ruta</Text>
            <Text style={styles.colDescription}>Descripción</Text>
            <Text style={v.colNumber}>Importe</Text>
          </View>
          {data.items.map((item, i) => (
            <View key={i} style={v.tableRow} wrap={false}>
              <Text style={styles.colDate}>{item.date}</Text>
              <Text style={styles.colRemito}>{item.remito}</Text>
              <Text style={styles.colRoute}>{item.route}</Text>
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={v.colNumber}>{money(item.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={v.totalsBox}>
          <View style={v.totalsRow}>
            <Text>Cargas</Text>
            <Text>{data.items.length}</Text>
          </View>
          <View style={v.totalsRowFinal}>
            <Text>{data.plusIva ? "Total (más IVA)" : "Total"}</Text>
            <Text>{money(data.total)}</Text>
          </View>
          {data.invoiceLabel && (
            <View style={v.totalsRow}>
              <Text>Facturada en</Text>
              <Text>{data.invoiceLabel}</Text>
            </View>
          )}
        </View>

        {data.notes && (
          <View style={v.notesBox}>
            <Text style={v.sectionTitle}>Notas</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        <View style={v.signatureBox}>
          <View style={v.signatureSlot}>
            <Text>Firma emisor</Text>
          </View>
          <View style={v.signatureSlot}>
            <Text>Conformidad del cliente</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
