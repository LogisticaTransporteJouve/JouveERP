"use client";

import { Pencil, Trash2 } from "lucide-react";

import { useConfirm } from "@/components/providers/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatArgentineDate } from "@/lib/format";

import {
  useDeleteEmployeeDocument,
  useEmployeeDocuments,
} from "../hooks/use-employee-documents";
import {
  EMPLOYEE_DOCUMENT_KIND_LABEL,
  getDocumentStatus,
  getDocumentStatusLabel,
  type DocumentStatus,
  type EmployeeDocument,
} from "../schema";

import { EmployeeDocumentDialog } from "./employee-document-dialog";

const STATUS_TONE: Record<DocumentStatus, string> = {
  valid: "bg-muted text-muted-foreground dark:text-muted-foreground",
  expiring_soon: "bg-muted text-muted-foreground dark:text-muted-foreground",
  expired: "bg-muted text-foreground dark:text-foreground",
};

export function EmployeeDocumentsCard({
  employeeId,
  canWrite,
}: {
  employeeId: string;
  canWrite: boolean;
}) {
  const query = useEmployeeDocuments(employeeId);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b p-4">
        <div>
          <h2 className="text-base font-medium">Documentos</h2>
          <p className="text-sm text-muted-foreground">
            Carnet, libreta sanitaria, cursos, aptitudes. Recibimos alerta
            in-app cuando faltan ≤ 30 días.
          </p>
        </div>
        {canWrite && (
          <EmployeeDocumentDialog
            mode="create"
            employeeId={employeeId}
          />
        )}
      </div>

      {query.isLoading ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : !query.data || query.data.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">
          Sin documentos cargados.
        </p>
      ) : (
        <DocumentsTable
          rows={query.data}
          employeeId={employeeId}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

function DocumentsTable({
  rows,
  employeeId,
  canWrite,
}: {
  rows: EmployeeDocument[];
  employeeId: string;
  canWrite: boolean;
}) {
  const confirm = useConfirm();
  const deleteMut = useDeleteEmployeeDocument(employeeId);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tipo</TableHead>
          <TableHead>Número</TableHead>
          <TableHead>Emisión</TableHead>
          <TableHead>Vencimiento</TableHead>
          <TableHead>Estado</TableHead>
          {canWrite && <TableHead className="w-[120px]" />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((d) => {
          const status = getDocumentStatus(d.expires_at);
          return (
            <TableRow key={d.id}>
              <TableCell className="font-medium">
                {EMPLOYEE_DOCUMENT_KIND_LABEL[d.kind]}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {d.number ?? "—"}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {d.issued_at ? formatArgentineDate(d.issued_at) : "—"}
              </TableCell>
              <TableCell className="text-sm">
                {formatArgentineDate(d.expires_at)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className={STATUS_TONE[status]}>
                  {getDocumentStatusLabel(status)}
                </Badge>
              </TableCell>
              {canWrite && (
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <EmployeeDocumentDialog
                      mode="edit"
                      employeeId={employeeId}
                      document={d}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                        >
                          <Pencil className="size-4" />
                          <span className="sr-only">Editar</span>
                        </Button>
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-foreground hover:text-foreground"
                      onClick={async () => {
                        const ok = await confirm({
                          title: "¿Borrar documento?",
                          description:
                            "Esta acción no se puede deshacer. Vas a perder también el histórico si era el único registro de ese tipo.",
                          confirmLabel: "Borrar",
                          tone: "destructive",
                        });
                        if (!ok) return;
                        deleteMut.mutate(d.id);
                      }}
                    >
                      <Trash2 className="size-4" />
                      <span className="sr-only">Borrar</span>
                    </Button>
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
