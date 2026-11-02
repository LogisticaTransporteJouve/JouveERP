"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { todayInAR } from "@/lib/format";

import { useSetVacationOpening } from "../hooks/use-vacations";
import {
  currentVacationPeriodYear,
  suggestedVacationDays,
} from "../lib/vacation-periods";

/** Loads by hand an employee's vacation days: the period in course and the
 *  days pending from earlier years (owner/admin). */
export function VacationOpeningDialog({
  employeeId,
  employeeName,
  hireDate,
  currentDays,
  previousDays,
  triggerLabel = "Cargar saldo",
}: {
  employeeId: string;
  employeeName: string;
  hireDate: string;
  /** Days of the period in course today, null when not granted yet. */
  currentDays: number | null;
  /** Days still pending from earlier periods. */
  previousDays: number;
  triggerLabel?: string;
}) {
  const period = currentVacationPeriodYear(todayInAR());
  const suggested = suggestedVacationDays(hireDate, period);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [previous, setPrevious] = useState("");
  const mut = useSetVacationOpening();

  function onOpenChange(next: boolean) {
    if (next) {
      setCurrent(String(currentDays ?? suggested));
      setPrevious(String(previousDays));
    }
    setOpen(next);
  }

  function parseDays(value: string): number | null {
    const n = Number(value.trim());
    return Number.isInteger(n) && n >= 0 && n <= 365 ? n : null;
  }

  function onSave() {
    const currentN = parseDays(current);
    const previousN = parseDays(previous);
    if (currentN === null || previousN === null) {
      toast.error("Ingresá cantidades de días enteras, de 0 a 365.");
      return;
    }
    mut.mutate(
      {
        employee_id: employeeId,
        current_days: currentN,
        previous_days: previousN,
      },
      {
        onSuccess: () => {
          toast.success("Saldo de vacaciones guardado.");
          setOpen(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vacaciones — {employeeName}</DialogTitle>
          <DialogDescription>
            Los días ya tomados y cargados como licencia se descuentan solos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="vac-current">
              Días del período en curso ({period}-{period + 1})
            </Label>
            <Input
              id="vac-current"
              inputMode="numeric"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Por antigüedad le corresponden {suggested} días (LCT art. 150).
              Cambialo si se pactaron más.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vac-previous">
              Días pendientes de años anteriores
            </Label>
            <Input
              id="vac-previous"
              inputMode="numeric"
              value={previous}
              onChange={(e) => setPrevious(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Lo que le queda sin tomar de períodos anteriores. Se usa primero.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mut.isPending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={onSave} disabled={mut.isPending}>
            {mut.isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
