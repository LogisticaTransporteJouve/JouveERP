"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Role } from "@/lib/auth/permissions";
import { userCan } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

import {
  useAttendanceEmployees,
  useAttendanceMonth,
} from "../hooks/use-attendance";
import {
  ATTENDANCE_KIND_LABEL,
  ATTENDANCE_KIND_SHORT,
  ATTENDANCE_KIND_TONE,
  type AttendanceKind,
  type AttendanceRecord,
} from "../attendance-schema";
import { MONTH_LABELS } from "../payroll-schema";

import { AttendanceCellDialog } from "./attendance-cell-dialog";

function daysInMonth(year: number, month: number): number {
  // month es 1-12
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateStr(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month - 1, day).getDay(); // 0=domingo, 6=sábado
  return dow === 0 || dow === 6;
}

type CellSel = {
  employeeId: string;
  employeeName: string;
  date: string;
  existing: AttendanceRecord | null;
} | null;

export function AttendanceGrid({
  year,
  month,
  actorRoles,
}: {
  year: number;
  month: number;
  actorRoles: Role[];
}) {
  const router = useRouter();
  const { data } = useAttendanceMonth(year, month);
  const { data: employees } = useAttendanceEmployees();
  const canWrite = userCan(actorRoles, "hr:write");
  const [selectedCell, setSelectedCell] = useState<CellSel>(null);

  const recordsByEmpDate = useMemo(() => {
    const m = new Map<string, AttendanceRecord>();
    for (const r of data.records) {
      m.set(`${r.employee_id}|${r.date}`, r);
    }
    return m;
  }, [data.records]);

  const holidayDates = useMemo(
    () => new Set(data.holidays.map((h) => h.date)),
    [data.holidays],
  );

  const dayCount = daysInMonth(year, month);
  const days = Array.from({ length: dayCount }, (_, i) => i + 1);

  function navigate(deltaMonths: number) {
    const d = new Date(year, month - 1 + deltaMonths, 1);
    router.push(`/hr/attendance/${d.getFullYear()}/${d.getMonth() + 1}`);
  }

  function openCell(employeeId: string, employeeName: string, day: number) {
    if (!canWrite) return;
    const date = dateStr(year, month, day);
    const existing = recordsByEmpDate.get(`${employeeId}|${date}`) ?? null;
    // Si el día es feriado y no hay manual, sugerimos crear (kind=holiday no
    // está en manuals, así que el dialog igualmente arranca con
    // absent_justified como default — admin puede cambiarlo).
    setSelectedCell({
      employeeId,
      employeeName,
      date,
      existing: existing && existing.source === "manual" ? existing : existing,
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Asistencia — {MONTH_LABELS[month - 1]} {year}
          </h1>
          <p className="text-sm text-muted-foreground">
            Celdas vacías = trabajó. Click para registrar una excepción.
            Licencias y feriados se sincronizan automáticamente.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => navigate(1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {data.holidays.length > 0 && (
        <div className="rounded-lg border bg-card p-3 text-xs">
          <span className="font-medium">Feriados:</span>{" "}
          {data.holidays.map((h, i) => (
            <span key={h.date}>
              {i > 0 && " · "}
              <span className="font-mono">{h.date.slice(-2)}</span> {h.name}
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-xs">
          <thead className="border-b">
            <tr>
              <th className="sticky left-0 bg-card px-3 py-2 text-left text-xs font-medium z-10">
                Empleado
              </th>
              {days.map((d) => {
                const isWk = isWeekend(year, month, d);
                const isHol = holidayDates.has(dateStr(year, month, d));
                return (
                  <th
                    key={d}
                    className={cn(
                      "w-7 px-0 py-2 text-center text-[10px] font-medium",
                      (isWk || isHol) &&
                        "bg-muted-foreground/5 text-muted-foreground",
                    )}
                  >
                    {d}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td
                  colSpan={dayCount + 1}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No hay empleados activos.
                </td>
              </tr>
            ) : (
              employees.map((emp) => (
                <tr key={emp.id} className="border-t">
                  <td className="sticky left-0 bg-card px-3 py-1.5 text-sm font-medium z-10">
                    {emp.legal_name}
                    <Badge
                      variant="outline"
                      className="ml-2 text-[10px] font-normal"
                    >
                      {emp.pay_frequency}
                    </Badge>
                  </td>
                  {days.map((d) => {
                    const date = dateStr(year, month, d);
                    const rec = recordsByEmpDate.get(`${emp.id}|${date}`);
                    const isWk = isWeekend(year, month, d);
                    const isHol = holidayDates.has(date);
                    return (
                      <td
                        key={d}
                        className={cn(
                          "p-0 align-middle text-center",
                          (isWk || isHol) && !rec && "bg-muted-foreground/5",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => openCell(emp.id, emp.legal_name, d)}
                          disabled={!canWrite}
                          className={cn(
                            "h-7 w-7 rounded text-[10px] font-medium leading-none transition-colors",
                            !rec && canWrite && "hover:bg-muted",
                            rec
                              ? ATTENDANCE_KIND_TONE[rec.kind as AttendanceKind]
                              : "",
                          )}
                          title={
                            rec
                              ? `${ATTENDANCE_KIND_LABEL[rec.kind as AttendanceKind]}${
                                  rec.notes ? ` · ${rec.notes}` : ""
                                }`
                              : isHol
                                ? "Feriado"
                                : isWk
                                  ? "Fin de semana"
                                  : "Trabajó"
                          }
                        >
                          {rec
                            ? ATTENDANCE_KIND_SHORT[rec.kind as AttendanceKind]
                            : ""}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Legend />

      {selectedCell && (
        <AttendanceCellDialog
          open={!!selectedCell}
          onOpenChange={(open) => {
            if (!open) setSelectedCell(null);
          }}
          employeeId={selectedCell.employeeId}
          employeeName={selectedCell.employeeName}
          date={selectedCell.date}
          existing={selectedCell.existing}
          year={year}
          month={month}
        />
      )}
    </div>
  );
}

function Legend() {
  const items: AttendanceKind[] = [
    "absent_justified",
    "absent_unjustified",
    "late",
    "early_leave",
    "sick",
    "leave",
    "holiday",
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[10px]">
      {items.map((k) => (
        <span
          key={k}
          className={cn(
            "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
            ATTENDANCE_KIND_TONE[k],
          )}
        >
          <span className="font-mono font-bold">{ATTENDANCE_KIND_SHORT[k]}</span>
          {ATTENDANCE_KIND_LABEL[k]}
        </span>
      ))}
    </div>
  );
}
