"use client";

import { Percent } from "lucide-react";
import { Suspense, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { MonthPicker } from "@/components/ui/month-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney, todayInAR } from "@/lib/format";

import {
  RAISE_SCOPE_LABEL,
  RAISE_SCOPES,
  raisedSalary,
  raiseTargets,
  type RaiseScope,
} from "../account-schema";
import { useApplySalaryRaise } from "../hooks/use-employee-account";
import { useEmployeesList } from "../hooks/use-employees";

/** "Aumento %": raise the base salary of a group of active employees from a
 *  month on. Draft planillas from that month that still hold the old salary
 *  follow; closed ones do not change. */
export function SalaryRaiseDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Percent className="size-4" />
          Aumento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Aumento de sueldo</DialogTitle>
          <DialogDescription>
            Sube el sueldo base de los empleados elegidos desde un mes. Las
            planillas en borrador desde ese mes que tienen el sueldo anterior se
            actualizan; las cerradas no cambian. Queda en el historial de cada
            empleado.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <Suspense
            fallback={
              <div className="py-6 text-center text-sm text-muted-foreground">
                Cargando…
              </div>
            }
          >
            <RaiseForm onDone={() => setOpen(false)} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RaiseForm({ onDone }: { onDone: () => void }) {
  const { data: employees } = useEmployeesList();
  const mutation = useApplySalaryRaise();
  const active = useMemo(
    () => employees.filter((e) => e.is_active),
    [employees],
  );
  const [scope, setScope] = useState<RaiseScope>("all");
  const [value, setValue] = useState("");
  const [percentage, setPercentage] = useState("");
  const [month, setMonth] = useState(todayInAR().slice(0, 7));
  const [reason, setReason] = useState("");

  const options = useMemo(() => {
    if (scope === "all") return [];
    const pick = (e: (typeof active)[number]) =>
      scope === "position" ? e.position : e.convenio;
    return [
      ...new Set(
        active.map(pick).filter((v): v is string => !!v && v.trim() !== ""),
      ),
    ].sort((a, b) => a.localeCompare(b, "es-AR"));
  }, [active, scope]);

  const targets = raiseTargets(active, scope, value);
  const pct = Number(percentage.replace(/,/g, "."));
  const validPct = Number.isFinite(pct) && pct > 0 && pct <= 100;

  function onApply() {
    mutation.mutate(
      {
        employee_ids: targets.map((t) => t.id),
        percentage: percentage.replace(/,/g, "."),
        effective_month: month,
        reason,
      },
      {
        onSuccess: ({ updated }) => {
          toast.success(`Aumento aplicado a ${updated} empleado(s).`);
          onDone();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="raise-scope">A quiénes</Label>
          <Select
            value={scope}
            onValueChange={(v) => {
              const found = RAISE_SCOPES.find((s) => s === v);
              if (found) {
                setScope(found);
                setValue("");
              }
            }}
          >
            <SelectTrigger id="raise-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RAISE_SCOPES.map((s) => (
                <SelectItem key={s} value={s}>
                  {RAISE_SCOPE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {scope !== "all" && (
          <div className="space-y-2">
            <Label htmlFor="raise-value">
              {scope === "position" ? "Puesto" : "Convenio"}
            </Label>
            <Select value={value} onValueChange={setValue}>
              <SelectTrigger id="raise-value">
                <SelectValue placeholder="Elegí" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="raise-pct">Aumento (%)</Label>
          <Input
            id="raise-pct"
            inputMode="decimal"
            className="text-right font-mono"
            value={percentage}
            onChange={(e) => setPercentage(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="raise-month">Desde el mes</Label>
          <MonthPicker id="raise-month" value={month} onChange={setMonth} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="raise-reason">Motivo (opcional)</Label>
          <Input
            id="raise-reason"
            placeholder="Ej. paritaria camioneros"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-md border">
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          {targets.length} empleado(s) con sueldo base
          {scope !== "all" && value === "" ? " — elegí un valor" : ""}
        </p>
        <ul className="max-h-60 divide-y overflow-y-auto text-sm">
          {targets.map((t) => (
            <li
              key={t.id}
              className="flex items-center justify-between gap-2 px-3 py-1.5"
            >
              <span className="min-w-0 truncate">{t.legal_name}</span>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {formatMoney(t.base_salary ?? 0)} →{" "}
                <span className="text-foreground">
                  {validPct
                    ? formatMoney(raisedSalary(t.base_salary ?? 0, pct))
                    : "—"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button
          onClick={onApply}
          disabled={
            mutation.isPending ||
            !validPct ||
            targets.length === 0 ||
            (scope !== "all" && value === "")
          }
        >
          {mutation.isPending ? "Aplicando…" : "Aplicar aumento"}
        </Button>
      </DialogFooter>
    </div>
  );
}
