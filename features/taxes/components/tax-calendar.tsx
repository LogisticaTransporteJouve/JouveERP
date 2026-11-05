"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { formatMoney, formatPeriod } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  isTaxDocumentOverdue,
  monthGrid,
  shiftMonth,
  taxDocumentLabel,
  type TaxDocument,
} from "../schema";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** Month grid of due dates. Monochrome: the state is a word or an icon. */
export function TaxCalendar({
  docs,
  month,
  today,
  onMonthChange,
  onSelect,
}: {
  docs: readonly TaxDocument[];
  /** YYYY-MM */
  month: string;
  today: string;
  onMonthChange: (month: string) => void;
  onSelect: (doc: TaxDocument) => void;
}) {
  const weeks = useMemo(() => monthGrid(month), [month]);
  const byDay = useMemo(() => {
    const map = new Map<string, TaxDocument[]>();
    for (const doc of docs) {
      if (doc.status === "anulado" || !doc.due_date.startsWith(month)) continue;
      map.set(doc.due_date, [...(map.get(doc.due_date) ?? []), doc]);
    }
    return map;
  }, [docs, month]);
  const monthDocs = [...byDay.values()].flat();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <IconButton
          label="Mes anterior"
          variant="outline"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
        >
          <ChevronLeft />
        </IconButton>
        <p className="text-sm font-medium capitalize">{formatPeriod(month)}</p>
        <IconButton
          label="Mes siguiente"
          variant="outline"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
        >
          <ChevronRight />
        </IconButton>
      </div>

      {/* Grid from sm up; a list below it, where seven columns do not fit. */}
      <div className="hidden overflow-hidden rounded-md border sm:block">
        <div className="bg-muted/50 grid grid-cols-7 border-b text-xs font-medium">
          {WEEKDAYS.map((d) => (
            <div key={d} className="px-2 py-1.5">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, i) => (
          <div key={i} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day, j) => (
              <div
                key={day ?? `empty-${i}-${j}`}
                className={cn(
                  "min-h-20 border-r p-1 last:border-r-0",
                  !day && "bg-muted/30",
                )}
              >
                {day && (
                  <>
                    <p
                      className={cn(
                        "text-muted-foreground text-[11px]",
                        day === today && "text-foreground font-semibold",
                      )}
                    >
                      {Number(day.slice(8))}
                      {day === today && " · hoy"}
                    </p>
                    <div className="mt-0.5 space-y-0.5">
                      {(byDay.get(day) ?? []).map((doc) => (
                        <CalendarChip
                          key={doc.id}
                          doc={doc}
                          today={today}
                          onSelect={onSelect}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <ul className="space-y-1 sm:hidden">
        {monthDocs.length === 0 && (
          <li className="text-muted-foreground text-sm">
            Sin vencimientos este mes.
          </li>
        )}
        {monthDocs.map((doc) => (
          <li key={doc.id} className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground w-10 shrink-0 tabular-nums">
              {doc.due_date.slice(8)}/{doc.due_date.slice(5, 7)}
            </span>
            <CalendarChip doc={doc} today={today} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CalendarChip({
  doc,
  today,
  onSelect,
}: {
  doc: TaxDocument;
  today: string;
  onSelect: (doc: TaxDocument) => void;
}) {
  const overdue = isTaxDocumentOverdue(doc, today);
  const paid = doc.status === "pagado";
  return (
    <button
      type="button"
      onClick={() => onSelect(doc)}
      className={cn(
        "hover:bg-accent flex w-full min-w-0 items-center gap-1 rounded border px-1 py-0.5 text-left text-[11px] leading-tight",
        paid && "text-muted-foreground",
        overdue && "border-foreground font-medium",
      )}
      title={`${taxDocumentLabel(doc)} — ${formatPeriod(doc.period)}${
        doc.amount !== null ? ` — ${formatMoney(doc.amount)}` : ""
      }`}
    >
      {paid && <Check className="size-3 shrink-0" aria-label="Pagado" />}
      {overdue && (
        <AlertTriangle className="size-3 shrink-0" aria-label="Vencido" />
      )}
      <span className="truncate">{taxDocumentLabel(doc)}</span>
    </button>
  );
}
