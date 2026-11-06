"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate, formatMoney, formatNumber2 } from "@/lib/format";

import type { FuelImportPreview } from "../actions/fuel-import-actions";
import { useConfirmFuelImport, usePreviewFuelImport } from "../hooks/use-fuel";
import {
  FUEL_IMPORT_FIELD_LABELS,
  FUEL_IMPORT_FIELDS,
  FUEL_IMPORT_PROVIDER_LABELS,
  FUEL_IMPORT_PROVIDERS,
  type FuelImportField,
  type FuelImportMapping,
  type FuelImportProvider,
  type FuelImportRow,
  type FuelImportStatus,
} from "../lib/import";

const NONE = "__none__";

const STATUS_LABELS: Record<FuelImportStatus, string> = {
  ready: "Lista",
  duplicate: "Duplicada",
  no_vehicle: "Sin vehículo",
  invalid: "Con error",
};

function isProvider(value: string): value is FuelImportProvider {
  return (FUEL_IMPORT_PROVIDERS as readonly string[]).includes(value);
}

/** Rows the user may import: ready ones, and duplicates kept on purpose. */
function selectable(row: FuelImportRow): boolean {
  return row.status === "ready" || row.status === "duplicate";
}

export function FuelImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const previewMut = usePreviewFuelImport();
  const confirmMut = useConfirmFuelImport();
  const [provider, setProvider] = useState<FuelImportProvider>("ypf_en_ruta");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<FuelImportPreview | null>(null);
  const [mapping, setMapping] = useState<FuelImportMapping | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  // One per statement read: a double click or retry of the same import is
  // added once (the server skips rows whose import key exists).
  const [importKey, setImportKey] = useState("");

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(null);
    setSelected(new Set());
  }

  function read(withMapping: FuelImportMapping | null) {
    if (!file) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("provider", provider);
    if (withMapping) formData.set("mapping", JSON.stringify(withMapping));
    previewMut.mutate(formData, {
      onSuccess: (data) => {
        setPreview(data);
        setImportKey(crypto.randomUUID());
        setMapping(data.mapping);
        setSelected(
          new Set(
            data.rows.filter((r) => r.status === "ready").map((r) => r.line),
          ),
        );
      },
      onError: (err) => {
        setPreview(null);
        toast.error(err.message);
      },
    });
  }

  const counts = useMemo(() => {
    const out: Record<FuelImportStatus, number> = {
      ready: 0,
      duplicate: 0,
      no_vehicle: 0,
      invalid: 0,
    };
    for (const r of preview?.rows ?? []) out[r.status] += 1;
    return out;
  }, [preview]);

  const chosen = (preview?.rows ?? []).filter(
    (r) => selectable(r) && selected.has(r.line),
  );

  function confirm() {
    const rows = chosen.flatMap((r) =>
      r.vehicle_id && r.load_date && r.liters !== null && r.amount !== null
        ? [
            {
              vehicle_id: r.vehicle_id,
              load_date: r.load_date,
              liters: r.liters,
              amount: r.amount,
              odometer_km: r.odometer_km,
              station: r.station,
              card: r.card,
              product: r.product,
              allow_duplicate: r.status === "duplicate",
            },
          ]
        : [],
    );
    confirmMut.mutate(
      { provider, import_key: importKey, rows },
      {
        onSuccess: ({ inserted, skipped }) => {
          toast.success(
            skipped > 0
              ? `Se importaron ${inserted} cargas; ${skipped} ya estaban cargadas.`
              : `Se importaron ${inserted} cargas.`,
          );
          reset();
          onOpenChange(false);
        },
        onError: (err) => toast.error(err.message),
      },
    );
  }

  function setColumn(field: FuelImportField, value: string) {
    const next: FuelImportMapping = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = Number(value);
    setMapping(next);
  }

  const busy = previewMut.isPending || confirmMut.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Importar resumen de combustible</DialogTitle>
          <DialogDescription>
            Subí el resumen de la tarjeta (.xlsx o .csv). Cada fila se asigna a
            un vehículo por patente o por número de tarjeta; nada se guarda
            hasta que confirmes.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="fuel-import-provider">Tarjeta</Label>
            <Select
              value={provider}
              onValueChange={(v) => {
                if (isProvider(v)) setProvider(v);
                setPreview(null);
                setMapping(null);
              }}
            >
              <SelectTrigger id="fuel-import-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FUEL_IMPORT_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {FUEL_IMPORT_PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fuel-import-file">Archivo</Label>
            <Input
              id="fuel-import-file"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setMapping(null);
              }}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!file || busy}
            onClick={() => read(null)}
          >
            {previewMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileUp className="size-4" />
            )}
            Leer archivo
          </Button>
        </div>

        {preview && mapping && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Columnas</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FUEL_IMPORT_FIELDS.map((field) => (
                <div key={field} className="min-w-0 space-y-1">
                  <Label
                    htmlFor={`fuel-import-col-${field}`}
                    className="text-xs"
                  >
                    {FUEL_IMPORT_FIELD_LABELS[field]}
                    {preview.missing.includes(field) && " (falta)"}
                  </Label>
                  <Select
                    value={
                      mapping[field] === undefined
                        ? NONE
                        : String(mapping[field])
                    }
                    onValueChange={(v) => setColumn(field, v)}
                  >
                    <SelectTrigger
                      id={`fuel-import-col-${field}`}
                      className="h-8 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No está</SelectItem>
                      {preview.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Columna ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => read(mapping)}
            >
              Volver a leer con estas columnas
            </Button>
          </div>
        )}

        {preview && preview.missing.length > 0 && (
          <p className="text-sm">
            Elegí las columnas de{" "}
            {preview.missing
              .map((f) =>
                f === "patente"
                  ? "patente o tarjeta"
                  : FUEL_IMPORT_FIELD_LABELS[f].toLowerCase(),
              )
              .join(", ")}{" "}
            y volvé a leer.
          </p>
        )}

        {preview && preview.missing.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              {counts.ready} listas · {counts.duplicate} duplicadas ·{" "}
              {counts.no_vehicle} sin vehículo · {counts.invalid} con error
              {preview.truncated &&
                " · el archivo tiene más filas de las que se leen por vez"}
            </p>
            <div className="max-h-80 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Fila</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Vehículo</TableHead>
                    <TableHead className="text-right">Litros</TableHead>
                    <TableHead className="text-right">Importe</TableHead>
                    <TableHead>Estación</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell>
                        <Checkbox
                          aria-label={`Importar la fila ${r.line}`}
                          disabled={!selectable(r) || busy}
                          checked={selectable(r) && selected.has(r.line)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selected);
                            if (checked === true) next.add(r.line);
                            else next.delete(r.line);
                            setSelected(next);
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {r.line}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.load_date ? formatArgentineDate(r.load_date) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.patente ?? r.card ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {r.liters === null ? "—" : formatNumber2(r.liters)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {r.amount === null ? "—" : formatMoney(r.amount)}
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm">
                        {r.station ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <span
                          className={r.status === "ready" ? "" : "font-medium"}
                        >
                          {STATUS_LABELS[r.status]}
                        </span>
                        {r.reason && (
                          <span className="text-muted-foreground block text-xs">
                            {r.reason}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-muted-foreground text-center text-sm"
                      >
                        El archivo no tiene cargas.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={chosen.length === 0 || busy}
            onClick={confirm}
          >
            {confirmMut.isPending
              ? "Importando…"
              : `Importar ${chosen.length} ${chosen.length === 1 ? "carga" : "cargas"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
