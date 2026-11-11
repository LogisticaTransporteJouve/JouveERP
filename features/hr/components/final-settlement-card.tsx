"use client";

import { Calculator } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DisabledHint } from "@/components/disabled-hint";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/money-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  amountToInput,
  formatArgentineDate,
  formatMoney,
  parseArAmount,
} from "@/lib/format";

import {
  useApplyFinalSettlement,
  useFinalSettlement,
} from "../hooks/use-final-settlement";
import {
  formatPayrollPeriod,
  payrollPeriodHref,
  sacMonth,
} from "../payroll-schema";

type Draft = {
  prorated_salary: string;
  vacation_days: string;
  vacation_amount: string;
  sac_amount: string;
};

const DAYS_RE = /^\d+(\.\d{1,2})?$/;

function parseDays(raw: string): number | null {
  const value = raw.trim().replace(/,/g, ".");
  return DAYS_RE.test(value) ? Number(value) : null;
}

function parseMoney(raw: string): number | null {
  const value = parseArAmount(raw);
  return value !== null && value >= 0 ? value : null;
}

/** Suggested final settlement of a terminated employee, editable before it
 *  goes into the planilla of the leaving month. */
export function FinalSettlementCard({ employeeId }: { employeeId: string }) {
  const { data, isPending, isError, error } = useFinalSettlement(employeeId);
  const applyMut = useApplyFinalSettlement();
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      prorated_salary: amountToInput(data.prorated_salary),
      vacation_days: String(data.vacation_days),
      vacation_amount: amountToInput(data.vacation_amount),
      sac_amount: amountToInput(data.sac_amount),
    });
  }, [data]);

  function onApply() {
    if (!data || !draft) return;
    const values = {
      prorated_salary: parseMoney(draft.prorated_salary),
      vacation_days: parseDays(draft.vacation_days),
      vacation_amount: parseMoney(draft.vacation_amount),
      sac_amount: parseMoney(draft.sac_amount),
    };
    if (Object.values(values).some((v) => v === null)) {
      toast.error("Revisá los montos: tienen que ser números.");
      return;
    }
    applyMut.mutate(
      {
        employee_id: employeeId,
        prorated_salary: values.prorated_salary ?? 0,
        vacation_days: values.vacation_days ?? 0,
        vacation_amount: values.vacation_amount ?? 0,
        sac_amount: values.sac_amount ?? 0,
      },
      {
        onSuccess: ({ year, month }) =>
          toast.success(
            `Liquidación final cargada en la planilla de ${formatPayrollPeriod(year, month)}.`,
          ),
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 text-sm font-medium">
        <Calculator className="size-4 text-muted-foreground" />
        Liquidación final
      </h2>
      {isPending || (!isError && !draft) ? (
        <p className="mt-3 text-sm text-muted-foreground">Calculando…</p>
      ) : isError ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No se pudo calcular: {error.message}
        </p>
      ) : data && draft ? (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-muted-foreground">
            Baja el {formatArgentineDate(data.termination_date)}. Sugerencia
            sobre un sueldo de {formatMoney(data.monthly_salary)}; se carga en
            la planilla de{" "}
            <Link
              href={payrollPeriodHref(data.year, data.month)}
              className="text-primary hover:underline"
            >
              {formatPayrollPeriod(data.year, data.month)}
            </Link>
            {data.period_status === null ? " (se genera al cargarla)" : ""}
            {data.period_status === "closed"
              ? " — está cerrada, reabrila para cargarla"
              : ""}
            . Volver a cargarla reemplaza los montos anteriores.
          </p>
          {data.pay_mode === "recibo" ? (
            <p className="text-muted-foreground">
              Por recibo: las vacaciones no gozadas y el SAC proporcional van
              dentro del recibo final; cargalo en la planilla.
            </p>
          ) : null}
          {data.pay_mode !== "recibo" && data.sac_in_sac_planilla > 0 ? (
            <p className="text-muted-foreground">
              La planilla del{" "}
              <Link
                href={payrollPeriodHref(
                  data.year,
                  sacMonth(data.sac_half),
                  "sac",
                )}
                className="text-primary hover:underline"
              >
                {formatPayrollPeriod(data.year, sacMonth(data.sac_half), "sac")}
              </Link>{" "}
              ya le paga {formatMoney(data.sac_in_sac_planilla)} de SAC: el SAC
              proporcional sugerido es solo lo que falta. Si ahí cobra de más,
              ajustalo en esa planilla.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="fs-salary"
              label={`Sueldo por ${data.days_worked} días trabajados`}
              money
              value={draft.prorated_salary}
              onChange={(v) => setDraft({ ...draft, prorated_salary: v })}
            />
            <Field
              id="fs-vacation-days"
              label="Días de vacaciones no gozadas"
              value={draft.vacation_days}
              onChange={(v) => setDraft({ ...draft, vacation_days: v })}
            />
            {data.pay_mode !== "recibo" && (
              <>
                <Field
                  id="fs-vacation-amount"
                  label="Vacaciones no gozadas ($)"
                  money
                  value={draft.vacation_amount}
                  onChange={(v) => setDraft({ ...draft, vacation_amount: v })}
                />
                <Field
                  id="fs-sac"
                  label={`SAC proporcional (${formatPayrollPeriod(data.year, sacMonth(data.sac_half), "sac")})`}
                  money
                  value={draft.sac_amount}
                  onChange={(v) => setDraft({ ...draft, sac_amount: v })}
                />
              </>
            )}
          </div>
          <div className="flex justify-end">
            <DisabledHint
              reason={
                data.period_status === "closed"
                  ? "La planilla del período está cerrada."
                  : null
              }
            >
              <Button
                onClick={onApply}
                disabled={applyMut.isPending || data.period_status === "closed"}
              >
                {applyMut.isPending ? "Cargando…" : "Cargar en la planilla"}
              </Button>
            </DisabledHint>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  id,
  label,
  money = false,
  value,
  onChange,
}: {
  id: string;
  label: string;
  /** An es-AR amount; otherwise a day count. */
  money?: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      {money ? (
        <MoneyInput
          id={id}
          className="text-right font-mono"
          value={value}
          onChange={onChange}
        />
      ) : (
        <Input
          id={id}
          inputMode="decimal"
          className="text-right font-mono"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
