"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useIgnoreInsight } from "../hooks/use-insights";
import { IgnoreInsightSchema } from "../lib/ignore-schema";

/** Ignores an insight with a reason; the analyst will not raise the same
 *  finding again. */
export function IgnoreInsightDialog({
  open,
  onOpenChange,
  insightId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  insightId: string;
  title: string;
}) {
  const ignore = useIgnoreInsight();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = IgnoreInsightSchema.safeParse({ id: insightId, reason });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Datos inválidos.");
      return;
    }
    ignore.mutate(parsed.data, {
      onSuccess: () => {
        toast.success("Insight ignorado.");
        setReason("");
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ignorar insight</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor={`ignore-${insightId}`}>Motivo</Label>
            <Textarea
              id={`ignore-${insightId}`}
              value={reason}
              placeholder="Ej.: es una factura repetida a propósito (dos entregas)."
              onChange={(e) => {
                setError("");
                setReason(e.target.value);
              }}
            />
            {error && <p className="text-xs font-medium">{error}</p>}
            <p className="text-muted-foreground text-xs">
              El analista no va a volver a mostrar este mismo hallazgo.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={ignore.isPending}>
              {ignore.isPending ? "Guardando…" : "Ignorar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
