"use client";

import { Gift } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useSeedSacPeriod } from "../hooks/use-payroll";
import {
  formatPayrollPeriod,
  payrollPeriodHref,
  sacMonth,
  type SacHalf,
} from "../payroll-schema";

export function NewSacPeriodDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const mut = useSeedSacPeriod();

  const today = new Date();
  const [year, setYear] = useState(String(today.getFullYear()));
  const [half, setHalf] = useState<SacHalf>(today.getMonth() < 6 ? 1 : 2);
  const years = Array.from(
    { length: 5 },
    (_, i) => today.getFullYear() - 2 + i,
  );

  function onSubmit() {
    const y = Number(year);
    mut.mutate(
      { year: y, half },
      {
        onSuccess: () => {
          toast.success(
            `${formatPayrollPeriod(y, sacMonth(half), "sac")} generado.`,
          );
          setOpen(false);
          router.push(payrollPeriodHref(y, sacMonth(half), "sac"));
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Gift className="size-4" />
          Nuevo SAC
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generar SAC (aguinaldo)</DialogTitle>
          <DialogDescription>
            Crea (si no existe) la planilla del semestre con el SAC sugerido
            para cada empleado activo: 50% de la mejor remuneración mensual del
            semestre (sueldo + extras), proporcional a los días trabajados. Los
            montos se pueden editar.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="sac-half">Semestre</Label>
            <Select
              value={String(half)}
              onValueChange={(v) => setHalf(v === "1" ? 1 : 2)}
            >
              <SelectTrigger id="sac-half">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1.er semestre (junio)</SelectItem>
                <SelectItem value="2">2.º semestre (diciembre)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sac-year">Año</Label>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger id="sac-year">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mut.isPending}
          >
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={mut.isPending}>
            {mut.isPending ? "Generando…" : "Generar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
