"use client";

import { Undo2 } from "lucide-react";
import { toast } from "sonner";

import { useConfirm } from "@/components/providers/confirm-provider";
import { IconButton } from "@/components/ui/icon-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDateTime } from "@/lib/format";

import type { ImportRunRow } from "../actions/import-actions";
import { useImportRuns, useUndoImportRun } from "../hooks/use-imports";
import { IMPORT_KIND_LABELS, type ImportKind } from "../schema";

export function ImportRunsTable({
  undoableKinds,
}: {
  /** The kinds whose runs this user may undo. */
  undoableKinds: readonly ImportKind[];
}) {
  const { data: runs } = useImportRuns();
  const undoMut = useUndoImportRun();
  const confirm = useConfirm();

  async function undo(run: ImportRunRow) {
    const ok = await confirm({
      title: "Deshacer la importación",
      description: `Se borran las ${run.inserted_rows} filas que importó ${run.file_name}. Solo se puede si nadie las editó ni las usa en otro lado.`,
      confirmLabel: "Deshacer",
      tone: "destructive",
    });
    if (!ok) return;
    undoMut.mutate(run.id, {
      onSuccess: () => toast.success("Importación deshecha."),
      onError: (err) => toast.error(err.message),
    });
  }

  if (runs.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Todavía no se importó ninguna planilla.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Archivo</TableHead>
            <TableHead className="text-right">Importadas</TableHead>
            <TableHead className="text-right">Ya estaban</TableHead>
            <TableHead className="text-right">Con error</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="text-sm whitespace-nowrap">
                {formatArgentineDateTime(run.created_at)}
                {run.created_by_name && (
                  <span className="text-muted-foreground block text-xs">
                    {run.created_by_name}
                  </span>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {IMPORT_KIND_LABELS[run.kind]}
              </TableCell>
              <TableCell className="max-w-56 truncate text-sm">
                {run.file_name}
              </TableCell>
              <TableCell className="text-right text-sm">
                {run.inserted_rows}
              </TableCell>
              <TableCell className="text-right text-sm">
                {run.skipped_rows}
              </TableCell>
              <TableCell className="text-right text-sm">
                {run.invalid_rows}
              </TableCell>
              <TableCell className="text-sm">
                {run.status === "undone" ? (
                  <>
                    <span className="font-medium">Deshecha</span>
                    <span className="text-muted-foreground block text-xs">
                      {formatArgentineDateTime(run.undone_at)}
                      {run.undone_by_name && ` · ${run.undone_by_name}`}
                    </span>
                  </>
                ) : (
                  "Confirmada"
                )}
              </TableCell>
              <TableCell>
                {run.status === "committed" &&
                  run.inserted_rows > 0 &&
                  undoableKinds.includes(run.kind) && (
                    <IconButton
                      label={`Deshacer la importación de ${run.file_name}`}
                      variant="ghost"
                      disabled={undoMut.isPending}
                      onClick={() => undo(run)}
                    >
                      <Undo2 className="size-4" />
                    </IconButton>
                  )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
