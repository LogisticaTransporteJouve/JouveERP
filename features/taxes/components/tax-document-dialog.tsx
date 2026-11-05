"use client";

import { Calculator, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MoneyInput } from "@/components/money-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { MonthPicker } from "@/components/ui/month-picker";
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
import {
  amountToInput,
  formatMoney,
  formatPeriod,
  parseArAmount,
  todayInAR,
} from "@/lib/format";

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
  credit_balance: string;
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
      amount: doc.amount === null ? "" : amountToInput(doc.amount),
      amount_is_estimate: doc.amount_is_estimate,
      account_id: doc.account_id ?? NO_ACCOUNT,
      credit_balance:
        doc.credit_balance === null ? "" : amountToInput(doc.credit_balance),
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
    credit_balance: "",
    notes: "",
  };
}

export function TaxDocumentDialog({
  open,
  onOpenChange,
  doc,
  canAttach,
  canEstimate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = new document. */
  doc: TaxDocument | null;
  canAttach: boolean;
  /** Estimar reads the libro IVA: it takes accounting:read. */
  canEstimate: boolean;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(doc));
  const [estimate, setEstimate] = useState<IvaPositionEstimate | null>(null);
  const accounts = useTaxAccountOptions(open);
  const createMut = useCreateTaxDocument();
  const updateMut = useUpdateTaxDocument();
  const estimateMut = useIvaEstimate();
  const resetEstimate = estimateMut.reset;
  const pending = createMut.isPending || updateMut.isPending;

  // What an Estimar answer belongs to. The dialog stays mounted: an answer
  // that comes back after the document, the period or the kind changed (or
  // the dialog was closed) is dropped, not written into another form.
  const estimateFor = `${doc?.id ?? "new"}|${form.kind}|${form.period}`;
  const estimateTarget = useRef({ key: estimateFor, epoch: 0 });
  useEffect(() => {
    estimateTarget.current.key = estimateFor;
  }, [estimateFor]);

  useEffect(() => {
    if (open) {
      setForm(initialState(doc));
      setEstimate(null);
    }
    estimateTarget.current.epoch += 1;
    resetEstimate();
  }, [open, doc, resetEstimate]);

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
    const asked = { key: estimateFor, epoch: estimateTarget.current.epoch };
    const stillAsked = () =>
      estimateTarget.current.key === asked.key &&
      estimateTarget.current.epoch === asked.epoch;
    estimateMut.mutate(form.period, {
      onSuccess: (result) => {
        if (!stillAsked()) return;
        setEstimate(result);
        if (result.saldo > 0) {
          setForm((f) => ({
            ...f,
            amount: amountToInput(result.saldo),
            amount_is_estimate: true,
          }));
        } else {
          toast.info(
            "El libro IVA da saldo a favor: no hay importe a pagar estimado. Cargá el saldo a favor de la DDJJ para el mes siguiente.",
          );
        }
      },
      onError: (err) => {
        if (stillAsked()) toast.error(err.message);
      },
    });
  }

  function onSubmit() {
    const amount =
      form.amount.trim() === "" ? null : parseArAmount(form.amount);
    if (amount === null && form.amount.trim() !== "") {
      toast.error("Importe inválido.");
      return;
    }
    const creditBalance =
      form.kind !== "iva" || form.credit_balance.trim() === ""
        ? null
        : parseArAmount(form.credit_balance);
    if (
      creditBalance === null &&
      form.kind === "iva" &&
      form.credit_balance.trim() !== ""
    ) {
      toast.error("Saldo a favor inválido.");
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
      credit_balance: creditBalance,
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
              <MonthPicker
                id="tax-period"
                value={form.period}
                disabled={readOnly}
                onChange={(value) => {
                  set("period", value);
                  setEstimate(null);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tax-due">Vencimiento</Label>
              <DatePicker
                id="tax-due"
                value={form.due_date}
                disabled={readOnly}
                onChange={(value) => set("due_date", value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-amount">Importe</Label>
            <div className="flex gap-2">
              <MoneyInput
                id="tax-amount"
                value={form.amount}
                placeholder="Sin liquidar"
                disabled={readOnly}
                onChange={(amount) =>
                  setForm((f) => ({ ...f, amount, amount_is_estimate: false }))
                }
              />
              {form.kind === "iva" && !readOnly && canEstimate && (
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
                  <dt>
                    Saldo a favor de{" "}
                    {formatPeriod(previousPeriod(estimate.period))}
                  </dt>
                  <dd className="text-right font-mono">
                    − {formatMoney(estimate.saldo_anterior)}
                  </dd>
                  <dt className="font-medium">
                    {estimate.saldo >= 0 ? "A pagar" : "Saldo a favor"}
                  </dt>
                  <dd className="text-right font-mono font-medium">
                    {formatMoney(Math.abs(estimate.saldo))}
                  </dd>
                </dl>
                {!estimate.saldo_anterior_known && (
                  <p className="text-muted-foreground">
                    No hay IVA cargado de{" "}
                    {formatPeriod(previousPeriod(estimate.period))}: si la DDJJ
                    dejó saldo a favor, restalo a mano.
                  </p>
                )}
                {estimate.percepciones_compras !== 0 && (
                  <p className="text-muted-foreground">
                    Se restan {formatMoney(estimate.percepciones_compras)} de
                    percepciones de IVA de las compras.
                  </p>
                )}
                {estimate.tributos_compras !== 0 && (
                  <p className="text-muted-foreground">
                    Las compras tienen además{" "}
                    {formatMoney(estimate.tributos_compras)} de otros tributos
                    que no se restan (IIBB, Ganancias y otros nacionales,
                    municipales, internos y los que no se repartieron): si
                    alguno es percepción de IVA, repartilo en la compra.
                  </p>
                )}
              </div>
            )}
          </div>

          {form.kind === "iva" && (
            <div className="space-y-1">
              <Label htmlFor="tax-credit-balance">
                Saldo a favor técnico para el mes siguiente
              </Label>
              <MoneyInput
                id="tax-credit-balance"
                value={form.credit_balance}
                placeholder="Sin saldo a favor"
                disabled={readOnly}
                onChange={(v) => set("credit_balance", v)}
              />
              <p className="text-muted-foreground text-xs">
                El que deja la DDJJ de este período. El estimado del mes
                siguiente lo descuenta. Si no hay nada que pagar, cargalo y
                después anulá el impuesto.
              </p>
            </div>
          )}

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
