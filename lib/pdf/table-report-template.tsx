import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";

export type TableReportAlign = "left" | "right" | "center";

export type TableReportColumn = {
  header: string;
  /** Column width in points. Widths should sum to the page content width
   *  (~547pt portrait A4, ~794pt landscape) so the table fills the page. */
  width: number;
  align?: TableReportAlign;
  /** Render the cells in a monospaced font (numbers, codes). */
  mono?: boolean;
};

export interface TableReportData {
  /** Document title, e.g. "Cuenta corriente". */
  title: string;
  /** Optional second line, e.g. the entity name / CUIT. */
  subtitle?: string;
  /** Optional date-range label, e.g. "01/06/2026 — 30/06/2026" or "Todo". */
  dateRangeLabel?: string;
  /** Formatted "generated at" timestamp. */
  generatedAt: string;
  columns: TableReportColumn[];
  /** Pre-formatted cells, one inner array per row, aligned with `columns`. */
  rows: string[][];
  /** Optional totals row, aligned with `columns`. */
  totalsRow?: string[];
  orientation?: "portrait" | "landscape";
  /** Shown when there are no rows. */
  emptyLabel?: string;
}

const ALIGN: Record<TableReportAlign, { textAlign: TableReportAlign }> = {
  left: { textAlign: "left" },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
};

const styles = StyleSheet.create({
  page: { padding: 24, fontSize: 8, fontFamily: "Helvetica", color: "#111" },
  header: {
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    paddingBottom: 6,
  },
  title: { fontSize: 14, fontWeight: "bold" },
  subtitle: { fontSize: 9, color: "#333", marginTop: 2 },
  meta: { fontSize: 8, color: "#777", marginTop: 2 },
  table: { flexDirection: "column", borderTopWidth: 1, borderTopColor: "#000" },
  thRow: {
    flexDirection: "row",
    backgroundColor: "#f1f1f1",
    borderBottomWidth: 1,
    borderBottomColor: "#000",
  },
  th: {
    padding: 3,
    fontWeight: "bold",
    fontSize: 7,
    borderRightWidth: 0.5,
    borderRightColor: "#999",
  },
  tr: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  td: {
    padding: 3,
    fontSize: 7.5,
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
  mono: { fontFamily: "Courier" },
  empty: { padding: 16, fontSize: 9, color: "#777", textAlign: "center" },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 24,
    right: 24,
    fontSize: 7,
    color: "#999",
    textAlign: "center",
  },
});

export function TableReportDocument({
  title,
  subtitle,
  dateRangeLabel,
  generatedAt,
  columns,
  rows,
  totalsRow,
  orientation = "portrait",
  emptyLabel = "Sin datos para el período seleccionado.",
}: TableReportData) {
  const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
  return (
    <Document>
      <Page size="A4" orientation={orientation} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          <Text style={styles.meta}>
            {dateRangeLabel ? `Período: ${dateRangeLabel} · ` : ""}
            {rows.length} fila{rows.length === 1 ? "" : "s"} · generado{" "}
            {generatedAt}
          </Text>
        </View>

        <View style={styles.table}>
          <View style={styles.thRow} fixed>
            {columns.map((col, ci) => (
              <Text
                key={`th-${ci}`}
                style={[
                  styles.th,
                  col.align ? ALIGN[col.align] : ALIGN.left,
                  { width: col.width },
                ]}
              >
                {col.header}
              </Text>
            ))}
          </View>

          {rows.length === 0 ? (
            <View style={styles.tr}>
              <Text style={[styles.empty, { width: totalWidth }]}>
                {emptyLabel}
              </Text>
            </View>
          ) : (
            rows.map((row, ri) => (
              <View key={`r-${ri}`} style={styles.tr} wrap={false}>
                {columns.map((col, ci) => (
                  <Text
                    key={`r-${ri}-c-${ci}`}
                    style={[
                      styles.td,
                      col.align ? ALIGN[col.align] : ALIGN.left,
                      col.mono ? styles.mono : {},
                      { width: col.width },
                    ]}
                  >
                    {row[ci] ?? ""}
                  </Text>
                ))}
              </View>
            ))
          )}

          {totalsRow ? (
            <View style={styles.totalRow} wrap={false}>
              {columns.map((col, ci) => (
                <Text
                  key={`t-${ci}`}
                  style={[
                    styles.td,
                    col.align ? ALIGN[col.align] : ALIGN.left,
                    col.mono ? styles.mono : {},
                    { width: col.width },
                  ]}
                >
                  {totalsRow[ci] ?? ""}
                </Text>
              ))}
            </View>
          ) : null}
        </View>

        <Text style={styles.footer} fixed>
          JouveERP · {title} · generado {generatedAt}
        </Text>
      </Page>
    </Document>
  );
}
