import "server-only";

import { z } from "zod";

import type { ParsedTable } from "@/lib/tables/csv";

import { parseReceivedTable, type ParsedReceivedExport } from "./parse";

// What Mis Comprobantes answers to ajax.do?f=listaResultados: one array of 52
// cells per voucher, in the order the page's DataTable declares (rowFecha = 0
// … rowTotalStyled = 51). The "Styled" cells are display copies and come
// null. Each column below is read under the header the page's own Excel
// export writes, so the vouchers go through the same reader as an upload.
const COLUMNS: readonly (readonly [index: number, header: string])[] = [
  [0, "Fecha"],
  [1, "Tipo"],
  [3, "Punto de Venta"],
  [4, "Número Desde"],
  [5, "Número Hasta"],
  [8, "Cód. Autorización"],
  [11, "Nro. Doc. Emisor"],
  [12, "Denominación Emisor"],
  [16, "Tipo Cambio"],
  [17, "Moneda"],
  [18, "Neto Grav. IVA 0%"],
  [20, "IVA 2,5%"],
  [22, "Neto Grav. IVA 2,5%"],
  [24, "IVA 5%"],
  [26, "Neto Grav. IVA 5%"],
  [28, "IVA 10,5%"],
  [30, "Neto Grav. IVA 10,5%"],
  [32, "IVA 21%"],
  [34, "Neto Grav. IVA 21%"],
  [36, "IVA 27%"],
  [38, "Neto Grav. IVA 27%"],
  [40, "Neto Gravado Total"],
  [42, "Neto No Gravado"],
  [44, "Op. Exentas"],
  [46, "Otros Tributos"],
  [48, "Total IVA"],
  [50, "Imp. Total"],
];

const ROW_CELLS = 52;
const MAX_ROWS = 5000;

const ResultsSchema = z.object({
  estado: z.literal("ok"),
  datos: z.object({
    data: z.array(
      z.array(z.union([z.string(), z.number(), z.null()])).length(ROW_CELLS),
    ),
  }),
});

const UNKNOWN_SHAPE =
  "ARCA respondió la consulta en un formato que no se reconoce.";

/** listaResultados as vouchers, or the message for the user. */
export function parseReceivedResults(
  json: unknown,
): ParsedReceivedExport | string {
  const parsed = ResultsSchema.safeParse(json);
  if (!parsed.success) return UNKNOWN_SHAPE;
  const data = parsed.data.datos.data;
  const table: ParsedTable = {
    truncated: data.length > MAX_ROWS,
    rows: [
      COLUMNS.map(([, header]) => header),
      ...data
        .slice(0, MAX_ROWS)
        .map((row) =>
          COLUMNS.map(([index]) =>
            row[index] === null ? "" : String(row[index]),
          ),
        ),
    ],
  };
  return parseReceivedTable(table);
}
