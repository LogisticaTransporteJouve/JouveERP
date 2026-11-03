"use client";

import { FileUp, Info, Loader2 } from "lucide-react";
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
import { formatArgentineDateTime } from "@/lib/format";

import type { ImportPreview } from "../actions/import-actions";
import { useCommitImport, usePreviewImport } from "../hooks/use-imports";
import { IMPORT_FIELDS, fieldLabel } from "../lib/fields";
import { IMPORT_ROW_STATUS_LABELS, type ImportMapping } from "../lib/rows";
import {
  IMPORT_KIND_LABELS,
  IMPORT_KINDS,
  isImportKind,
  type ImportKind,
} from "../schema";

const NONE = "__none__";

/** What each kind does with the rows, under the kind picker. */
const KIND_NOTES: Record<ImportKind, string> = {
  clients:
    "Crea los clientes que no existen. Se compara por CUIT (o por nombre si no tiene).",
  suppliers:
    "Crea los proveedores que no existen. Se compara por CUIT (o por nombre si no tiene).",
  employees:
    "Crea los empleados que no existen. Se compara por CUIL (o por nombre si no tiene).",
  vehicles: "Crea los vehículos que no existen. Se compara por patente.",
  historic_payroll:
    "Sueldos de meses anteriores al sistema, solo de referencia: no generan asientos, pagos ni cuenta corriente del empleado. Los empleados tienen que estar cargados.",
  historic_trips:
    "Viajes anteriores al sistema, solo de referencia: no generan facturas, extras de chofer ni rentabilidad. Vehículo, chofer y cliente se buscan por patente, nombre o CUIT; si no se encuentran se guarda el texto.",
};

