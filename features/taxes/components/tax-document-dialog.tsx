"use client";

import { Calculator, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentsZone } from "@/features/files/components/attachments-zone";
import { formatMoney, formatPeriod, todayInAR } from "@/lib/format";

import {
  useCreateTaxDocument,
  useIvaEstimate,
  useTaxAccountOptions,
  useUpdateTaxDocument,
} from "../hooks/use-tax-documents";
import {
  TAX_KIND_DEFAULT_ROLE,
  TAX_KIND_LABEL,
  TAX_KINDS,
  isOpenTaxStatus,
  isTaxKind,
  previousPeriod,
  type IvaPositionEstimate,
  type TaxDocument,
  type TaxKind,
} from "../schema";

const NO_ACCOUNT = "__none__";

type FormState = {
  kind: TaxKind;
  title: string;
  jurisdiction: string;
  period: string;
  due_date: string;
  amount: string;
  amount_is_estimate: boolean;
  account_id: string;
  notes: string;
};

function initialState(doc: TaxDocument | null): FormState {
  if (doc) {
    return {
      kind: doc.kind,
      title: doc.title ?? "",
      jurisdiction: doc.jurisdiction ?? "",
      period: doc.period,
      due_date: doc.due_date,
      amount: doc.amount === null ? "" : String(doc.amount),
      amount_is_estimate: doc.amount_is_estimate,
      account_id: doc.account_id ?? NO_ACCOUNT,
      notes: doc.notes ?? "",
    };
  }
  // A month's taxes are declared the month after: default to last month.
  return {
    kind: "iva",
    title: "",
    jurisdiction: "",
    period: previousPeriod(todayInAR().slice(0, 7)),
    due_date: todayInAR(),
    amount: "",
    amount_is_estimate: false,
    account_id: NO_ACCOUNT,
    notes: "",
  };
}

