"use client";

import {
  AlertTriangle,
  Check,
  ClipboardCheck,
  History,
  Pencil,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import {
  useConfirmAiProposal,
  useDeclineAiProposal,
} from "../hooks/use-ai-confirmations";
import {
  latestForCard,
  type AiConfirmation,
  type AiConfirmationStatus,
} from "../lib/confirmation-schema";
import { PROPOSAL_SPECS, type ProposalSummaryRow } from "../lib/proposal-specs";

import { ProposalEditDialog } from "./proposal-edit-dialog";

const STATUS_COPY: Record<
  Exclude<AiConfirmationStatus, "pending">,
  { label: string; icon: typeof Check }
> = {
  confirmed: { label: "Confirmada", icon: Check },
  declined: { label: "Descartada", icon: X },
  superseded: { label: "Reemplazada", icon: History },
  failed: { label: "No se pudo completar", icon: AlertTriangle },
};

/**
 * A proposal the assistant drafted. Its state comes from the session's
 * confirmations (not from the tool result, which never changes): pending
 * shows Confirm / Modify / Decline, anything else is read-only.
 */
export function ProposalCard({
  sessionId,
  toolCallId,
  title,
  fallbackSummary,
  confirmLabel,
  declineLabel,
  rows,
  syncing,
}: {
  sessionId: string;
  toolCallId: string;
  title: string;
  /** The tool result's rows, shown until the session's state loads. */
  fallbackSummary: ProposalSummaryRow[];
  confirmLabel: string;
  declineLabel: string;
  rows: readonly AiConfirmation[] | undefined;
  /** True while the chat streams: a card from this turn may not be in
   *  `rows` yet. */
  syncing: boolean;
}) {
  const confirm = useConfirmAiProposal(sessionId);
  const decline = useDeclineAiProposal(sessionId);
  const [editing, setEditing] = useState(false);

  const row = rows ? latestForCard(rows, toolCallId) : undefined;
  const summary = row?.summary ?? fallbackSummary;
  const spec = row ? PROPOSAL_SPECS[row.action] : undefined;
  const busy = confirm.isPending || decline.isPending;

  function onConfirm(id: string) {
    confirm.mutate(id, {
      onSuccess: () => toast.success("Listo, quedó registrado."),
      onError: (e) => toast.error(e.message),
    });
  }

  function onDecline(id: string) {
    decline.mutate(id, { onError: (e) => toast.error(e.message) });
  }

  return (
    <div className="w-full max-w-[85%] space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-medium">
          <ClipboardCheck className="size-4" /> {title}
        </p>
        <StatusLabel
          row={row}
          loaded={rows !== undefined && (row !== undefined || !syncing)}
        />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {summary.map((r, i) => (
          <div key={`${r.label}-${i}`} className="contents">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="break-words">{r.value}</dd>
          </div>
        ))}
      </dl>

      {row?.status === "failed" && row.error && (
        <p className="text-xs">{row.error}</p>
      )}

      {row?.status === "pending" && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onDecline(row.id)}
          >
            {declineLabel}
          </Button>
          {spec && spec.fields.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" /> Modificar
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => onConfirm(row.id)}
          >
            {confirm.isPending ? "Registrando…" : confirmLabel}
          </Button>
        </div>
      )}

      {row && spec && (
        <ProposalEditDialog
          open={editing}
          onOpenChange={setEditing}
          sessionId={sessionId}
          confirmation={row}
          spec={spec}
        />
      )}
    </div>
  );
}

function StatusLabel({
  row,
  loaded,
}: {
  row: AiConfirmation | undefined;
  loaded: boolean;
}) {
  if (!loaded) return null;
  if (!row) {
    return <span className="text-muted-foreground text-xs">No disponible</span>;
  }
  if (row.status === "pending") {
    return (
      <span className="text-muted-foreground text-xs">
        {row.origin === "user"
          ? "Editada · pendiente"
          : "Pendiente de confirmación"}
      </span>
    );
  }
  const { label, icon: Icon } = STATUS_COPY[row.status];
  return (
    <span className="flex items-center gap-1 text-xs font-medium">
      <Icon className="size-3.5" /> {label}
    </span>
  );
}
