import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  FileWarning,
} from "lucide-react";
import Link from "next/link";

import { formatArDateShort, formatMoneyWithCode } from "@/lib/format";

import type { DueDateItem } from "../schema";

const MAX_VISIBLE = 12;

export function DueDatesCard({ items }: { items: DueDateItem[] }) {
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b p-4">
        <CalendarClock className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Próximos vencimientos</h2>
        <span className="ml-auto text-xs text-muted-foreground">14 días</span>
      </div>
      {visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          Sin vencimientos en los próximos 14 días.
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-3 p-3 text-sm hover:bg-accent/50"
              >
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {formatArDateShort(item.date)}
                </span>
                {item.direction === "in" ? (
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground dark:text-muted-foreground" />
                ) : item.direction === "out" ? (
                  <ArrowDownRight className="size-4 shrink-0 text-foreground dark:text-foreground" />
                ) : (
                  <FileWarning className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {item.label}
                  </span>
                  {item.detail && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.detail}
                    </span>
                  )}
                </span>
                {item.amount != null && item.currency && (
                  <span className="shrink-0 font-mono text-xs">
                    {formatMoneyWithCode(item.amount, item.currency)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hidden > 0 && (
        <p className="border-t p-3 text-xs text-muted-foreground">
          +{hidden} vencimientos más en el período.
        </p>
      )}
    </section>
  );
}