export function TaxDocumentDialog({
  open,
  onOpenChange,
  doc,
  canAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new document. */
  doc: TaxDocument | null;
  canAttach: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(doc));
  const [estimate, setEstimate] = useState<IvaPositionEstimate | null>(null);
  const accounts = useTaxAccountOptions(open);
  const createMut = useCreateTaxDocument();
  const updateMut = useUpdateTaxDocument();
  const estimateMut = useIvaEstimate();
  const pending = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (open) {
      setForm(initialState(doc));
      setEstimate(null);
    }
  }, [open, doc]);

  // A new document takes the kind's usual account when the plan has it.
  useEffect(() => {
    if (doc || form.account_id !== NO_ACCOUNT || !accounts.data) return;
    const role = TAX_KIND_DEFAULT_ROLE[form.kind];
    const match = role
      ? accounts.data.find((a) => a.system_role === role)
      : undefined;
    if (match) setForm((f) => ({ ...f, account_id: match.id }));
  }, [doc, form.kind, form.account_id, accounts.data]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function runEstimate() {
    estimateMut.mutate(form.period, {
      onSuccess: (result) => {
        setEstimate(result);
        if (result.saldo > 0) {
          setForm((f) => ({
            ...f,
            amount: String(result.saldo),
            amount_is_estimate: true,
          }));
        } else {
          toast.info(
            "El libro IVA da saldo a favor: no hay importe a pagar estimado.",
          );
        }
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function onSubmit() {
    const amount = form.amount.trim() === "" ? null : Number(form.amount);
    if (amount !== null && !Number.isFinite(amount)) {
      toast.error("Importe inválido.");
      return;
    }
    const payload = {
      kind: form.kind,
      title: form.title,
      jurisdiction: form.kind === "iibb" ? form.jurisdiction : "",
      period: form.period,
      due_date: form.due_date,
      amount,
      amount_is_estimate: amount !== null && form.amount_is_estimate,
      account_id: form.account_id === NO_ACCOUNT ? null : form.account_id,
      notes: form.notes,
    };
    const onError = (err: Error) => toast.error(err.message);
    if (doc) {
      updateMut.mutate(
        { ...payload, id: doc.id },
        {
          onSuccess: () => {
            toast.success("Impuesto guardado.");
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      createMut.mutate(payload, {
        onSuccess: () => {
          toast.success("Impuesto cargado.");
          onOpenChange(false);
        },
        onError,
      });
    }
  }

  // A paid document only takes notes (guard_tax_document).
  const readOnly = doc !== null && !isOpenTaxStatus(doc.status);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {doc ? "Editar impuesto" : "Nuevo impuesto"}
          </DialogTitle>
          <DialogDescription>
            Cada impuesto es un documento: período, vencimiento, importe y
            estado. El pago se registra después con “Pagar”.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tax-kind">Tipo</Label>
              <Select
                value={form.kind}
                onValueChange={(v) => {
                  if (isTaxKind(v)) set("kind", v);
                }}
                disabled={readOnly}
              >
                <SelectTrigger id="tax-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAX_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {TAX_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tax-title">
                {form.kind === "otro" ? "Nombre" : "Detalle (opcional)"}
              </Label>
              <Input
                id="tax-title"
                value={form.title}
                maxLength={120}
                placeholder={
                  form.kind === "otro"
                    ? "Bienes personales, tasa municipal…"
                    : ""
                }
                disabled={readOnly}
                onChange={(e) => set("title", e.target.value)}
              />
            </div>
          </div>

          {form.kind === "iibb" && (
            <div className="space-y-1">
              <Label htmlFor="tax-jurisdiction">Jurisdicción</Label>
              <Input
                id="tax-jurisdiction"
                value={form.jurisdiction}
                maxLength={60}
                placeholder="Buenos Aires, CABA, Convenio Multilateral…"
                disabled={readOnly}
                onChange={(e) => set("jurisdiction", e.target.value)}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tax-period">Período</Label>
              <Input
                id="tax-period"
                type="month"
                value={form.period}
                disabled={readOnly}
                onChange={(e) => {
                  set("period", e.target.value);
                  setEstimate(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tax-due">Vencimiento</Label>
              <Input
                id="tax-due"
                type="date"
                value={form.due_date}
                disabled={readOnly}
                onChange={(e) => set("due_date", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-amount">Importe</Label>
            <div className="flex gap-2">
              <Input
                id="tax-amount"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.amount}
                placeholder="Sin liquidar"
                disabled={readOnly}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    amount: e.target.value,
                    amount_is_estimate: false,
                  }))
                }
              />
              {form.kind === "iva" && !readOnly && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={runEstimate}
                  disabled={estimateMut.isPending || !form.period}
                >
                  {estimateMut.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Calculator />
                  )}
                  Estimar
                </Button>
              )}
            </div>
            {form.amount_is_estimate && (
              <p className="text-muted-foreground text-xs">
                Estimado desde el libro IVA. Revisalo contra la DDJJ antes de
                liquidar.
              </p>
            )}
            {estimate && (
              <div className="bg-muted/50 space-y-1 rounded-md border p-3 text-xs">
                <p className="font-medium">
                  Posición estimada de {formatPeriod(estimate.period)}
                </p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 tabular-nums">
                  <dt>IVA débito ({estimate.ventas} comprobantes)</dt>
                  <dd className="text-right font-mono">
                    {formatMoney(estimate.debito)}
                  </dd>
                  <dt>IVA crédito ({estimate.compras} comprobantes)</dt>
                  <dd className="text-right font-mono">
                    − {formatMoney(estimate.credito)}
                  </dd>
                  <dt>Retenciones y percepciones de IVA sufridas</dt>
                  <dd className="text-right font-mono">
                    − {formatMoney(estimate.retenciones)}
                  </dd>
                  <dt className="font-medium">
                    {estimate.saldo >= 0 ? "A pagar" : "Saldo a favor"}
                  </dt>
                  <dd className="text-right font-mono font-medium">
                    {formatMoney(Math.abs(estimate.saldo))}
                  </dd>
                </dl>
                <p className="text-muted-foreground">
                  No descuenta las percepciones de IVA de las compras (el libro
                  las suma con las de IIBB) ni el saldo a favor del mes
                  anterior: restalos a mano si corresponde.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-account">Cuenta contable del pago</Label>
            <Select
              value={form.account_id}
              onValueChange={(v) => set("account_id", v)}
              disabled={readOnly}
            >
              <SelectTrigger id="tax-account">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ACCOUNT}>Elegir después</SelectItem>
                {(accounts.data ?? []).map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              El pago debita esta cuenta (la deuda fiscal o el gasto) contra la
              caja o el banco. Hace falta para pagar.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-notes">Notas</Label>
            <Textarea
              id="tax-notes"
              value={form.notes}
              maxLength={1000}
              rows={2}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          {doc && canAttach && (
            <div className="space-y-1">
              <Label>VEP, DDJJ y comprobantes</Label>
              <AttachmentsZone
                targetType="tax_document"
                targetId={doc.id}
                canWrite
                canDelete
              />
            </div>
          )}
          {!doc && canAttach && (
            <p className="text-muted-foreground text-xs">
              Guardalo para adjuntar el VEP o la DDJJ.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={onSubmit} disabled={pending}>
            {doc ? "Guardar" : "Cargar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
