import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import {
  computeTotals,
  groupByInvoice,
  IVA_RATES,
  KIND_LABEL,
  libroIvaVoucherNumber,
  type LibroIvaVentasRow,
} from "@/features/libro-iva/schema";

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number) => fmt.format(n);

const styles = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 7,
    fontFamily: "Helvetica",
    color: "#111",
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingBottom: 6,
  },
  title: {
    fontSize: 13,
    fontWeight: "bold",
  },
  subtitle: {
    fontSize: 9,
    color: "#555",
    marginTop: 2,
  },
  table: {
    flexDirection: "column",
    borderTopWidth: 1,
    borderTopColor: "#000",
  },
  thRow: {
    flexDirection: "row",
    backgroundColor: "#f1f1f1",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
  th: {
    padding: 3,
    fontWeight: "bold",
    fontSize: 6,
    borderRightWidth: 0.5,
    borderRightColor: "#999",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  td: {
    padding: 2,
    fontSize: 6,
    borderRightWidth: 0.5,
    borderRightColor: "#eee",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#000",
    backgroundColor: "#f1f1f1",
    fontWeight: "bold",
  },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  mono: { fontFamily: "Courier" },
  footer: {
    marginTop: 12,
    fontSize: 6,
    color: "#999",
    textAlign: "center",
  },
});

// Anchos de columnas (proporcionales)
const COL_W = {
  fecha: 36,
  tipo: 28,
  numero: 48,
  cliente: 90,
  cuit: 50,
  rate: 28, // por cada Neto/IVA
  perc: 32,
  noGrav: 32,
  total: 40,
  cae: 48,
};

export interface LibroIvaVentasTemplateData {
  period: string;
  channelName: string;
  generatedAt: string;
  rows: LibroIvaVentasRow[];
}

