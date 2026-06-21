"use client";

const FIELD_LABELS: Record<string, string> = {
  contraparte_nombre: "Nombre",
  contraparte_cuit: "CUIT",
  punto_venta: "Punto de venta",
  numero: "Número",
  letra: "Letra",
  fecha: "Fecha",
  condicion_pago: "Condición de pago",
  fch_vto_pago: "Vencimiento",
  moneda: "Moneda",
  importe_neto: "Neto",
  importe_iva: "IVA",
  importe_trib: "Otros trib.",
  importe_total: "Total",
};

const ITEM_LABELS: Record<string, string> = {
  descripcion: "Descripción",
  cantidad: "Cant.",
  precio_unitario: "P. unit.",
  alicuota_iva: "Alíc.",
  importe_neto: "Neto",
  importe_total: "Total",
};

const MONEY_KEY = /neto|iva|total|trib|precio/i;
const ITEM_COLS = [
  "descripcion",
  "cantidad",
  "precio_unitario",
  "alicuota_iva",
  "importe_total",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fmt(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    return MONEY_KEY.test(key)
      ? `$${Math.round(value).toLocaleString("es-AR")}`
      : value.toLocaleString("es-AR");
  }
  return String(value);
}

export function ExtractionPayload({ payload }: { payload: unknown }) {
  if (!isRecord(payload)) {
    return (
      <p className="text-muted-foreground text-sm">Sin datos extraídos.</p>
    );
  }

  const scalarKeys = Object.keys(FIELD_LABELS).filter(
    (k) => k in payload && !isRecord(payload[k]) && !Array.isArray(payload[k]),
  );
  const items = Array.isArray(payload.items)
    ? payload.items.filter(isRecord)
    : [];

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        {scalarKeys.map((k) => (
          <div key={k} className="flex flex-col">
            <dt className="text-muted-foreground text-xs">{FIELD_LABELS[k]}</dt>
            <dd className="tabular-nums">{fmt(k, payload[k])}</dd>
          </div>
        ))}
      </dl>

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-md border text-xs">
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground border-b">
                {ITEM_COLS.map((c) => (
                  <th key={c} className="px-2 py-1 text-left font-medium">
                    {ITEM_LABELS[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i} className="border-b last:border-0">
                  {ITEM_COLS.map((c) => {
                    const numeric = typeof item[c] === "number";
                    return (
                      <td
                        key={c}
                        className={
                          numeric ? "px-2 py-1 text-right tabular-nums" : "px-2 py-1"
                        }
                      >
                        {fmt(c, item[c])}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
