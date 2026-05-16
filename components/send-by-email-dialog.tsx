"use client";

import { Loader2, Mail } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  getInvoiceEmailDefaultsAction,
  sendInvoiceByEmailAction,
} from "@/features/invoices/actions/send-invoice-email";
import {
  getReceiptEmailDefaultsAction,
  sendReceiptByEmailAction,
} from "@/features/receipts/actions/send-receipt-email";

export type SendByEmailKind = "invoice" | "receipt";

const KIND_COPY: Record<
  SendByEmailKind,
  { titleNoun: string; entityNoun: string; descriptionNoun: string }
> = {
  invoice: {
    titleNoun: "Enviar comprobante por email",
    entityNoun: "comprobante",
    descriptionNoun: "El cliente recibirá el PDF adjunto.",
  },
  receipt: {
    titleNoun: "Enviar recibo por email",
    entityNoun: "recibo",
    descriptionNoun: "El cliente recibirá el PDF del recibo adjunto.",
  },
};

export function SendByEmailDialog({
  kind,
  id,
  iconOnly = true,
  label,
}: {
  kind: SendByEmailKind;
  id: string;
  iconOnly?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [initial, setInitial] = useState<{
    recipient: string;
    subject: string;
    body: string;
  } | null>(null);
  const [lastSentAt, setLastSentAt] = useState<string | null>(null);
  const copy = KIND_COPY[kind];

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const result =
        kind === "invoice"
          ? await getInvoiceEmailDefaultsAction(id)
          : await getReceiptEmailDefaultsAction(id);
      if (cancelled) return;
      if (!result.ok) {
        toast.error(result.error);
        setOpen(false);
        setLoading(false);
        return;
      }
      const initialRecipient = result.data.recipient ?? "";
      const initialSubject = result.data.subject;
      setRecipient(initialRecipient);
      setSubject(initialSubject);
      setBody("");
      setInitial({
        recipient: initialRecipient,
        subject: initialSubject,
        body: "",
      });
      setLastSentAt(result.data.last_sent_at);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, kind, id]);

  const dirty =
    initial !== null &&
    (recipient !== initial.recipient ||
      subject !== initial.subject ||
      body !== initial.body);

  const canSubmit =
    !loading &&
    !sending &&
    recipient.length > 0 &&
    subject.length > 0 &&
    subject.length <= 200 &&
    body.length <= 4000;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSending(true);
    const result =
      kind === "invoice"
        ? await sendInvoiceByEmailAction({
            invoice_id: id,
            recipient,
            subject,
            body: body || undefined,
          })
        : await sendReceiptByEmailAction({
            receipt_id: id,
            recipient,
            subject,
            body: body || undefined,
          });
    setSending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Email enviado.");
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {iconOnly ? (
          <Button variant="ghost" size="icon" aria-label="Enviar por email">
            <Mail className="size-4" />
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Mail className="size-4" />
            {label ?? "Enviar por email"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.titleNoun}</DialogTitle>
          <DialogDescription>{copy.descriptionNoun}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span className="ml-2">Cargando…</span>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {lastSentAt && (
              <p className="text-xs text-muted-foreground">
                Último envío exitoso:{" "}
                {new Date(lastSentAt).toLocaleString("es-AR")}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="email-recipient">Destinatario</Label>
              <Input
                id="email-recipient"
                type="email"
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="cliente@ejemplo.com"
                disabled={sending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-subject">Asunto</Label>
              <Input
                id="email-subject"
                required
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email-body">Mensaje (opcional)</Label>
              <Textarea
                id="email-body"
                rows={5}
                maxLength={4000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Si lo dejás vacío se usa el texto por defecto."
                disabled={sending}
              />
              <p className="text-xs text-muted-foreground">
                {body.length}/4000
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={sending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={!canSubmit || !dirty}>
                {sending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  "Enviar"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