export function LibroIvaVentasDocument({
  period,
  channelName,
  generatedAt,
  rows,
}: LibroIvaVentasTemplateData) {
  const grouped = groupByInvoice(rows);
  const totals = computeTotals(grouped);

  return (
    <Document>
      <Page size="A4" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Libro IVA Ventas — {period}</Text>
          <Text style={styles.subtitle}>
            {channelName} · {grouped.length} comprobantes · importes en pesos
            (moneda extranjera a la cotización de cada comprobante) · generado{" "}
            {generatedAt}
          </Text>
        </View>

        <View style={styles.table}>
          {/* Header */}
          <View style={styles.thRow}>
            <Text style={[styles.th, { width: COL_W.fecha }]}>Fecha</Text>
            <Text style={[styles.th, { width: COL_W.tipo }]}>Tipo</Text>
            <Text style={[styles.th, { width: COL_W.numero }]}>
              Comprobante
            </Text>
            <Text style={[styles.th, { width: COL_W.cliente }]}>Cliente</Text>
            <Text style={[styles.th, { width: COL_W.cuit }]}>CUIT</Text>
            {IVA_RATES.map((r) => (
              <Text
                key={r.id}
                style={[styles.th, styles.center, { width: COL_W.rate * 2 }]}
              >
                {r.label}
              </Text>
            ))}
            <Text style={[styles.th, styles.right, { width: COL_W.perc }]}>
              Perc.
            </Text>
            <Text style={[styles.th, styles.right, { width: COL_W.noGrav }]}>
              No grav.
            </Text>
            <Text style={[styles.th, styles.right, { width: COL_W.total }]}>
              Total
            </Text>
            <Text style={[styles.th, { width: COL_W.cae }]}>CAE</Text>
          </View>
          {/* Subheader Neto / IVA */}
          <View style={styles.thRow}>
            <Text
              style={[
                styles.th,
                {
                  width:
                    COL_W.fecha +
                    COL_W.tipo +
                    COL_W.numero +
                    COL_W.cliente +
                    COL_W.cuit,
                },
              ]}
            />
            {IVA_RATES.map((r) => (
              <>
                <Text
                  key={`${r.id}-n-h`}
                  style={[styles.th, styles.right, { width: COL_W.rate }]}
                >
                  Neto
                </Text>
                <Text
                  key={`${r.id}-i-h`}
                  style={[styles.th, styles.right, { width: COL_W.rate }]}
                >
                  IVA
                </Text>
              </>
            ))}
            <Text
              style={[
                styles.th,
                { width: COL_W.perc + COL_W.noGrav + COL_W.total + COL_W.cae },
              ]}
            />
          </View>

          {grouped.map((row) => {
            const number = libroIvaVoucherNumber(row);
            return (
              <View key={row.invoice_id} style={styles.tr} wrap={false}>
                <Text style={[styles.td, styles.mono, { width: COL_W.fecha }]}>
                  {row.fecha}
                </Text>
                <Text style={[styles.td, { width: COL_W.tipo }]}>
                  {KIND_LABEL[row.kind] ?? row.kind}
                </Text>
                <Text style={[styles.td, styles.mono, { width: COL_W.numero }]}>
                  {number}
                </Text>
                <Text style={[styles.td, { width: COL_W.cliente }]}>
                  {row.client_legal_name}
                </Text>
                <Text style={[styles.td, styles.mono, { width: COL_W.cuit }]}>
                  {row.doc_nro}
                </Text>
                {IVA_RATES.map((r) => {
                  const cell = row.per_rate[r.id];
                  return (
                    <>
                      <Text
                        key={`${row.invoice_id}-${r.id}-n`}
                        style={[
                          styles.td,
                          styles.right,
                          styles.mono,
                          { width: COL_W.rate },
                        ]}
                      >
                        {cell?.neto ? money(cell.neto) : ""}
                      </Text>
                      <Text
                        key={`${row.invoice_id}-${r.id}-i`}
                        style={[
                          styles.td,
                          styles.right,
                          styles.mono,
                          { width: COL_W.rate },
                        ]}
                      >
                        {cell?.iva ? money(cell.iva) : ""}
                      </Text>
                    </>
                  );
                })}
                <Text
                  style={[
                    styles.td,
                    styles.right,
                    styles.mono,
                    { width: COL_W.perc },
                  ]}
                >
                  {row.imp_trib > 0 ? money(row.imp_trib) : ""}
                </Text>
                <Text
                  style={[
                    styles.td,
                    styles.right,
                    styles.mono,
                    { width: COL_W.noGrav },
                  ]}
                >
                  {row.imp_op_ex > 0 ? money(row.imp_op_ex) : ""}
                </Text>
                <Text
                  style={[
                    styles.td,
                    styles.right,
                    styles.mono,
                    { width: COL_W.total },
                  ]}
                >
                  {money(row.imp_total)}
                </Text>
                <Text style={[styles.td, styles.mono, { width: COL_W.cae }]}>
                  {row.cae ?? "—"}
                </Text>
              </View>
            );
          })}

          <View style={styles.totalRow} wrap={false}>
            <Text
              style={[
                styles.td,
                styles.right,
                {
                  width:
                    COL_W.fecha +
                    COL_W.tipo +
                    COL_W.numero +
                    COL_W.cliente +
                    COL_W.cuit,
                },
              ]}
            >
              Totales ({totals.count} comprobantes)
            </Text>
            {IVA_RATES.map((r) => {
              const cell = totals.per_rate[r.id];
              return (
                <>
                  <Text
                    key={`t-${r.id}-n`}
                    style={[
                      styles.td,
                      styles.right,
                      styles.mono,
                      { width: COL_W.rate },
                    ]}
                  >
                    {cell?.neto ? money(cell.neto) : ""}
                  </Text>
                  <Text
                    key={`t-${r.id}-i`}
                    style={[
                      styles.td,
                      styles.right,
                      styles.mono,
                      { width: COL_W.rate },
                    ]}
                  >
                    {cell?.iva ? money(cell.iva) : ""}
                  </Text>
                </>
              );
            })}
            <Text
              style={[
                styles.td,
                styles.right,
                styles.mono,
                { width: COL_W.perc },
              ]}
            >
              {totals.imp_trib > 0 ? money(totals.imp_trib) : ""}
            </Text>
            <Text
              style={[
                styles.td,
                styles.right,
                styles.mono,
                { width: COL_W.noGrav },
              ]}
            >
              {totals.imp_op_ex > 0 ? money(totals.imp_op_ex) : ""}
            </Text>
            <Text
              style={[
                styles.td,
                styles.right,
                styles.mono,
                { width: COL_W.total },
              ]}
            >
              {money(totals.imp_total)}
            </Text>
            <Text style={[styles.td, { width: COL_W.cae }]} />
          </View>
        </View>

        <Text style={styles.footer}>
          JouveERP · RG 1361 · Página generada el {generatedAt}
        </Text>
      </Page>
    </Document>
  );
}
