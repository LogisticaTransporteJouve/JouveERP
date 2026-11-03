"use client";

import { AlertTriangle, Check, ClipboardCheck, Clock, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatArgentineDateTime } from "@/lib/format";

import type {
  AiProposalCard,
  AiProposalStatus,
} from "../../lib/ai-proposal-schema";
import {
  useAcceptAiProposal,
  useDismissAiProposal,
  usePrepareInsightProposal,
} from "../hooks/use-insight-proposal";

const STATUS_COPY: Record<
  Exclude<AiProposalStatus, "pending">,
  { label: string; icon: typeof Check }
> = {
  accepted: { label: "Aceptada", icon: Check },
  dismissed: { label: "Descartada", icon: X },
  failed: { label: "No se pudo completar", icon: AlertTriangle },
  expired: { label: "Vencida", icon: Clock },
};

/**
 * The proposal an insight offers, prepared with the viewer's permissions
 * when the dialog opens. Nothing is written until "Aceptar"; the server
 * re-checks the permission, re-validates the draft and claims it once.
 */
export function InsightProposalDialog({
  open,
  onOpenChange,
  insightId,
  insightTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insightId: string;
  insightTitle: string;
}) {
  const prepare = usePrepareInsightProposal();
  const accept = useAcceptAiProposal();
  const dismiss = useDismissAiProposal();
  const [card, setCard] = useState<AiProposalCard | null>(null);
  const { mutate: prepareMutate, reset: prepareReset } = prepare;
  const { reset: acceptReset } = accept;

  useEffect(() => {
    if (!open) return;
    setCard(null);
    prepareReset();
    acceptReset();
    prepareMutate(insightId, { onSuccess: setCard });
  }, [open, insightId, prepareMutate, prepareReset, acceptReset]);

  const busy = accept.isPending || dismiss.isPending;

  function onAccept(id: string) {
    accept.mutate(id, {
      onSuccess: (res) => {
        toast.success(res.note ? `Listo: ${res.note}` : "Listo, quedó registrado.");
        setCard((c) => (c ? { ...c, status: "accepted", note: res.note } : c));
      },
      // The row's state is the server's: reopening the dialog shows it.
      onError: (e) => toast.error(e.message),
    });
  }

  function onDismiss(id: string) {
    dismiss.mutate(id, {
      onSuccess: () => onOpenChange(false),
      onError: (e) => toast.error(e.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-4" />
            {card?.title ?? "Propuesta"}
          </DialogTitle>
          <DialogDescription>{insightTitle}</DialogDescription>
        </DialogHeader>

        {prepare.isPending && (
          <p className="text-muted-foreground text-sm">Armando la propuesta…</p>
        )}
        {prepare.isError && <p className="text-sm">{prepare.error.message}</p>}

        {accept.isError && (
          <p className="text-sm font-medium">{accept.error.message}</p>
        )}
        {card && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {card.summary.map((r, i) => (
                <div key={`${r.label}-${i}`} className="contents">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className="min-w-0 break-words">{r.value}</dd>
                </div>
              ))}
            </dl>
            {card.status === "pending" ? (
              <p className="text-muted-foreground text-xs">
                No se registra nada hasta que aceptes. Vale hasta el{" "}
                {formatArgentineDateTime(card.expiresAt)}.
              </p>
            ) : (
              <StatusLine card={card} />
            )}
          </div>
        )}

        <DialogFooter>
          {card?.status === "pending" ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onDismiss(card.id)}
              >
                Descartar
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => onAccept(card.id)}
              >
                {accept.isPending ? "Registrando…" : "Aceptar"}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cerrar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusLine({ card }: { card: AiProposalCard }) {
  if (card.status === "pending") return null;
  const { label, icon: Icon } = STATUS_COPY[card.status];
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1 text-xs font-medium">
        <Icon className="size-3.5" /> {label}
      </p>
      {card.note && <p className="text-xs">{card.note}</p>}
      {card.status === "failed" && card.error && (
        <p className="text-xs">{card.error}</p>
      )}
    </div>
  );
}