export function ImportDialog({
  open,
  onOpenChange,
  kinds,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kinds this user may import. */
  kinds: readonly ImportKind[];
}) {
  const previewMut = usePreviewImport();
  const commitMut = useCommitImport();
  const [kind, setKind] = useState<ImportKind | null>(kinds[0] ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping(null);
  }

  function formData(withMapping: ImportMapping | null): FormData | null {
    if (!file || !kind) return null;
    const data = new FormData();
    data.set("file", file);
    data.set("kind", kind);
    if (withMapping) data.set("mapping", JSON.stringify(withMapping));
    return data;
  }

  function read(withMapping: ImportMapping | null) {
    const data = formData(withMapping);
    if (!data) return;
    previewMut.mutate(data, {
      onSuccess: (result) => {
        setPreview(result);
        setMapping(result.mapping);
      },
      onError: (err) => {
        setPreview(null);
        toast.error(err.message);
      },
    });
  }

  function commit() {
    const data = formData(mapping);
    if (!data) return;
    commitMut.mutate(data, {
      onSuccess: ({ inserted, skipped, invalid }) => {
        const extra = [
          skipped > 0 ? `${skipped} ya estaban` : null,
          invalid > 0 ? `${invalid} con error quedaron afuera` : null,
        ].filter(Boolean);
        toast.success(
          `Se importaron ${inserted} filas${extra.length > 0 ? ` (${extra.join("; ")})` : ""}.`,
        );
        reset();
        onOpenChange(false);
      },
      onError: (err) => toast.error(err.message),
    });
  }

  function setColumn(field: string, value: string) {
    const next: ImportMapping = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = Number(value);
    setMapping(next);
  }

  const busy = previewMut.isPending || commitMut.isPending;
  const fields = kind ? IMPORT_FIELDS[kind] : [];
  const ready = preview?.counts.ready ?? 0;
  // The commit reads the file with the mapping it sends: one the user changed
  // after the preview has to be read again first.
  const mappingChanged =
    !!preview &&
    !!mapping &&
    JSON.stringify(mapping) !== JSON.stringify(preview.mapping);
  const committedBefore = preview?.previousRuns.find(
    (r) => r.status === "committed",
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar planilla</DialogTitle>
          <DialogDescription>
            Subí un .xlsx (primera hoja) o .csv con una fila de títulos. Nada se
            guarda hasta que confirmes; las filas con error quedan afuera y las
            que ya están cargadas se saltean.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="import-kind">Qué importar</Label>
            <Select
              value={kind ?? undefined}
              onValueChange={(v) => {
                if (isImportKind(v)) setKind(v);
                setPreview(null);
                setMapping(null);
              }}
            >
              <SelectTrigger id="import-kind">
                <SelectValue placeholder="Elegí" />
              </SelectTrigger>
              <SelectContent>
                {IMPORT_KINDS.filter((k) => kinds.includes(k)).map((k) => (
                  <SelectItem key={k} value={k}>
                    {IMPORT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="import-file">Archivo</Label>
            <Input
              id="import-file"
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
            disabled={!file || !kind || busy}
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

        {kind && !preview && (
          <div className="text-muted-foreground space-y-1 text-sm">
            <p>{KIND_NOTES[kind]}</p>
            <p>
              Columnas:{" "}
              {fields
                .map((f) => `${f.label}${f.required ? " (obligatoria)" : ""}`)
                .join(", ")}
              .
            </p>
            {fields.some((f) => f.hint) && (
              <ul className="list-disc pl-5">
                {fields
                  .filter((f) => f.hint)
                  .map((f) => (
                    <li key={f.key}>
                      {f.label}: {f.hint}
                    </li>
                  ))}
              </ul>
            )}
          </div>
        )}

        {preview && mapping && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Columnas</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {fields.map((field) => (
                <div key={field.key} className="min-w-0 space-y-1">
                  <Label
                    htmlFor={`import-col-${field.key}`}
                    className="text-xs"
                  >
                    {field.label}
                    {field.required &&
                      (preview.missing.includes(field.key) ? " (falta)" : " *")}
                  </Label>
                  <Select
                    value={
                      mapping[field.key] === undefined
                        ? NONE
                        : String(mapping[field.key])
                    }
                    onValueChange={(v) => setColumn(field.key, v)}
                  >
                    <SelectTrigger
                      id={`import-col-${field.key}`}
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
              variant={mappingChanged ? "default" : "outline"}
              disabled={busy}
              onClick={() => read(mapping)}
            >
              Volver a leer con estas columnas
            </Button>
          </div>
        )}

        {preview && committedBefore && (
          <p className="flex items-start gap-2 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" />
            Este mismo archivo ya se importó el{" "}
            {formatArgentineDateTime(committedBefore.created_at)}: lo que ya
            está cargado se saltea.
          </p>
        )}

        {preview && preview.missing.length > 0 && (
          <p className="text-sm">
            Elegí la columna de{" "}
            {preview.missing
              .map((key) => fieldLabel(preview.kind, key).toLowerCase())
              .join(", ")}{" "}
            y volvé a leer.
          </p>
        )}

        {preview && preview.missing.length === 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              {preview.counts.ready} listas · {preview.counts.duplicate} ya
              cargadas · {preview.counts.invalid} con error
              {preview.truncated &&
                " · el archivo tiene más de 5000 filas o celdas muy largas: dividilo para importarlo"}
            </p>
            <div className="max-h-96 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Fila</TableHead>
                    <TableHead>Registro</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell className="text-muted-foreground align-top text-xs">
                        {r.line}
                      </TableCell>
                      <TableCell className="align-top">
                        <span className="text-sm">{r.label}</span>
                        {r.detail && (
                          <span className="text-muted-foreground block text-xs">
                            {r.detail}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-sm">
                        <span
                          className={r.status === "ready" ? "" : "font-medium"}
                        >
                          {IMPORT_ROW_STATUS_LABELS[r.status]}
                        </span>
                        {[...r.errors, ...r.warnings].map((m) => (
                          <span
                            key={m}
                            className="text-muted-foreground block text-xs"
                          >
                            {m}
                          </span>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                  {preview.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="text-muted-foreground text-center text-sm"
                      >
                        El archivo no tiene filas debajo de los títulos.
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
            disabled={
              !preview ||
              preview.missing.length > 0 ||
              preview.truncated ||
              mappingChanged ||
              ready === 0 ||
              busy
            }
            onClick={commit}
          >
            {commitMut.isPending
              ? "Importando…"
              : `Importar ${ready} ${ready === 1 ? "fila" : "filas"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
