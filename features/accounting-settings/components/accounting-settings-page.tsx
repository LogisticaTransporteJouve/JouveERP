"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  fiscalYearLabel,
  fiscalYearMonths,
  fiscalYearMonthsLabel,
  fiscalYearOf,
  monthName,
  shortPeriodLabel,
} from "@/lib/fiscal-year";
import { todayInAR } from "@/lib/format";

import { useAccountingSettings } from "../hooks/use-accounting-settings";

import { FiscalYearDialog } from "./fiscal-year-dialog";

export function AccountingSettingsPage({ canEdit }: { canEdit: boolean }) {
  const { data } = useAccountingSettings();
  const [open, setOpen] = useState(false);
  const startMonth = data.fiscalYearStartMonth;
  const fy = fiscalYearOf(todayInAR().slice(0, 7), startMonth);
  const months = fiscalYearMonths(fy, startMonth);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración contable"
        description="Datos de la empresa que usan los reportes contables."
      />

      <div className="rounded-lg border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
          <div className="space-y-1">
            <h2 className="text-sm font-medium">Inicio del ejercicio</h2>
            <p className="text-sm">
              {monthName(startMonth)}{" "}
              <span className="text-muted-foreground">
                (ejercicio {fiscalYearMonthsLabel(startMonth)})
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              Ejercicio en curso: {fiscalYearLabel(fy, startMonth)} (
              {shortPeriodLabel(months[0]!)} – {shortPeriodLabel(months[11]!)}
              ).
            </p>
          </div>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              <Pencil className="size-4" />
              Cambiar
            </Button>
          )}
        </div>
      </div>

      {canEdit && (
        <FiscalYearDialog
          startMonth={startMonth}
          open={open}
          onOpenChange={setOpen}
        />
      )}
    </div>
  );
}
