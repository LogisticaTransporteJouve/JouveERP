"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { amountToInput, parseArAmount } from "@/lib/format";

import { useSaveFreightTariffVersion } from "../hooks/use-freight-tariffs";
import type { FreightTariffLineInput, FreightTariffVersion } from "../schema";

type Row = {
  key: number;
  section: string;
  concept: string;
  price: string;
  percent: string;
  note: string;
};

let nextKey = 0;
function toRow(l?: FreightTariffVersion["lines"][number]): Row {
  nextKey += 1;
  return {
    key: nextKey,
    section: l?.section ?? "",
    concept: l?.concept ?? "",
    price: l?.price != null ? amountToInput(l.price) : "",
    percent: l?.percent != null ? amountToInput(l.percent, 3) : "",
    note: l?.note ?? "",
  };
}

/** A row as the action takes it; an empty row is left out. */
function toLine(r: Row): FreightTariffLineInput | null {
  if (!r.concept.trim() && !r.section.trim() && !r.price && !r.percent) {
    return null;
  }
  return {
    section: r.section,
    concept: r.concept,
    price: r.price ? (parseArAmount(r.price) ?? Number.NaN) : null,
    percent: r.percent ? (parseArAmount(r.percent) ?? Number.NaN) : null,
    note: r.note,
  };
}

/** Edits one period of a tarifario: its name, start and every line. */
export function FreightTariffVersionDialog({
  listName,
  version,
  onClose,
}: {
  listName: string;
  version: FreightTariffVersion;
  onClose: () => void;
}) {
  const save = useSaveFreightTariffVersion();
  const [label, setLabel] = useState(version.label);
  const [validFrom, setValidFrom] = useState(version.valid_from);
  const [rows, setRows] = useState<Row[]>(() =>
    version.lines.length > 0 ? version.lines.map(toRow) : [toRow()],
  );

  const set = (key: number, field: keyof Omit<Row, "key">, value: string) =>
    setRows((rs) =>
      rs.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Precios de {listName}</DialogTitle>
          <DialogDescription>
            Cada línea lleva un precio en pesos o un porcentaje (por ejemplo «%
            x remito»). La nota es libre: «Tarifa + $ 62.600», «Más seguro»…
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ft-label">Período</Label>
            <Input
              id="ft-label"
              value={label}
              placeholder="Noviembre/Diciembre 26"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ft-from">Vigente desde</Label>
            <DatePicker
              id="ft-from"
              value={validFrom}
              onChange={setValidFrom}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-2 font-medium">Sección</th>
                <th className="p-2 font-medium">Concepto</th>
                <th className="w-36 p-2 font-medium">Precio $</th>
                <th className="w-20 p-2 font-medium">%</th>
                <th className="p-2 font-medium">Nota</th>
                <th className="w-10 p-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="p-1">
                    <Input
                      aria-label="Sección"
                      value={r.section}
                      placeholder="1 pallet"
                      onChange={(e) => set(r.key, "section", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label="Concepto"
                      value={r.concept}
                      placeholder="0 a 199 kg"
                      onChange={(e) => set(r.key, "concept", e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <MoneyInput
                      aria-label="Precio"
                      value={r.price}
                      onChange={(v) => set(r.key, "price", v)}
                    />
                  </td>
                  <td className="p-1">
                    <MoneyInput
                      aria-label="Porcentaje"
                      decimals={3}
                      value={r.percent}
                      onChange={(v) => set(r.key, "percent", v)}
                    />
                  </td>
                  <td className="p-1">
                    <Input
                      aria-label="Nota"
                      value={r.note}
                      onChange={(e) => set(r.key, "note", e.target.value)}
                    />
                  </td>
                  <td className="p-1 text-right">
                    <IconButton
                      label="Quitar línea"
                      variant="ghost"
                      onClick={() =>
                        setRows((rs) => rs.filter((x) => x.key !== r.key))
                      }
                    >
                      <Trash2 className="size-4" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows((rs) => [...rs, toRow()])}
          >
            <Plus className="size-4" />
            Agregar línea
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancelar
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: version.id,
                    label,
                    valid_from: validFrom,
                    lines: rows
                      .map(toLine)
                      .filter((l): l is FreightTariffLineInput => l !== null),
                  },
                  {
                    onSuccess: () => {
                      toast.success("Precios guardados.");
                      onClose();
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              {save.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
