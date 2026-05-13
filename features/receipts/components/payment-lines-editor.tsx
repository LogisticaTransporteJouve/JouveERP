"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmountInput } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCOUNT_TYPE_LABEL,
  isCheckAccount,
  type Account,
} from "@/features/accounts/schema";

export type CheckDraft = {
  bank_name: string;
  drawer_name: string;
  drawer_cuit: string;
  issue_date: string;
  due_date: string;
};

export type PaymentLineDraft = {
  account_id: string;
  amount: string; // input string, parsed on submit
  reference: string;
  check?: CheckDraft;
};

function emptyCheck(today: string): CheckDraft {
  return {
    bank_name: "",
    drawer_name: "",
    drawer_cuit: "",
    issue_date: today,
    due_date: today,
  };
}

export function PaymentLinesEditor({
  accounts,
  lines,
  onChange,
  defaultDate,
}: {
  accounts: Account[];
  lines: PaymentLineDraft[];
  onChange: (next: PaymentLineDraft[]) => void;
  defaultDate: string;
}) {
  function update(index: number, patch: Partial<PaymentLineDraft>) {
    onChange(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function updateCheck(index: number, patch: Partial<CheckDraft>) {
    const line = lines[index];
    if (!line) return;
    const current = line.check ?? emptyCheck(defaultDate);
    onChange(
      lines.map((l, i) =>
        i === index ? { ...l, check: { ...current, ...patch } } : l,
      ),
    );
  }
  function remove(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...lines, { account_id: "", amount: "", reference: "" }]);
  }

  function onAccountChange(idx: number, accountId: string) {
    const account = accounts.find((a) => a.id === accountId);
    const isCheck = isCheckAccount(account?.type);
    const line = lines[idx];
    if (!line) return;
    onChange(
      lines.map((l, i) => {
        if (i !== idx) return l;
        return {
          ...l,
          account_id: accountId,
          check: isCheck ? (l.check ?? emptyCheck(defaultDate)) : undefined,
        };
      }),
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Líneas de pago</Label>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Agregar línea
        </Button>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          Sin líneas todavía. Agregá al menos una para registrar la entrada de plata.
        </div>
      ) : (
        <div className="space-y-2">
          {lines.map((line, idx) => {
            const account = accounts.find((a) => a.id === line.account_id);
            const isCheck = isCheckAccount(account?.type);
            return (
              <div
                key={idx}
                className="space-y-2 rounded-md border bg-card p-3"
              >
                <div className="grid items-end gap-2 sm:grid-cols-[2fr_1fr_1.5fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs">Cuenta</Label>
                    <Select
                      value={line.account_id}
                      onValueChange={(v) => onAccountChange(idx, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elegir cuenta" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {accounts.map((a) => (
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
                      {isCheck
                        ? "Nro de check"
                        : account?.type === "bank"
                          ? "Transferencia"
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

                {isCheck && (
                  <div className="space-y-3 rounded-md border border-dashed border-muted bg-muted/20 p-3">
                    <div className="text-xs font-medium text-muted-foreground">
                      Datos del check
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Fecha de emisión</Label>
                        <Input
                          type="date"
                          value={line.check?.issue_date ?? defaultDate}
                          onChange={(e) =>
                            updateCheck(idx, { issue_date: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Fecha de cobro</Label>
                        <Input
                          type="date"
                          value={line.check?.due_date ?? defaultDate}
                          onChange={(e) =>
                            updateCheck(idx, { due_date: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="text-xs font-normal text-muted-foreground">
                        Datos del firmante (opcional)
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr]">
                        <div className="space-y-1">
                          <Label className="text-xs">Banco</Label>
                          <Input
                            value={line.check?.bank_name ?? ""}
                            onChange={(e) =>
                              updateCheck(idx, { bank_name: e.target.value })
                            }
                            placeholder="Ej. Banco Galicia"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Firmante</Label>
                          <Input
                            value={line.check?.drawer_name ?? ""}
                            onChange={(e) =>
                              updateCheck(idx, { drawer_name: e.target.value })
                            }
                            placeholder="Razón social"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">CUIT firmante</Label>
                          <Input
                            value={line.check?.drawer_cuit ?? ""}
                            onChange={(e) =>
                              updateCheck(idx, { drawer_cuit: e.target.value })
                            }
                            placeholder="30-12345678-9"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
