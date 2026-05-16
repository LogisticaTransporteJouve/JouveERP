"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

import type { BackupFile } from "../schema";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const BUCKET = "backups-daily";

export async function listBackupsAction(): Promise<ActionResult<BackupFile[]>> {
  const ctx = await requireUserContext();
  // audit:read porque los backups exponen metadata sensible: solo
  // owner/admin con auditoría. accounting:read NO alcanza.
  if (!userCan(ctx.roles, "audit:read")) {
    return { ok: false, error: "Solo owner/admin pueden ver backups." };
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 100, sortBy: { column: "name", order: "desc" } });

  if (error) {
    if (error.message?.toLowerCase().includes("not found")) {
      // Bucket aún no creado en este entorno.
      return { ok: true, data: [] };
    }
    logger.error("backups.list.failed", { error });
    return { ok: false, error: "No se pudo leer la lista de backups." };
  }

  const items: BackupFile[] = (data ?? [])
    .filter((f) => f.name.startsWith("backup-") && f.name.endsWith(".dump"))
    .map((f) => ({
      name: f.name,
      size: Number(
        (f.metadata as Record<string, unknown> | null)?.size ?? f.metadata?.size ?? 0,
      ),
      createdAt: f.created_at ?? "",
      sha256:
        ((f.metadata as Record<string, unknown> | null)?.sha256 as
          | string
          | undefined) ?? null,
    }));

  return { ok: true, data: items };
}

export async function getBackupSignedUrlAction(
  fileName: string,
): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "audit:read")) {
    return { ok: false, error: "Solo owner/admin pueden descargar backups." };
  }
  if (!/^backup-\d{4}-\d{2}-\d{2}\.dump$/.test(fileName)) {
    return { ok: false, error: "Nombre de archivo inválido." };
  }

  const supabase = getServiceClient();
  // 5 minutos de validez — suficiente para descargar manualmente.
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(fileName, 60 * 5);

  if (error || !data?.signedUrl) {
    logger.error("backups.signed_url.failed", { error });
    return { ok: false, error: "No se pudo generar URL de descarga." };
  }

  return {
    ok: true,
    data: {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
  };
}
