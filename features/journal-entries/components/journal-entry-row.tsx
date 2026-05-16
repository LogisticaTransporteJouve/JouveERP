"use client";

import { ChevronDown, ChevronRight, ExternalLink, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatArgentineDate } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  isKnownSource,
  SOURCE_HREF_PREFIX,
  SOURCE_LABEL,
  type JournalEntryWithLines,
} from "../schema";

const fmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const money = (n: number) => `$${fmt.format(n)}`;

export function JournalEntryRow({ entry }: { entry: JournalEntryWithLines }) {
  const [open, setOpen] = useState(false);
  const debitSum = entry.lines.reduce((a, l) => a + Number(l.debit), 0);
  const creditSum = entry.lines.reduce((a, l) => a + Number(l.credit), 0);
  const balanced = Math.abs(debitSum - creditSum) < 0.005;

  const sourceLabel = isKnownSource(entry.source_table)
    ? SOURCE_LABEL[entry.source_table]
    : entry.source_table ?? "Manual";

  const sourceHref =
    isKnownSource(entry.source_table) && entry.source_id
      ? `${SOURCE_HREF_PREFIX[entry.source_table]}/${entry.source_id}`
      : null;

  return (
    <li className={cn("border-b last:border-b-0", entry.is_reversal && "bg-red-500/5")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/40"
      >
        <span className="text-muted-foreground">
          {open ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">
          {formatArgentineDate(entry.entry_date)}
        </span>
        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {entry.accrual_period}
        </span>
        <span className="flex-1 truncate text-sm">
          {entry.is_reversal && (
            <Undo2 className="mr-1 inline-block size-3 text-red-600" />
          )}
          {entry.description}
        </span>
        <Badge variant="outline" className="hidden text-xs font-normal md:inline-flex">
          {sourceLabel}
        </Badge>
        {entry.channel && (
          <Badge variant="secondary" className="text-xs">
            {entry.channel.name}
          </Badge>
        )}
        <span
          className={cn(
            "w-28 shrink-0 text-right font-mono text-sm",
            !balanced && "text-red-600",
          )}
        >
          {money(debitSum)}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t bg-muted/20 px-3 py-3">
          {sourceHref && (
            <div>
              <Button asChild variant="link" size="sm" className="h-auto p-0">
                <Link href={sourceHref}>
                  Ver {sourceLabel.toLowerCase()}
                  <ExternalLink className="ml-1 size-3" />
                </Link>
              </Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Código</th>
                <th className="py-1 pr-3 font-medium">Cuenta</th>
                <th className="py-1 pr-3 font-medium">Descripción</th>
                <th className="py-1 pr-3 text-right font-medium">Debe</th>
                <th className="py-1 text-right font-medium">Haber</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={line.id} className="border-t border-dashed">
                  <td className="py-1 pr-3 font-mono text-xs text-muted-foreground">
                    {line.account?.code ?? "—"}
                  </td>
                  <td className="py-1 pr-3">{line.account?.name ?? "—"}</td>
                  <td className="py-1 pr-3 text-xs text-muted-foreground">
                    {line.description ?? "—"}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {Number(line.debit) > 0 ? money(Number(line.debit)) : ""}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {Number(line.credit) > 0 ? money(Number(line.credit)) : ""}
                  </td>
                </tr>
              ))}
              <tr className="border-t font-semibold">
                <td colSpan={3} className="py-1 pr-3 text-right text-xs">
                  Totales
                </td>
                <td className="py-1 pr-3 text-right font-mono">{money(debitSum)}</td>
                <td className="py-1 text-right font-mono">{money(creditSum)}</td>
              </tr>
              {!balanced && (
                <tr>
                  <td colSpan={5} className="pt-2 text-right text-xs text-red-600">
                    Asiento desbalanceado: diferencia {money(Math.abs(debitSum - creditSum))}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}
