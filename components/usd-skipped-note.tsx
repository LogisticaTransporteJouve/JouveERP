import { AlertTriangle } from "lucide-react";

/** A figure in pesos left USD items out because no exchange rate is loaded. */
export function UsdSkippedNote() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>
        Faltan los importes en USD: no hay cotización del dólar cargada. Cargala
        en Contabilidad → Cotización USD para verlos convertidos.
      </span>
    </div>
  );
}
