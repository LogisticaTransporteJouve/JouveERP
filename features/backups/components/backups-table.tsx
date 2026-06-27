"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { formatArgentineDate } from "@/lib/format";
import { runAction } from "@/lib/query/run-action";

import { getBackupSignedUrlAction } from "../actions/backups-actions";
import type { BackupFile } from "../schema";

const MB = 1024 * 1024;

function formatSize(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function BackupsTable({ items }: { items: BackupFile[] }) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = useCallback(async (name: string) => {
    setDownloading(name);
    try {
      const res = await runAction(() => getBackupSignedUrlAction(name));
      window.open(res.url, "_blank", "noopener,noreferrer");
      toast.success(`Link de descarga generado (válido 5 min).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar.");
    } finally {
      setDownloading(null);
    }
  }, []);

  const columns = useMemo<ColumnDef<BackupFile>[]>(
    () => [
      {
        accessorKey: "name",
        header: "Archivo",
        cell: ({ row }) => (
          <span className="font-mono text-sm">
            {row.original.name}
            {row.index === 0 && (
              <Badge variant="outline" className="ml-2 text-xs">
                último
              </Badge>
            )}
          </span>
        ),
      },
      {
        accessorKey: "size",
        header: "Tamaño",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {formatSize(row.original.size)}
          </span>
        ),
        meta: { headerClassName: "w-28", align: "right" },
      },
      {
        accessorKey: "sha256",
        header: "SHA256",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.sha256 ? row.original.sha256.slice(0, 16) + "…" : "—"}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Subido",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.createdAt
              ? formatArgentineDate(row.original.createdAt)
              : "—"}
          </span>
        ),
        meta: { headerClassName: "w-40" },
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        meta: { headerClassName: "w-32" },
        cell: ({ row }) => (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleDownload(row.original.name)}
            disabled={downloading === row.original.name}
          >
            <Download className="size-3" />
            {downloading === row.original.name ? "..." : "Descargar"}
          </Button>
        ),
      },
    ],
    [downloading, handleDownload],
  );

  if (items.length === 0) {
    return (
      <div className="rounded-lg border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
        <ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground/50" />
        No hay backups todavía. El primer backup se genera cuando corra
        el workflow nocturno (03:00 UTC) o vía Run workflow manual desde
        GitHub Actions.
      </div>
    );
  }

  return (
    <DataTable
      columns={columns}
      data={items}
      getRowId={(b) => b.name}
      emptyMessage="No hay backups todavía."
    />
  );
}
