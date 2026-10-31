import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// Payment Order PDF template. Visual mirror of the receipt but out-flow:
// "Pagamos a" instead of "Recibimos de", "ORDEN DE PAGO" instead of
// "RECIBO", payment_lines = which account the money comes out of, allocations =
// which purchase invoices it is applied to, no withholdings (K.4 dropped).

export interface PaymentOrderTemplatePaymentLine {
  account_name: string;
  account_type_label: string;
  amount: number;
  reference: string | null;
}

export interface PaymentOrderTemplateAllocation {
  invoice_label: string; // "Factura A 0003-00000123" / "Gasto interno 0001-00000005"
  invoice_date: string;
  amount_applied: number;
}

export interface PaymentOrderTemplateData {
  /** Set only on an internal-channel payment order (D5). */
  title?: string;
  emisor: {
    legal_name: string;
    cuit: string;
    address: string | null;
    division_label: string;
  };
  beneficiario: {
    legal_name: string;
    cuit: string;
    iva_condition_label: string;
  };
  punto_venta: number;
  numero: number;
  fecha: string;
  moneda: string;

  payment_lines: PaymentOrderTemplatePaymentLine[];
  allocations: PaymentOrderTemplateAllocation[];

  total_amount: number;
  payment_sum: number;
  allocated_sum: number;
  a_cuenta: number;

  notes: string | null;
  status: "issued" | "canceled";
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
  watermark: {
    position: "absolute",
    top: 320,
    left: 80,
    right: 80,
    transform: "rotate(-22deg)",
    fontSize: 60,
    color: "#fecaca",
    fontWeight: "bold",
    textAlign: "center",
  },
  header: {
    flexDirection: "row",
    borderBottom: "1pt solid #0a0a0a",
    paddingBottom: 8,
  },
  headerLeft: { flex: 1 },
  headerRight: { flex: 1, textAlign: "right" },
  emisorName: { fontSize: 14, fontWeight: "bold" },
  meta: { marginTop: 4, lineHeight: 1.4 },
  heading: { fontSize: 14, fontWeight: "bold" },
  subheading: { fontSize: 11, marginTop: 2 },
  metaLabel: { fontWeight: "bold", marginRight: 4 },
  receptorBox: {
    marginTop: 16,
    border: "1pt solid #d4d4d4",
    padding: 8,
  },
  sectionTitle: { fontWeight: "bold", marginBottom: 4 },
  receptorRow: { flexDirection: "row", marginTop: 2 },
  block: { marginTop: 16 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: "1pt solid #d4d4d4",
    fontWeight: "bold",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderBottom: "0.5pt solid #e5e5e5",
  },
  colFlex: { flex: 4 },
  colNumber: { flex: 1, textAlign: "right" },
  colSmall: { flex: 2 },
  totalsBox: {
    marginTop: 16,
    alignSelf: "flex-end",
    width: 260,
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
    marginTop: 4,
    borderTop: "1pt solid #0a0a0a",
    fontWeight: "bold",
  },
  notesBox: {
    marginTop: 16,
    border: "0.5pt solid #d4d4d4",
    padding: 6,
    fontSize: 8,
    color: "#525252",
    lineHeight: 1.4,
  },
  signatureBox: {
    marginTop: 40,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  signatureSlot: {
    flex: 1,
    marginHorizontal: 16,
    borderTop: "0.5pt solid #0a0a0a",
    paddingTop: 4,
    textAlign: "center",
    fontSize: 8,
    color: "#525252",
  },
});

function formatARS(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

function formatOPNumber(pos: number, numero: number): string {
  return `OP${String(pos).padStart(4, "0")}-${String(numero).padStart(8, "0")}`;
}

export function PaymentOrderDocument({
  data,
}: {
  data: PaymentOrderTemplateData;
}) {
  const canceled = data.status === "canceled";
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {canceled && <Text style={styles.watermark}>ANULADA</Text>}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.emisorName}>{data.emisor.legal_name}</Text>
            <View style={styles.meta}>
              {data.emisor.cuit && <Text>CUIT {data.emisor.cuit}</Text>}
              {data.emisor.address && <Text>{data.emisor.address}</Text>}
              {data.emisor.division_label && (
                <Text>{data.emisor.division_label}</Text>
              )}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.heading}>{data.title ?? "ORDEN DE PAGO"}</Text>
            <Text style={styles.subheading}>
              {formatOPNumber(data.punto_venta, data.numero)}
            </Text>
            <View style={[styles.meta, { textAlign: "right" }]}>
              <Text>Fecha: {data.fecha}</Text>
              <Text>Moneda: {data.moneda}</Text>
            </View>
          </View>
        </View>

        <View style={styles.receptorBox}>
          <Text style={styles.sectionTitle}>Pagamos a</Text>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>Razón social:</Text>
            <Text>{data.beneficiario.legal_name}</Text>
          </View>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>CUIT:</Text>
            <Text>{data.beneficiario.cuit}</Text>
          </View>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>Condición IVA:</Text>
            <Text>{data.beneficiario.iva_condition_label}</Text>
          </View>
        </View>

        {data.payment_lines.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Medios de pago</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colFlex}>Cuenta</Text>
              <Text style={styles.colSmall}>Tipo</Text>
              <Text style={styles.colSmall}>Referencia</Text>
              <Text style={styles.colNumber}>Importe</Text>
            </View>
            {data.payment_lines.map((l, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colFlex}>{l.account_name}</Text>
                <Text style={styles.colSmall}>{l.account_type_label}</Text>
                <Text style={styles.colSmall}>{l.reference ?? "—"}</Text>
                <Text style={styles.colNumber}>
                  {formatARS(l.amount, data.moneda)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {data.allocations.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Imputaciones</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colFlex}>Comprobante</Text>
              <Text style={styles.colSmall}>Fecha</Text>
              <Text style={styles.colNumber}>Imputado</Text>
            </View>
            {data.allocations.map((a, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colFlex}>{a.invoice_label}</Text>
                <Text style={styles.colSmall}>{a.invoice_date}</Text>
                <Text style={styles.colNumber}>
                  {formatARS(a.amount_applied, data.moneda)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalsBox}>
          <View style={styles.totalsRow}>
            <Text>Pago real</Text>
            <Text>{formatARS(data.payment_sum, data.moneda)}</Text>
          </View>
          <View style={styles.totalsRowFinal}>
            <Text>Total OP</Text>
            <Text>{formatARS(data.total_amount, data.moneda)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>Imputado</Text>
            <Text>{formatARS(data.allocated_sum, data.moneda)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>A cuenta</Text>
            <Text>{formatARS(data.a_cuenta, data.moneda)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        <View style={styles.signatureBox}>
          <View style={styles.signatureSlot}>
            <Text>Firma emisor</Text>
          </View>
          <View style={styles.signatureSlot}>
            <Text>Firma receptor</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
