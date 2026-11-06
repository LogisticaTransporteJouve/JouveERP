import { formatMoney } from "@/lib/format";

import { arcaGapTargetLabel } from "../lib/arca-received-draft";
import { ARCA_GAP_TARGETS, type ArcaGapTarget } from "../schema";

/** Where the part of ARCA's total its parts do not cover goes. Required:
 *  nothing fiscal is put there until the person says so. */
export function ArcaGapChoice({
  gap,
  currency,
  letter,
  value,
  onChange,
}: {
  gap: number;
  currency: "ARS" | "USD";
  letter: string | null;
  value: ArcaGapTarget | null;
  onChange: (target: ArcaGapTarget) => void;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border px-3 py-3">
      <legend className="px-1 text-sm font-medium">
        Diferencia de {formatMoney(gap, currency)}: va a
      </legend>
      <p className="text-xs text-muted-foreground">
        ARCA no detalla esta parte del total (suelen ser percepciones). Elegí
        dónde se carga; el IVA y el total quedan como los informó ARCA.
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {ARCA_GAP_TARGETS.map((target) => (
          <label
            key={target}
            className="flex cursor-pointer items-center gap-2 text-sm"
          >
            <input
              type="radio"
              name="arca-gap-target"
              value={target}
              checked={value === target}
              onChange={() => onChange(target)}
              className="size-4 cursor-pointer accent-primary"
            />
            {arcaGapTargetLabel(target, letter)}
          </label>
        ))}
      </div>
      {value === "otros_tributos" && (
        <p className="text-xs text-muted-foreground">
          Repartila abajo entre los tributos, como cualquier percepción.
        </p>
      )}
    </fieldset>
  );
}
