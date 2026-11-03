import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  formatVoucherAmount,
  voucherStyles,
  type VoucherEmisor,
} from "./voucher-template";

// The rendición as an internal treasury document: what the driver had to
// collect per carga, what they handed in (each payment line) and the
// difference, with the receipts it posted and both signatures. Not a
// comprobante: no fiscal data of the issuer (D5).

export interface DriverSettlementTemplateLine {
  account: string;
  amount: number;
  detail: string | null; // "Cheque 123 · Banco X" or a reference
}

export interface DriverSettlementTemplateItem {
  date: string; // DD/MM/YYYY or "—"
  client: string;
  remito: string;
  expected: number;
  received: number;
  difference: number;
  lines: DriverSettlementTemplateLine[];
  note: string | null;
}

export interface DriverSettlementTemplateData {
  emisor: VoucherEmisor;
  number: string; // "N° 12"
  fecha: string; // DD/MM/YYYY
  driver: string;
  items: DriverSettlementTemplateItem[];
  expected: number;
  received: number;
  difference: number;
  receipts: string[];
  differenceNote: string | null;
  notes: string | null;
  cancelled: boolean;
}

const styles = StyleSheet.create({
  colDate: { flex: 1.1 },
  colClient: { flex: 3 },
  colRemito: { flex: 1.5 },
  lineRow: {
    flexDirection: "row",
    paddingLeft: 12,
    paddingVertical: 1,
    fontSize: 7,
    color: "#525252",
  },
  lineAccount: { flex: 4 },
});

function signed(n: number): string {
  if (n === 0) return "—";
  const abs = formatVoucherAmount(Math.abs(n), "ARS");
  return n > 0 ? `+${abs}` : `−${abs}`;
}

export function DriverSettlementDocument({
  data,
}: {
  data: DriverSettlementTemplateData;
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
            {data.emisor.division_label && (
              <View style={v.meta}>
                <Text>{data.emisor.division_label}</Text>
              </View>
            )}
          </View>
          <View style={v.headerRight}>
            <Text style={v.heading}>RENDICIÓN DE COBRANZA</Text>
            <Text style={v.subheading}>{data.number}</Text>
            <View style={[v.meta, { textAlign: "right" }]}>
              <Text>Fecha: {data.fecha}</Text>
              <Text>Documento interno</Text>
            </View>
          </View>
        </View>

        <View style={v.receptorBox}>
          <Text style={v.sectionTitle}>Chofer</Text>
          <View style={v.receptorRow}>
            <Text style={v.metaLabel}>Nombre:</Text>
            <Text>{data.driver}</Text>
          </View>
        </View>

        <View style={v.block}>
          <Text style={v.sectionTitle}>Cargas contra entrega</Text>
          <View style={v.tableHeader}>
            <Text style={styles.colDate}>Entrega</Text>
            <Text style={styles.colClient}>Cliente</Text>
            <Text style={styles.colRemito}>Remito</Text>
            <Text style={v.colNumber}>A cobrar</Text>
            <Text style={v.colNumber}>Entregado</Text>
            <Text style={v.colNumber}>Diferencia</Text>
          </View>
          {data.items.map((item, i) => (
            <View key={i} wrap={false}>
              <View style={v.tableRow}>
                <Text style={styles.colDate}>{item.date}</Text>
                <Text style={styles.colClient}>{item.client}</Text>
                <Text style={styles.colRemito}>{item.remito}</Text>
                <Text style={v.colNumber}>{money(item.expected)}</Text>
                <Text style={v.colNumber}>{money(item.received)}</Text>
                <Text style={v.colNumber}>{signed(item.difference)}</Text>
              </View>
              {item.lines.map((line, j) => (
                <View key={j} style={styles.lineRow}>
                  <Text style={styles.lineAccount}>
                    {line.account}
                    {line.detail ? ` · ${line.detail}` : ""}
                  </Text>
                  <Text style={v.colNumber}>{money(line.amount)}</Text>
                </View>
              ))}
              {item.lines.length === 0 && (
                <View style={styles.lineRow}>
                  <Text style={styles.lineAccount}>No entregó nada.</Text>
                </View>
              )}
              {item.note && (
                <View style={styles.lineRow}>
                  <Text style={styles.lineAccount}>{item.note}</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={v.totalsBox}>
          <View style={v.totalsRow}>
            <Text>A cobrar</Text>
            <Text>{money(data.expected)}</Text>
          </View>
          <View style={v.totalsRow}>
            <Text>Entregado</Text>
            <Text>{money(data.received)}</Text>
          </View>
          <View style={v.totalsRowFinal}>
            <Text>Diferencia</Text>
            <Text>{signed(data.difference)}</Text>
          </View>
          {data.receipts.length > 0 && (
            <View style={v.totalsRow}>
              <Text>Recibos</Text>
              <Text>{data.receipts.join(", ")}</Text>
            </View>
          )}
        </View>

        {data.differenceNote && (
          <View style={v.notesBox}>
            <Text>{data.differenceNote}</Text>
          </View>
        )}

        {data.notes && (
          <View style={v.notesBox}>
            <Text style={v.sectionTitle}>Notas</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        <View style={v.signatureBox}>
          <View style={v.signatureSlot}>
            <Text>Entregó (chofer)</Text>
          </View>
          <View style={v.signatureSlot}>
            <Text>Recibió</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
