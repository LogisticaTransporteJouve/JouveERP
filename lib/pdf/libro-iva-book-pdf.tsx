import { Document, Page, Text, View } from "@react-pdf/renderer";

import {
  type BookModel,
  companyCuitLabel,
  type LibroIvaHeader,
  libroIvaTitle,
  tcCode,
  totalsAmount,
  voucherAmount,
  voucherLines,
} from "@/features/libro-iva/lib/book-layout";

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number) => fmt.format(n);

// A4 landscape, in points.
export const PAGE_WIDTH = 841.89;
export const PAGE_HEIGHT = 595.28;
const PAD_X = 24;
const PAD_TOP = 24;
/** Room under the table for the page number. */
const PAD_BOTTOM = 36;
export const CONTENT_WIDTH = PAGE_WIDTH - 2 * PAD_X;
const CONTENT_HEIGHT = PAGE_HEIGHT - PAD_TOP - PAD_BOTTOM;

/** Title, company + CUIT and the subtitle line. */
const HEADER_HEIGHT = 46;
/** Slack against rounding in the layout engine. */
const SAFETY = 6;

const MAX_FONT = 6.5;
const LINE_HEIGHT = 1.25;
/** Widest Helvetica glyph a cell holds (digits, dots, commas, codes), in em. */
const CHAR_EM = 0.6;
const HEADER_CHAR_EM = 0.66;
const CELL_PAD_EM = 1.5;
/** The Razón social column never gets narrower than this (it truncates). */
const MIN_NAME_EM = 16;
const NOTE_FONT = 6.5;
/** Vertical room around a cell's lines (padding plus slack, so the layout
 *  engine never drops a line that rounds past the box). */
const ROW_PAD = 4;

export type PdfColumn = {
  header: string;
  group: string | null;
  width: number;
  align: "left" | "right";
  /** One line, cut with an ellipsis (the name). */
  ellipsis?: boolean;
};

/** Each cell is one or more lines (the perceptions print one per type). */
export type PdfRow = { key: string; cells: string[][]; height: number };

export type PdfPage = {
  rows: PdfRow[];
  /** "Subtotales" (running, through this page) or the period "Totales". */
  footer: PdfRow;
};

export type LibroIvaPdfPlan = {
  fontSize: number;
  columns: PdfColumn[];
  groupRowHeight: number;
  headerRowHeight: number;
  pages: PdfPage[];
  notes: string[];
};

function longestWord(text: string): number {
  return Math.max(...text.split(/\s+/).map((w) => w.length));
}

function linesOf(cells: string[][]): number {
  return Math.max(1, ...cells.map((c) => c.length));
}

/**
 * Lays a libro out on A4 landscape pages: column widths from their content
 * (the font shrinks when the period needs many alícuotas, so the table always
 * fits the page width), rows paginated by height, and at the bottom of each
 * page the running subtotal; the last page carries the period totals and the
 * notes.
 */
