"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useAccountsList } from "@/features/accounts/hooks/use-accounts";

import { useCreateChecksFromExtraction } from "../hooks/use-documents";
import { ChequeBatchExtractionSchema } from "../schemas";

type Row = {
  banco: string;
  serie: string;
  numero: string;
  librador: string;
  librador_cuit: string;
  importe: string;
  fecha: string;
  fecha_pago: string;
  moneda: "ARS" | "USD";
};

function toRows(payload: unknown): Row[] {
  const parsed = ChequeBatchExtractionSchema.safeParse(payload);
  if (!parsed.success) return [];
  return parsed.data.cheques.map((c) => ({
    banco: c.banco ?? "",
    serie: c.serie ?? "",
    numero: c.numero ?? "",
    librador: c.librador ?? c.beneficiario ?? "",
    librador_cuit: c.librador_cuit ?? "",
    importe: c.importe != null ? String(c.importe) : "",
    fecha: c.fecha ?? "",
    fecha_pago: c.fecha_pago ?? c.fecha ?? "",
    moneda: c.moneda === "USD" ? "USD" : "ARS",
  }));
}

export function CreateChequesDialog({
  extractionId,
  payload,
  open,
  onOpenChange,
  onCreated,
}: {
  extractionId: string;
  payload: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { data: accounts } = useAccountsList();
  const carteraOptions = useMemo(
    () =>
      accounts.filter(
        (a) => a.is_active && (a.type === "checks" || a.type === "echeq"),
      ),
    [accounts],
  );
  const createMut = useCreateChecksFromExtraction();

  const [rows, setRows] = useState<Row[]>([]);
  const [kind, setKind] = useState<"fisico" | "echeq">("fisico");
  const [carteraId, setCarteraId] = useState("");

  useEffect(() => {
    if (open) {
      setRows(toRows(payload));
      setKind("fisico");
      setCarteraId("");
    }
  }, [open, payload]);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function onSubmit() {
    if (!carteraId) {
      toast.error("Elegí la cuenta de cartera.");
      return;
    }
    createMut.mutate(
      {
        extractionId,
        cartera_account_id: carteraId,
        kind,
        cheques: rows.map((r) => ({
          banco: r.banco || null,
          serie: r.serie || null,
          numero: r.numero || null,
          librador: r.librador || null,
          librador_cuit: r.librador_cuit || null,
          importe: r.importe ? Number(r.importe) : null,
          fecha: r.fecha || null,
          fecha_pago: r.fecha_pago || null,
          moneda: r.moneda,
        })),
      },
      {
        onSuccess: (data) => {
          if (data.created > 0) {
            toast.success(`${data.created} cheque(s) creados en cartera.`);
          }
          if (data.errors.length > 0) {
            toast.error(
              `${data.errors.length} cheque(s) no se pudieron crear (revisá los datos).`,
            );
          }
          if (data.created > 0) onCreated();
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Crear cheques en cartera</DialogTitle>
          <DialogDescription>
            Revisá y corregí cada cheque, elegí la cuenta de cartera y creá los{" "}
            {rows.length}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="chq-cartera">Cuenta de cartera</Label>
            <Select value={carteraId} onValueChange={setCarteraId}>
              <SelectTrigger id="chq-cartera">
                <SelectValue placeholder="Elegí la cuenta" />
              </SelectTrigger>
              <SelectContent>
                {carteraOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="chq-kind">Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v === "echeq" ? "echeq" : "fisico")}
            >
              <SelectTrigger id="chq-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fisico">Físico</SelectItem>
                <SelectItem value="echeq">E-cheq</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1">
          {rows.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <div className="text-muted-foreground text-xs font-medium">
                Cheque {i + 1}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Field label="Banco">
                  <Input
                    value={r.banco}
                    onChange={(e) => update(i, { banco: e.target.value })}
                  />
                </Field>
                <Field label="Serie">
                  <Input
                    value={r.serie}
                    onChange={(e) => update(i, { serie: e.target.value })}
                  />
                </Field>
                <Field label="Número">
                  <Input
                    value={r.numero}
                    onChange={(e) => update(i, { numero: e.target.value })}
                  />
                </Field>
                <Field label="Librador">
                  <Input
                    value={r.librador}
                    onChange={(e) => update(i, { librador: e.target.value })}
                  />
                </Field>
                <Field label="CUIT librador">
                  <Input
                    value={r.librador_cuit}
                    onChange={(e) =>
                      update(i, { librador_cuit: e.target.value })
                    }
                  />
                </Field>
                <Field label="Importe">
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={r.importe}
                    onChange={(e) => update(i, { importe: e.target.value })}
                  />
                </Field>
                <Field label="Emisión">
                  <Input
                    type="date"
                    value={r.fecha}
                    onChange={(e) => update(i, { fecha: e.target.value })}
                  />
                </Field>
                <Field label="Pago / vto">
                  <Input
                    type="date"
                    value={r.fecha_pago}
                    onChange={(e) => update(i, { fecha_pago: e.target.value })}
                  />
                </Field>
                <Field label="Moneda">
                  <Select
                    value={r.moneda}
                    onValueChange={(v) =>
                      update(i, { moneda: v === "USD" ? "USD" : "ARS" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ARS">ARS</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-muted-foreground text-sm">
              No se detectaron cheques en el documento.
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
          <Button
            type="button"
            onClick={onSubmit}
            disabled={
              createMut.isPending || rows.length === 0 || !carteraId
            }
          >
            Crear {rows.length} cheque{rows.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
