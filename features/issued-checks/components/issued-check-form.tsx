"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import type { Account } from "@/features/accounts/schema";
import {
  SupplierPicker,
  type PickedSupplier,
} from "@/features/suppliers/components/supplier-picker";

import {
  useCreateIssuedCheck,
  useUpdateIssuedCheck,
} from "../hooks/use-issued-checks";
import {
  ISSUED_CHECK_CURRENCIES,
  ISSUED_CHECK_KINDS,
  ISSUED_CHECK_KIND_LABEL,
  type IssuedCheck,
  type IssuedCheckCurrency,
  type IssuedCheckKind,
} from "../schema";

type Mode = "create" | "edit";

type FormValues = {
  kind: IssuedCheckKind;
  check_number: string;
  bank_name: string;
  beneficiary_name: string;
  beneficiary_cuit: string;
  issue_date: string;
  due_date: string;
  amount: string;
  currency: IssuedCheckCurrency;
  bank_account_id: string;
  supplier: PickedSupplier | null;
  notes: string;
};

function todayIso() {
  const d = new Date();
  const ar = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return ar.toISOString().slice(0, 10);
}

function toValues(
  c: IssuedCheck | undefined,
  defaultAccountId: string,
  prefill?: PickedSupplier | null,
): FormValues {
  return {
    kind: c?.kind ?? "fisico",
    check_number: c?.check_number ?? "",
    bank_name: c?.bank_name ?? "",
    beneficiary_name: c?.beneficiary_name ?? "",
    beneficiary_cuit: c?.beneficiary_cuit ?? "",
    issue_date: c?.issue_date ?? todayIso(),
    due_date: c?.due_date ?? todayIso(),
    amount: c ? String(c.amount) : "",
    currency: c?.currency ?? "ARS",
    bank_account_id: c?.bank_account_id ?? defaultAccountId,
    supplier: prefill ?? null,
    notes: c?.notes ?? "",
  };
}

export function IssuedCheckForm({
  mode,
  check,
  accounts,
  initialSupplier,
  onSuccess,
  onCancel,
}: {
  mode: Mode;
  check?: IssuedCheck;
  accounts: Account[];
  initialSupplier?: PickedSupplier | null;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}) {
  const createMut = useCreateIssuedCheck();
  const updateMut = useUpdateIssuedCheck();
  const isSaving = createMut.isPending || updateMut.isPending;

  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank",
  );
  const defaultAccountId = check?.bank_account_id ?? bankAccounts[0]?.id ?? "";

  const [values, setValues] = useState<FormValues>(
    toValues(check, defaultAccountId, initialSupplier),
  );

  function set<K extends keyof FormValues>(key: K, val: FormValues[K]) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.bank_account_id) {
      toast.error("Seleccioná una cuenta bancaria.");
      return;
    }

    const payload = {
      kind: values.kind,
      check_number: values.check_number.trim(),
      bank_name: values.bank_name.trim(),
      beneficiary_name: values.beneficiary_name.trim() || null,
      beneficiary_cuit: values.beneficiary_cuit.trim() || null,
      issue_date: values.issue_date,
      due_date: values.due_date,
      amount: values.amount,
      currency: values.currency,
      bank_account_id: values.bank_account_id,
      supplier_id: values.supplier?.id ?? null,
      notes: values.notes.trim() || null,
    };

    if (mode === "create") {
      createMut.mutate(payload, {
        onSuccess: (data) => {
          toast.success("Cheque cargado.");
          if (onSuccess) onSuccess(data.id);
        },
        onError: (err) => toast.error(err.message),
      });
    } else if (check) {
      updateMut.mutate(
        { id: check.id, ...payload },
        {
          onSuccess: () => {
            toast.success("Cheque actualizado.");
            if (onSuccess) onSuccess(check.id);
          },
          onError: (err) => toast.error(err.message),
        },
      );
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select
            value={values.kind}
            onValueChange={(v) => set("kind", v as IssuedCheckKind)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISSUED_CHECK_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {ISSUED_CHECK_KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Número</Label>
          <Input
            value={values.check_number}
            onChange={(e) => set("check_number", e.target.value)}
            placeholder="12345678"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Banco</Label>
          <Input
            value={values.bank_name}
            onChange={(e) => set("bank_name", e.target.value)}
            placeholder="Banco Galicia"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Cuenta bancaria (chequera)</Label>
        <Select
          value={values.bank_account_id}
          onValueChange={(v) => set("bank_account_id", v)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Elegir cuenta" />
          </SelectTrigger>
          <SelectContent>
            {bankAccounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Fecha de emisión</Label>
          <DatePicker
            value={values.issue_date}
            onChange={(v) => set("issue_date", v)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Fecha de cobro</Label>
          <DatePicker
            value={values.due_date}
            onChange={(v) => set("due_date", v)}
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="space-y-1">
          <Label className="text-xs">Monto</Label>
          <Input
            value={values.amount}
            onChange={(e) => set("amount", e.target.value)}
            type="number"
            inputMode="decimal"
            step="0.01"
            placeholder="0,00"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Moneda</Label>
          <Select
            value={values.currency}
            onValueChange={(v) => set("currency", v as IssuedCheckCurrency)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ISSUED_CHECK_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Beneficiario (proveedor)</Label>
        <SupplierPicker
          value={values.supplier}
          onChange={(v) => set("supplier", v)}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Nombre del beneficiario (opcional)</Label>
          <Input
            value={values.beneficiary_name}
            onChange={(e) => set("beneficiary_name", e.target.value)}
            placeholder="Si difiere del proveedor"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">CUIT beneficiario (opcional)</Label>
          <Input
            value={values.beneficiary_cuit}
            onChange={(e) => set("beneficiary_cuit", e.target.value)}
            placeholder="30-12345678-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Notas</Label>
        <Textarea
          rows={2}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => onCancel?.()}
          disabled={isSaving}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving
            ? "Guardando…"
            : mode === "create"
              ? "Cargar cheque"
              : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
