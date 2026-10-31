"use client";

import { Button } from "@/components/ui/button";
import { formatMoneySigned } from "@/lib/format";
import {
  LIST_GROUPS,
  LIST_GROUP_LABEL,
  formatBucket,
  type ListGroup,
} from "@/lib/list-period";
import type { TotalsSummary } from "@/lib/list-totals";

/** "Lista / Por día / Por semana / Por mes" switch of a document list. */
export function ListGroupToggle({
  value,
  onChange,
}: {
  value: ListGroup | null;
  onChange: (next: ListGroup | null) => void;
}) {
  const options: { value: ListGroup | null; label: string }[] = [
    { value: null, label: "Lista" },
    ...LIST_GROUPS.map((g) => ({ value: g, label: LIST_GROUP_LABEL[g] })),
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Vista"
      className="inline-flex rounded-md border p-0.5"
    >
      {options.map((o) => (
        <Button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          size="sm"
          variant={value === o.value ? "secondary" : "ghost"}
          className="h-8"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/** Singular and plural noun of the documents counted, e.g.
 *  `["comprobante", "comprobantes"]`. */
export type DocumentNoun = readonly [string, string];

function countLabel(count: number, noun: DocumentNoun): string {
  return `${count.toLocaleString("es-AR")} ${count === 1 ? noun[0] : noun[1]}`;
}

function Amounts({ summary }: { summary: TotalsSummary }) {
  if (summary.amounts.length === 0) {
    return <span className="font-mono">{formatMoneySigned(0)}</span>;
  }
  return (
    <>
      {summary.amounts.map((a) => (
        <span key={a.currency} className="font-mono">
          {formatMoneySigned(a.total, a.currency)}
        </span>
      ))}
    </>
  );
}

/** Grand total strip above a document list. */
export function ListTotalsBar({
  summary,
  noun,
  note,
}: {
  summary: TotalsSummary;
  noun: DocumentNoun;
  /** What the amount includes, e.g. "Las NC restan; anulados no suman." */
  note: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        {countLabel(summary.documents, noun)}
        <span className="ml-2 text-xs">{note}</span>
      </span>
      <span className="flex flex-wrap gap-x-4 font-semibold">
        <span className="font-sans font-normal text-muted-foreground">
          Total
        </span>
        <Amounts summary={summary} />
      </span>
    </div>
  );
}

/** Content of a group header row: the bucket and its DB subtotal. */
export function ListGroupHeader({
  bucket,
  group,
  summary,
  noun,
}: {
  bucket: string;
  group: ListGroup;
  summary: TotalsSummary | undefined;
  noun: DocumentNoun;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
      <span className="inline-block font-medium first-letter:uppercase">
        {formatBucket(bucket, group)}
      </span>
      {summary && (
        <span className="flex flex-wrap items-baseline gap-x-4">
          <span className="text-xs text-muted-foreground">
            {countLabel(summary.documents, noun)}
          </span>
          <span className="flex gap-x-4 font-medium">
            <Amounts summary={summary} />
          </span>
        </span>
      )}
    </div>
  );
}
