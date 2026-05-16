"use client";

import { Download, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

  async function handleDownload(name: string) {
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
  }

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
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Archivo</TableHead>
            <TableHead className="w-28 text-right">Tamaño</TableHead>
            <TableHead>SHA256</TableHead>
            <TableHead className="w-40">Subido</TableHead>
            <TableHead className="w-32" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((b, i) => (
            <TableRow key={b.name}>
              <TableCell className="font-mono text-sm">
                {b.name}
                {i === 0 && (
                  <Badge variant="outline" className="ml-2 text-xs">
                    último
                  </Badge>
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-xs">
                {formatSize(b.size)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {b.sha256 ? b.sha256.slice(0, 16) + "…" : "—"}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {b.createdAt ? formatArgentineDate(b.createdAt) : "—"}
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(b.name)}
                  disabled={downloading === b.name}
                >
                  <Download className="size-3" />
                  {downloading === b.name ? "..." : "Descargar"}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
