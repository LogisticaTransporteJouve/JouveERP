"use client";

import { BookCheck, Plus, Trash2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCOUNT_TYPE_LABEL,
  type Account,
} from "@/features/accounts/schema";
import type { EnCarteraCheck } from "@/features/checks/actions/checks-actions";
import { formatAmountInput, formatArgentineDate } from "@/lib/format";

export type AccountLineDraft = {
  line_kind: "account";
  account_id: string;
  amount: string;
  reference: string;
};

export type EndorseLineDraft = {
  line_kind: "endorse_check";
  endorsed_check_id: string;
  check_label: string;
  amount: number;
  cartera_account_id: string;
  cartera_account_name: string;
  reference: string;
};

export type IssueLineDraft = {
  line_kind: "issue_check";
  account_id: string;
  amount: string;
  reference: string;
  check_kind: "fisico" | "echeq";
  check_number: string;
  bank_name: string;
  due_date: string;
  beneficiary_name: string;
  beneficiary_cuit: string;
};

export type PaymentLineDraft =
  | AccountLineDraft
  | EndorseLineDraft
  | IssueLineDraft;

const moneyFmt = new Intl.NumberFormat("es-AR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function PaymentLinesEditor({
  accounts,
  carteraChecks,
  carteraChecksLoading,
  currency,
  lines,
  onChange,
  disableNonAccount,
}: {
  accounts: Account[];
  carteraChecks: EnCarteraCheck[];
  carteraChecksLoading: boolean;
  currency: "ARS" | "USD";
  lines: PaymentLineDraft[];
  onChange: (next: PaymentLineDraft[]) => void;
  disableNonAccount?: boolean;
}) {
  function update(index: number, patch: Partial<PaymentLineDraft>) {
    onChange(
      lines.map((l, i) =>
        i === index ? ({ ...l, ...patch } as PaymentLineDraft) : l,
      ),
    );
  }
  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function addAccount() {
    onChange([
      ...lines,
      { line_kind: "account", account_id: "", amount: "", reference: "" },
    ]);
  }
  function addIssue() {
    onChange([
      ...lines,
      {
        line_kind: "issue_check",
        account_id: "",
        amount: "",
        reference: "",
        check_kind: "fisico",
        check_number: "",
        bank_name: "",
        due_date: "",
        beneficiary_name: "",
        beneficiary_cuit: "",
      },
    ]);
  }
  function addEndorse(check: EnCarteraCheck) {
    const label =
      `${check.kind === "echeq" ? "ECHEQ" : "Cheque"} ${check.bank_name} #${check.check_number} ` +
      `· vto ${formatArgentineDate(check.due_date)}`;
    onChange([
      ...lines,
      {
        line_kind: "endorse_check",
        endorsed_check_id: check.id,
        check_label: label,
        amount: check.amount,
        cartera_account_id: check.cartera_account_id,
        cartera_account_name: check.cartera_account_name,
        reference: "",
      },
    ]);
  }

  const usedCheckIds = new Set(
    lines
      .filter((l): l is EndorseLineDraft => l.line_kind === "endorse_check")
      .map((l) => l.endorsed_check_id),
  );
  const availableChecks = carteraChecks.filter(
    (c) => !usedCheckIds.has(c.id) && c.currency === currency,
  );

  const bankAccounts = accounts.filter(
    (a) => a.is_active && a.type === "bank" && a.currency === currency,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Medios de pago</Label>
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={addAccount}>
            <Plus className="size-3.5" />
            Cuenta
          </Button>
          {!disableNonAccount && (
            <>
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm">
                    <BookCheck className="size-3.5" />
                    Endosar cheque
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                  <div className="border-b px-3 py-2 text-xs text-muted-foreground">
                    Cheques en cartera ({currency})
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {carteraChecksLoading ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        Cargando…
                      </div>
                    ) : availableChecks.length === 0 ? (
                      <div className="p-3 text-sm text-muted-foreground">
                        No hay cheques disponibles en {currency}.
                      </div>
                    ) : (
                      availableChecks.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => addEndorse(c)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <span className="min-w-0">
                            <span className="font-medium">
                              {c.kind === "echeq" ? "ECHEQ" : "Físico"} ·{" "}
                              {c.bank_name}
                            </span>
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              #{c.check_number}
                            </span>
                            <div className="truncate text-xs text-muted-foreground">
                              {c.drawer_name} · vto{" "}
                              {formatArgentineDate(c.due_date)}
                            </div>
                          </span>
                          <span className="shrink-0 font-mono text-sm">
                            {c.currency} {moneyFmt.format(c.amount)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <Button type="button" variant="outline" size="sm" onClick={addIssue}>
                <Wallet className="size-3.5" />
                Emitir cheque
              </Button>
            </>
          )}
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Sin líneas todavía. Agregá una cuenta, endosá un cheque en cartera o
          emití un cheque propio.
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((line, idx) => {
            if (line.line_kind === "account") {
              const account = accounts.find((a) => a.id === line.account_id);
              return (
                <div
                  key={idx}
                  className="grid items-end gap-2 rounded-md border bg-card p-3 sm:grid-cols-[2fr_1fr_1.5fr_auto]"
                >
                  <div className="space-y-1">
                    <Label className="text-xs">Cuenta</Label>
                    <Select
                      value={line.account_id}
                      onValueChange={(v) => update(idx, { account_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir cuenta" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {accounts
                          .filter((a) => a.is_active && a.currency === currency)
                          .map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.name}{" "}
                              <span className="text-xs text-muted-foreground">
                                · {ACCOUNT_TYPE_LABEL[a.type]} · {a.currency}
                              </span>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monto</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={line.amount}
                      onChange={(e) =>
                        update(idx, {
                          amount: formatAmountInput(e.target.value),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">
                      {account?.type === "bank"
                        ? "Transferencia / nro mov"
                        : "Referencia (opcional)"}
                    </Label>
                    <Input
                      value={line.reference}
                      onChange={(e) =>
                        update(idx, { reference: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(idx)}
                    aria-label="Quitar línea"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              );
            }

            if (line.line_kind === "endorse_check") {
              return (
                <div
                  key={idx}
                  className="flex items-start justify-between gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3"
                >
                  <div className="min-w-0 space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <BookCheck className="size-4 text-blue-600 dark:text-blue-400" />
                      <span className="font-medium">Endoso de cheque</span>
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {line.check_label}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Cartera: {line.cartera_account_name}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Monto</div>
                      <div className="font-mono text-sm font-semibold">
                        {currency} {moneyFmt.format(line.amount)}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(idx)}
                      aria-label="Quitar línea"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              );
            }

            // issue_check
            return (
              <div
                key={idx}
                className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Wallet className="size-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium">Emitir cheque propio</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(idx)}
                    aria-label="Quitar línea"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={line.check_kind}
                      onValueChange={(v) =>
                        update(idx, { check_kind: v as "fisico" | "echeq" })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="fisico">Físico</SelectItem>
                        <SelectItem value="echeq">ECHEQ</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Chequera (cuenta bancaria)</Label>
                    <Select
                      value={line.account_id}
                      onValueChange={(v) => update(idx, { account_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir banco" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {bankAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Banco</Label>
                    <Input
                      value={line.bank_name}
                      onChange={(e) =>
                        update(idx, { bank_name: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nº cheque</Label>
                    <Input
                      value={line.check_number}
                      onChange={(e) =>
                        update(idx, { check_number: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Fecha de vto.</Label>
                    <DatePicker
                      value={line.due_date}
                      onChange={(v) => update(idx, { due_date: v })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monto</Label>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={line.amount}
                      onChange={(e) =>
                        update(idx, {
                          amount: formatAmountInput(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
