"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  RETENTION_KINDS,
  RETENTION_KIND_LABEL,
  RETENTION_TAX_TYPES,
  RETENTION_TAX_TYPE_LABEL,
  type RetentionKind,
  type RetentionTaxType,
} from "../schema";

export type RetentionDraft = {
  kind: RetentionKind;
  tax_type: RetentionTaxType;
  jurisdiction: string;
  certificate_number: string;
  certificate_date: string;
  amount: string;
  notes: string;
};

export function emptyRetention(today: string): RetentionDraft {
  return {
    kind: "retencion",
    tax_type: "ganancias",
    jurisdiction: "",
    certificate_number: "",
    certificate_date: today,
    amount: "",
    notes: "",
  };
}

export function RetentionsEditor({
  retentions,
  onChange,
  defaultDate,
}: {
  retentions: RetentionDraft[];
  onChange: (next: RetentionDraft[]) => void;
  defaultDate: string;
}) {
  function update(index: number, patch: Partial<RetentionDraft>) {
    onChange(retentions.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }
  function remove(index: number) {
    onChange(retentions.filter((_, i) => i !== index));
  }
  function add() {
    onChange([...retentions, emptyRetention(defaultDate)]);
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Retenciones / Percepciones</Label>
          <p className="text-xs text-muted-foreground">
            Cancelan parte del recibo pero no entran como plata real (crédito
            fiscal).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Agregar
        </Button>
      </div>

      {retentions.length === 0 ? null : (
        <div className="space-y-2">
          {retentions.map((r, idx) => {
            const showJurisdiction = r.tax_type === "iibb";
            return (
              <div
                key={idx}
                className="space-y-2 rounded-md border bg-card p-3"
              >
                <div className="grid items-end gap-2 sm:grid-cols-[140px_140px_1fr_auto]">
                  <div className="space-y-1">
                    <Label className="text-xs">Tipo</Label>
                    <Select
                      value={r.kind}
                      onValueChange={(v) =>
                        update(idx, { kind: v as RetentionKind })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {RETENTION_KINDS.map((k) => (
                          <SelectItem key={k} value={k}>
                            {RETENTION_KIND_LABEL[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Impuesto</Label>
                    <Select
                      value={r.tax_type}
                      onValueChange={(v) =>
                        update(idx, { tax_type: v as RetentionTaxType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {RETENTION_TAX_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {RETENTION_TAX_TYPE_LABEL[t]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nro. de certificado</Label>
                    <Input
                      placeholder="Ej. SICORE-12345"
                      value={r.certificate_number}
                      onChange={(e) =>
                        update(idx, { certificate_number: e.target.value })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(idx)}
                    aria-label="Quitar retención"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                <div className="grid items-end gap-2 sm:grid-cols-[140px_140px_140px_1fr]">
                  <div className="space-y-1">
                    <Label className="text-xs">Fecha cert.</Label>
                    <Input
                      type="date"
                      value={r.certificate_date}
                      onChange={(e) =>
                        update(idx, { certificate_date: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Monto</Label>
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={r.amount}
                      onChange={(e) => update(idx, { amount: e.target.value })}
                    />
                  </div>
                  {showJurisdiction ? (
                    <div className="space-y-1">
                      <Label className="text-xs">Jurisdicción</Label>
                      <Input
                        placeholder="caba, bsas, …"
                        value={r.jurisdiction}
                        onChange={(e) =>
                          update(idx, { jurisdiction: e.target.value })
                        }
                      />
                    </div>
                  ) : (
                    <div />
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Observaciones</Label>
                    <Input
                      placeholder="(opcional)"
                      value={r.notes}
                      onChange={(e) => update(idx, { notes: e.target.value })}
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
