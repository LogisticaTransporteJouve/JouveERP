"use client";

import { cn } from "@/lib/utils";

import { monthDays } from "../artifacts/calendar";
import type { CalendarArtifact } from "../artifacts/spec";

const WEEKDAY_INITIALS = ["D", "L", "M", "M", "J", "V", "S"] as const;

/** A month as a grid: one row per person, one narrow column per day, the
 *  kind's code in each marked day and weekends shaded. Monochrome; scrolls
 *  sideways when 31 days do not fit. */
export function ArtifactCalendar({
  artifact,
  maxHeight = "max-h-96",
}: {
  artifact: CalendarArtifact;
  maxHeight?: string;
}) {
  const days = monthDays(artifact.month).map((iso) => {
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return {
      iso,
      day: Number(iso.slice(8)),
      initial: WEEKDAY_INITIALS[weekday] ?? "",
      weekend: weekday === 0 || weekday === 6,
    };
  });

  return (
    <div className="space-y-2">
      <div className={cn("overflow-auto rounded-md border text-xs", maxHeight)}>
        <table className="border-separate border-spacing-0">
          <thead className="bg-muted sticky top-0 z-10">
            <tr className="text-muted-foreground">
              <th
                scope="col"
                className="bg-muted sticky left-0 z-20 border-b px-2 py-1 text-left font-medium whitespace-nowrap"
              >
                Empleado
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  scope="col"
                  className={cn(
                    "min-w-6 border-b border-l px-0.5 py-1 text-center font-medium tabular-nums",
                    d.weekend && "bg-foreground/5",
                  )}
                >
                  <span className="block text-[10px] leading-none">
                    {d.initial}
                  </span>
                  <span className="block leading-tight">{d.day}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {artifact.rows.map((row, r) => (
              <tr key={`${row.label}-${r}`}>
                <th
                  scope="row"
                  className="bg-card sticky left-0 z-10 max-w-48 truncate border-b px-2 py-1 text-left font-normal whitespace-nowrap"
                  title={row.label}
                >
                  {row.label}
                </th>
                {days.map((d, i) => {
                  const code = row.cells[i] ?? "";
                  return (
                    <td
                      key={d.iso}
                      className={cn(
                        "h-6 min-w-6 border-b border-l px-0.5 text-center font-mono text-[11px]",
                        d.weekend && "bg-foreground/5",
                        code &&
                          "bg-foreground/15 text-foreground font-semibold",
                      )}
                    >
                      {code}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {artifact.legend.map((l) => (
          <span key={l.code}>
            <span className="text-foreground font-mono font-semibold">
              {l.code}
            </span>{" "}
            {l.label}
          </span>
        ))}
        <span>Sombreado: fin de semana</span>
      </p>
    </div>
  );
}