export function planLibroIvaPdf<F>(
  model: BookModel<F>,
  notes: readonly string[],
): LibroIvaPdfPlan {
  const { columns, docs } = model;
  const rowCells = (d: (typeof docs)[number]): string[][] => [
    [d.fecha.split("-").reverse().join("/")],
    [tcCode(d.kind)],
    [d.number],
    [d.party],
    [d.cuit],
    [d.ci ?? ""],
    ...columns.map((c) => {
      if (c.lines) {
        return voucherLines(c, d.figures, d.kind).map(
          (p) => `${money(p.amount)} ${p.code}`,
        );
      }
      const v = voucherAmount(c, d.figures, d.kind);
      return [v === null ? "" : money(v)];
    }),
    [d.cae ?? ""],
  ];
  const footerCells = (totals: F): string[][] =>
    columns.map((c) => {
      if (c.lines) {
        return (c.lines(totals) ?? []).map(
          (p) => `${money(p.amount)} ${p.code}`,
        );
      }
      const v = totalsAmount(c, totals);
      return [v === null ? "" : money(v)];
    });

  const cells = docs.map(rowCells);

  // Widest content per column. A subtotal never exceeds the sum of the
  // absolute values above it, so that sum bounds every footer cell.
  const absSum = columns.map((c) =>
    docs.reduce(
      (a, d) => a + Math.abs(voucherAmount(c, d.figures, d.kind) ?? 0),
      0,
    ),
  );
  const leadHeaders = [
    "Fecha",
    "TC",
    "Comprobante",
    model.partyHeader,
    "C.U.I.T.",
    "C.I.",
  ];
  const allHeaders = [
    ...leadHeaders,
    ...columns.map((c) => c.header),
    model.caeHeader,
  ];
  const ems = allHeaders.map((header, i) => {
    let chars = 0;
    for (const row of cells) {
      for (const line of row[i] ?? []) chars = Math.max(chars, line.length);
    }
    const amountIndex = i - leadHeaders.length;
    const col = columns[amountIndex];
    if (col) {
      const bound = money(-absSum[amountIndex]!).length + (col.lines ? 2 : 0);
      chars = Math.max(chars, bound);
    }
    return (
      Math.max(chars * CHAR_EM, longestWord(header) * HEADER_CHAR_EM) +
      CELL_PAD_EM
    );
  });
  const NAME = 3;
  const fixedEm = ems.reduce((a, e, i) => (i === NAME ? a : a + e), 0);
  const fontSize = Math.min(MAX_FONT, CONTENT_WIDTH / (fixedEm + MIN_NAME_EM));
  const widths = ems.map((e) => e * fontSize);
  widths[NAME] = CONTENT_WIDTH - fixedEm * fontSize;

  const lineHeight = fontSize * LINE_HEIGHT;
  const heightOf = (c: string[][]) => linesOf(c) * lineHeight + ROW_PAD;
  const groupRowHeight = lineHeight + ROW_PAD;
  const headerRowHeight = 2 * lineHeight + ROW_PAD;

  const pdfColumns: PdfColumn[] = allHeaders.map((header, i) => {
    const amountIndex = i - leadHeaders.length;
    const col = columns[amountIndex];
    return {
      header,
      group: col?.group ?? null,
      width: widths[i]!,
      align: col ? "right" : "left",
      ellipsis: i === NAME,
    };
  });

  // The perception codes a footer can list bound its height on every page.
  const footerLines = Math.max(
    1,
    ...columns.map((c) =>
      c.lines
        ? new Set(
            docs.flatMap((d) =>
              voucherLines(c, d.figures, d.kind).map((p) => p.code),
            ),
          ).size
        : 1,
    ),
  );
  const footerHeight = footerLines * lineHeight + ROW_PAD;
  const notesHeight =
    notes.reduce(
      (a, n) =>
        a +
        Math.ceil((n.length * 0.55 * NOTE_FONT) / CONTENT_WIDTH) *
          NOTE_FONT *
          1.3,
      0,
    ) + 6;
  const capacity =
    CONTENT_HEIGHT -
    HEADER_HEIGHT -
    groupRowHeight -
    headerRowHeight -
    footerHeight -
    SAFETY;

  const footer = (n: number, last: boolean): PdfRow => {
    const totals = last ? model.totals : model.totalsOfFirst(n);
    const fc = footerCells(totals);
    return {
      key: last ? "totales" : `subtotal-${n}`,
      cells: [
        [last ? `Totales (${model.totals.count} comprobantes)` : "Subtotales"],
        ...fc,
        [""],
      ],
      height: footerHeight,
    };
  };

  const pages: PdfPage[] = [];
  let current: PdfRow[] = [];
  let used = 0;
  let count = 0;
  cells.forEach((c, i) => {
    const height = heightOf(c);
    if (used + height > capacity && current.length > 0) {
      pages.push({ rows: current, footer: footer(count, false) });
      current = [];
      used = 0;
    }
    current.push({ key: docs[i]!.id, cells: c, height });
    used += height;
    count += 1;
  });
  if (used + notesHeight > capacity && current.length > 0) {
    pages.push({ rows: current, footer: footer(count, false) });
    current = [];
  }
  pages.push({ rows: current, footer: footer(count, true) });

  return {
    fontSize,
    columns: pdfColumns,
    groupRowHeight,
    headerRowHeight,
    pages,
    notes: [...notes],
  };
}

const border = "#999";

function Cells({
  plan,
  cells,
  bold,
}: {
  plan: LibroIvaPdfPlan;
  cells: string[][];
  bold?: boolean;
}) {
  return plan.columns.map((col, i) => (
    <View
      key={i}
      style={{
        width: col.width,
        paddingHorizontal: plan.fontSize * 0.4,
        paddingVertical: 1,
      }}
    >
      {(cells[i] ?? [""]).map((line, j) => (
        <Text
          key={j}
          style={{
            fontSize: plan.fontSize,
            lineHeight: LINE_HEIGHT,
            textAlign: col.align,
            fontFamily: bold ? "Helvetica-Bold" : "Helvetica",
            ...(col.ellipsis ? { maxLines: 1, textOverflow: "ellipsis" } : {}),
          }}
        >
          {line}
        </Text>
      ))}
    </View>
  ));
}

