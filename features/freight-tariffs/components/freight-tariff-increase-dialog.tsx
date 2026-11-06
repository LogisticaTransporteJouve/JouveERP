"use client";

import { useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseArAmount, todayInAR } from "@/lib/format";

import { useApplyFreightTariffIncrease } from "../hooks/use-freight-tariffs";
import { FREIGHT_TARIFF_ROUNDINGS, type FreightTariffList } from "../schema";

/** «Aplicar aumento»: a new period for the chosen tarifarios from their
 *  latest prices raised by a percentage. */
export function FreightTariffIncreaseDialog({
  lists,
  onClose,
}: {
  lists: FreightTariffList[];
  onClose: () => void;
}) {
  const apply = useApplyFreightTariffIncrease();
  const withPrices = lists.filter((l) => l.versions.length > 0);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(withPrices.map((l) => l.id)),
  );
  const [pct, setPct] = useState("");
  const [label, setLabel] = useState("");
  const [validFrom, setValidFrom] = useState(todayInAR());
  const [roundTo, setRoundTo] = useState("10");

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aplicar aumento</DialogTitle>
          <DialogDescription>
            Cada tarifario elegido tiene un período nuevo con sus últimos
            precios aumentados. Los porcentajes (% x remito) y las notas no
            cambian; los períodos anteriores quedan para comparar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="fti-pct">Aumento %</Label>
              <MoneyInput
                id="fti-pct"
                value={pct}
                allowNegative
                decimals={3}
                placeholder="7,5"
                onChange={setPct}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fti-round">Redondeo</Label>
              <Select value={roundTo} onValueChange={setRoundTo}>
                <SelectTrigger id="fti-round" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREIGHT_TARIFF_ROUNDINGS.map((r) => (
                    <SelectItem key={r} value={String(r)}>
                      A ${r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="fti-label">Período nuevo</Label>
              <Input
                id="fti-label"
                value={label}
                placeholder="Enero/Febrero 27"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fti-from">Vigente desde</Label>
              <DatePicker
                id="fti-from"
                value={validFrom}
                onChange={setValidFrom}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Tarifarios</legend>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
              {withPrices.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selected.has(l.id)}
                    onCheckedChange={(v) => toggle(l.id, v === true)}
                  />
                  <span className="min-w-0 truncate">{l.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {l.versions[0]?.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={apply.isPending}>
            Cancelar
          </Button>
          <DisabledHint
            reason={selected.size === 0 ? "Elegí al menos una lista." : null}
          >
            <Button
              disabled={apply.isPending || selected.size === 0}
              onClick={() =>
                apply.mutate(
                  {
                    list_ids: [...selected],
                    pct: parseArAmount(pct) ?? undefined,
                    label,
                    valid_from: validFrom,
                    round_to: roundTo,
                  },
                  {
                    onSuccess: (r) => {
                      toast.success(
                        r.created === 1
                          ? "Aumento aplicado a 1 tarifario."
                          : `Aumento aplicado a ${r.created} tarifarios.`,
                      );
                      onClose();
                    },
                    onError: (err) => toast.error(err.message),
                  },
                )
              }
            >
              {apply.isPending ? "Aplicando…" : "Aplicar"}
            </Button>
          </DisabledHint>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
