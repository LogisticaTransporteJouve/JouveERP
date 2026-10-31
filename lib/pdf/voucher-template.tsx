import type { ReactNode } from "react";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

// The layout a receipt and a payment order share: issuer header, the
// counterparty box, payment lines, allocations, totals and notes. Neither is
// a fiscal document — no CAE, no QR, no AFIP letter. Each template supplies
// its own words, its extra sections and its totals.

export interface VoucherPaymentLine {
  account_name: string;
  account_type_label: string;
  amount: number;
  reference: string | null;
}

export interface VoucherAllocation {
  invoice_label: string; // "Factura A 0003-00000123"
  invoice_date: string;
  amount_applied: number;
}

export interface VoucherEmisor {
  legal_name: string;
  cuit: string;
  address: string | null;
  division_label: string;
}

export interface VoucherParty {
  legal_name: string;
  cuit: string;
  iva_condition_label: string;
}

export const voucherStyles = StyleSheet.create({
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

export function formatVoucherAmount(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`;
}

export function VoucherDocument({
  title,
  number,
  canceledLabel,
  partyTitle,
  canceled,
  emisor,
  party,
  fecha,
  moneda,
  paymentLines,
  allocations,
  afterPaymentLines,
  totalsBeforeFinal,
  totalLabel,
  totalAmount,
  allocatedSum,
  aCuenta,
  notes,
  signatures = false,
}: {
  title: string;
  number: string;
  /** Watermark of a canceled voucher ("ANULADO" / "ANULADA"). */
  canceledLabel: string;
  /** Heading of the counterparty box ("Recibimos de" / "Pagamos a"). */
  partyTitle: string;
  canceled: boolean;
  emisor: VoucherEmisor;
  party: VoucherParty;
  fecha: string;
  moneda: string;
  paymentLines: VoucherPaymentLine[];
  allocations: VoucherAllocation[];
  /** Sections between the payment lines and the allocations. */
  afterPaymentLines?: ReactNode;
  /** Totals rows above the final total, in order. */
  totalsBeforeFinal: { label: string; amount: number }[];
  totalLabel: string;
  totalAmount: number;
  allocatedSum: number;
  aCuenta: number;
  notes: string | null;
  signatures?: boolean;
}) {
  const styles = voucherStyles;
  const money = (value: number) => formatVoucherAmount(value, moneda);
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {canceled && <Text style={styles.watermark}>{canceledLabel}</Text>}

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.emisorName}>{emisor.legal_name}</Text>
            <View style={styles.meta}>
              {emisor.cuit && <Text>CUIT {emisor.cuit}</Text>}
              {emisor.address && <Text>{emisor.address}</Text>}
              {emisor.division_label && <Text>{emisor.division_label}</Text>}
            </View>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.heading}>{title}</Text>
            <Text style={styles.subheading}>{number}</Text>
            <View style={[styles.meta, { textAlign: "right" }]}>
              <Text>Fecha: {fecha}</Text>
              <Text>Moneda: {moneda}</Text>
            </View>
          </View>
        </View>

        <View style={styles.receptorBox}>
          <Text style={styles.sectionTitle}>{partyTitle}</Text>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>Razón social:</Text>
            <Text>{party.legal_name}</Text>
          </View>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>CUIT:</Text>
            <Text>{party.cuit}</Text>
          </View>
          <View style={styles.receptorRow}>
            <Text style={styles.metaLabel}>Condición IVA:</Text>
            <Text>{party.iva_condition_label}</Text>
          </View>
        </View>

        {paymentLines.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Medios de pago</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colFlex}>Cuenta</Text>
              <Text style={styles.colSmall}>Tipo</Text>
              <Text style={styles.colSmall}>Referencia</Text>
              <Text style={styles.colNumber}>Importe</Text>
            </View>
            {paymentLines.map((l, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colFlex}>{l.account_name}</Text>
                <Text style={styles.colSmall}>{l.account_type_label}</Text>
                <Text style={styles.colSmall}>{l.reference ?? "—"}</Text>
                <Text style={styles.colNumber}>{money(l.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {afterPaymentLines}

        {allocations.length > 0 && (
          <View style={styles.block}>
            <Text style={styles.sectionTitle}>Imputaciones</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colFlex}>Comprobante</Text>
              <Text style={styles.colSmall}>Fecha</Text>
              <Text style={styles.colNumber}>Imputado</Text>
            </View>
            {allocations.map((a, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.colFlex}>{a.invoice_label}</Text>
                <Text style={styles.colSmall}>{a.invoice_date}</Text>
                <Text style={styles.colNumber}>{money(a.amount_applied)}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.totalsBox}>
          {totalsBeforeFinal.map((row) => (
            <View key={row.label} style={styles.totalsRow}>
              <Text>{row.label}</Text>
              <Text>{money(row.amount)}</Text>
            </View>
          ))}
          <View style={styles.totalsRowFinal}>
            <Text>{totalLabel}</Text>
            <Text>{money(totalAmount)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>Imputado</Text>
            <Text>{money(allocatedSum)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text>A cuenta</Text>
            <Text>{money(aCuenta)}</Text>
          </View>
        </View>

        {notes && (
          <View style={styles.notesBox}>
            <Text style={styles.sectionTitle}>Notas</Text>
            <Text>{notes}</Text>
          </View>
        )}

        {signatures && (
          <View style={styles.signatureBox}>
            <View style={styles.signatureSlot}>
              <Text>Firma emisor</Text>
            </View>
            <View style={styles.signatureSlot}>
              <Text>Firma receptor</Text>
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}
