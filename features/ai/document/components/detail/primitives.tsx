"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Format a numeric amount as money; non-numbers become an em dash. */
export function fmtMoney(value: unknown, currency?: string | null): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  const symbol = currency === "USD" ? "US$" : "$";
  return `${symbol} ${value.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function fmtNumber(value: unknown): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return value.toLocaleString("es-AR");
}

export function fmtText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function isEmptyDisplay(value: ReactNode): boolean {
  return value === null || value === undefined || value === "" || value === "—";
}

/** A single label/value row. Renders nothing when the value is empty/em-dash. */
export function Field({ label, value }: { label: string; value: ReactNode }) {
  if (isEmptyDisplay(value)) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="truncate text-right font-mono text-xs">{value}</span>
    </div>
  );
}

/** A titled, bordered group of fields. */
export function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-1">
      <h4 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
        <Icon className="size-3.5" /> {title}
      </h4>
      <div className="rounded-md border px-3 py-2">{children}</div>
    </section>
  );
}

export type Align = "left" | "right";

/** A compact bordered table for line items / movements. */
export function DetailTable({
  headers,
  aligns,
  rows,
}: {
  headers: string[];
  aligns: Align[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-md border text-xs">
      <table className="w-full">
        <thead>
          <tr className="text-muted-foreground border-b">
            {headers.map((h, i) => (
              <th
                key={i}
                className={`px-2 py-1 font-medium ${aligns[i] === "right" ? "text-right" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b last:border-0">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`px-2 py-1 ${aligns[c] === "right" ? "text-right font-mono tabular-nums" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