/** The footer row spans the six lead columns with its label. */
function FooterRow({ plan, row }: { plan: LibroIvaPdfPlan; row: PdfRow }) {
  const leadWidth = plan.columns.slice(0, 6).reduce((a, c) => a + c.width, 0);
  const rest: LibroIvaPdfPlan = { ...plan, columns: plan.columns.slice(6) };
  return (
    <View
      wrap={false}
      style={{
        flexDirection: "row",
        height: row.height,
        borderTopWidth: 1,
        borderTopColor: "#000",
        backgroundColor: "#f1f1f1",
      }}
    >
      <View
        style={{
          width: leadWidth,
          paddingHorizontal: plan.fontSize * 0.4,
          paddingVertical: 1,
        }}
      >
        <Text
          style={{
            fontSize: plan.fontSize,
            lineHeight: LINE_HEIGHT,
            textAlign: "right",
            fontFamily: "Helvetica-Bold",
          }}
        >
          {row.cells[0]?.[0] ?? ""}
        </Text>
      </View>
      <Cells plan={rest} cells={row.cells.slice(1)} bold />
    </View>
  );
}

export function LibroIvaPdfDocument<F>({
  model,
  plan,
  period,
  header,
  subtitle,
  generatedAt,
}: {
  model: BookModel<F>;
  plan: LibroIvaPdfPlan;
  period: string;
  header: LibroIvaHeader;
  subtitle: string;
  generatedAt: string;
}) {
  const title = libroIvaTitle(model.book, period, header.closed);
  // Group labels span their Neto/IVA pair; blank over every other column.
  const groups = plan.columns.reduce<{ label: string; width: number }[]>(
    (acc, c, i) => {
      const last = acc.at(-1);
      if (last && c.group !== null && plan.columns[i - 1]?.group === c.group) {
        last.width += c.width;
      } else {
        acc.push({ label: c.group ?? "", width: c.width });
      }
      return acc;
    },
    [],
  );
  return (
    <Document title={title}>
      {plan.pages.map((page, p) => (
        <Page
          key={p}
          size="A4"
          orientation="landscape"
          style={{
            paddingTop: PAD_TOP,
            paddingHorizontal: PAD_X,
            paddingBottom: PAD_BOTTOM,
            fontFamily: "Helvetica",
            color: "#111",
          }}
        >
          <View style={{ height: HEADER_HEIGHT }}>
            <Text
              style={{
                fontSize: 10,
                fontFamily: "Helvetica-Bold",
                textAlign: "center",
              }}
            >
              {title}
            </Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 4,
              }}
            >
              <Text style={{ fontSize: 8 }}>{header.companyName}</Text>
              <Text style={{ fontSize: 8 }}>
                {companyCuitLabel(header.cuit)}
              </Text>
            </View>
            <Text style={{ fontSize: 6.5, color: "#555", marginTop: 3 }}>
              {subtitle}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              height: plan.groupRowHeight,
              borderTopWidth: 1,
              borderTopColor: "#000",
              backgroundColor: "#f1f1f1",
            }}
          >
            {groups.map((g, i) => (
              <View
                key={i}
                style={{
                  width: g.width,
                  paddingHorizontal: plan.fontSize * 0.4,
                }}
              >
                <Text
                  style={{
                    fontSize: plan.fontSize,
                    lineHeight: LINE_HEIGHT,
                    fontFamily: "Helvetica-Bold",
                    textAlign: "center",
                    maxLines: 1,
                  }}
                >
                  {g.label}
                </Text>
              </View>
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              height: plan.headerRowHeight,
              backgroundColor: "#f1f1f1",
              borderBottomWidth: 1,
              borderBottomColor: "#000",
            }}
          >
            <Cells
              plan={plan}
              cells={plan.columns.map((c) => [c.header])}
              bold
            />
          </View>

          {page.rows.map((row) => (
            <View
              key={row.key}
              wrap={false}
              style={{
                flexDirection: "row",
                height: row.height,
                borderBottomWidth: 0.5,
                borderBottomColor: "#ddd",
              }}
            >
              <Cells plan={plan} cells={row.cells} />
            </View>
          ))}

          <FooterRow plan={plan} row={page.footer} />

          {p === plan.pages.length - 1 && (
            <View style={{ marginTop: 6 }}>
              {plan.notes.map((n, i) => (
                <Text
                  key={i}
                  style={{
                    fontSize: NOTE_FONT,
                    color: "#555",
                    lineHeight: 1.3,
                  }}
                >
                  {n}
                </Text>
              ))}
            </View>
          )}

          <Text
            fixed
            style={{
              position: "absolute",
              bottom: 14,
              left: PAD_X,
              right: PAD_X,
              fontSize: 6,
              color: border,
              textAlign: "center",
            }}
          >
            JouveERP · RG 1361 · Página {p + 1} de {plan.pages.length} ·
            generado el {generatedAt}
          </Text>
        </Page>
      ))}
    </Document>
  );
}
