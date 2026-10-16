"use server";

import { requireUserContext } from "@/lib/auth/context";
import { userCan } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import type { ActionResult } from "@/lib/query/run-action";
import { createClient } from "@/lib/supabase/server";
import { UuidSchema } from "@/lib/validation/common";

import {
  SPREADSHEET_MIMES,
  buildHubOrFilter,
  containsPattern,
  hubScope,
  isHubEntityType,
  nextIsoDay,
  type HubEntityType,
} from "../lib/hub";
import {
  HubPageInputSchema,
  type HubFileRow,
  type HubFilesPage,
  type HubUploader,
} from "../schema";

// The /files hub reads v_files_hub with the caller's RLS client (the view is
// SECURITY INVOKER: files, file_attachments, ai_document_extractions,
// employee_documents and ai_chat_* policies all apply) and narrows it to the
// entity types the caller's permissions cover (lib/hub.ts).

const NO_FILES = "No tenés permiso para ver archivos.";
const DEFAULT_LIMIT = 50;
const HUB_COLUMNS =
  "link_id, entity_type, entity_id, parent_id, kind, file_id, original_filename, mime_type, file_size, uploaded_by, uploader_name, uploaded_at";

/** Argentina has no DST: a calendar day starts at 00:00-03:00. */
const AR_OFFSET = "-03:00";

type Client = Awaited<ReturnType<typeof createClient>>;

/** v_files_hub narrowed to the entity types the caller may list. */
function scopedHub(supabase: Client, entityTypes: readonly HubEntityType[]) {
  return supabase
    .from("v_files_hub")
    .select(HUB_COLUMNS)
    .in("entity_type", [...entityTypes]);
}

export async function listHubFilesAction(
  input: unknown,
): Promise<ActionResult<HubFilesPage>> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:read")) return { ok: false, error: NO_FILES };
  const parsed = HubPageInputSchema.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, error: "Filtros inválidos." };
  const filters = parsed.data;

  const scope = hubScope(ctx.roles);
  const entityTypes = filters.entityType
    ? scope.entityTypes.filter((t) => t === filters.entityType)
    : scope.entityTypes;
  if (entityTypes.length === 0) {
    return { ok: true, data: { items: [], nextCursor: null } };
  }
  const limit = filters.limit ?? DEFAULT_LIMIT;

  const supabase = await createClient();
  let query = scopedHub(supabase, entityTypes)
    .order("uploaded_at", { ascending: false })
    .order("link_id", { ascending: false })
    .limit(limit + 1);

  const or = buildHubOrFilter({
    ownerId: scope.ownOnly ? ctx.userId : null,
    cursor: filters.cursor ?? null,
  });
  if (or) query = query.or(or);
  if (filters.search) {
    query = query.ilike("original_filename", containsPattern(filters.search));
  }
  if (filters.fileKind === "pdf")
    query = query.eq("mime_type", "application/pdf");
  if (filters.fileKind === "image") query = query.like("mime_type", "image/%");
  if (filters.fileKind === "spreadsheet") {
    query = query.in("mime_type", [...SPREADSHEET_MIMES]);
  }
  if (filters.uploadedBy) query = query.eq("uploaded_by", filters.uploadedBy);
  if (filters.dateFrom) {
    query = query.gte(
      "uploaded_at",
      `${filters.dateFrom}T00:00:00${AR_OFFSET}`,
    );
  }
  if (filters.dateTo) {
    query = query.lt(
      "uploaded_at",
      `${nextIsoDay(filters.dateTo)}T00:00:00${AR_OFFSET}`,
    );
  }

  const { data, error } = await query;
  if (error) {
    logger.error("files.hub.list_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los archivos." };
  }

  const items = (data ?? []).flatMap((row): HubFileRow[] => {
    if (
      !row.link_id ||
      !isHubEntityType(row.entity_type) ||
      !row.entity_id ||
      !row.file_id ||
      !row.uploaded_at
    ) {
      return [];
    }
    return [
      {
        linkId: row.link_id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        parentId: row.parent_id,
        kind: row.kind,
        fileId: row.file_id,
        filename: row.original_filename ?? "archivo",
        mimeType: row.mime_type,
        fileSize: row.file_size,
        uploadedBy: row.uploaded_by,
        uploaderName: row.uploader_name,
        uploadedAt: row.uploaded_at,
      },
    ];
  });
  const hasMore = (data ?? []).length > limit;
  const page = items.slice(0, limit);
  const last = page.at(-1);
  return {
    ok: true,
    data: {
      items: page,
      nextCursor:
        hasMore && last
          ? { uploadedAt: last.uploadedAt, linkId: last.linkId }
          : null,
    },
  };
}

/**
 * One-hour signed URL for a hub row. The row is looked up through the same
 * scoped view as the list, so a file is signed only for whom can list it;
 * the storage policy re-checks the `files` row under the caller's RLS.
 */
export async function getHubFileUrlAction(
  linkId: string,
  options: { download?: boolean } = {},
): Promise<
  ActionResult<{ url: string; filename: string; mimeType: string | null }>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:read")) return { ok: false, error: NO_FILES };
  const parsed = UuidSchema.safeParse(linkId);
  if (!parsed.success) return { ok: false, error: "ID inválido." };
  const scope = hubScope(ctx.roles);
  if (scope.entityTypes.length === 0) {
    return { ok: false, error: "Archivo no encontrado." };
  }

  const supabase = await createClient();
  let query = scopedHub(supabase, scope.entityTypes).eq("link_id", parsed.data);
  const or = buildHubOrFilter({
    ownerId: scope.ownOnly ? ctx.userId : null,
    cursor: null,
  });
  if (or) query = query.or(or);
  const { data: row, error } = await query.limit(1).maybeSingle();
  if (error || !row?.file_id) {
    if (error) {
      logger.warn("files.hub.sign_lookup_failed", {
        userId: ctx.userId,
        error,
      });
    }
    return { ok: false, error: "Archivo no encontrado." };
  }

  const { data: file } = await supabase
    .from("files")
    .select("bucket, bucket_path, original_filename, mime_type")
    .eq("id", row.file_id)
    .maybeSingle();
  if (!file) return { ok: false, error: "Archivo no encontrado." };

  const { data: signed, error: signError } = await supabase.storage
    .from(file.bucket)
    .createSignedUrl(file.bucket_path, 3600, {
      download: options.download ? file.original_filename : false,
    });
  if (signError || !signed) {
    logger.warn("files.hub.sign_failed", {
      userId: ctx.userId,
      error: signError,
    });
    return { ok: false, error: "No se pudo generar la URL." };
  }
  return {
    ok: true,
    data: {
      url: signed.signedUrl,
      filename: file.original_filename,
      mimeType: file.mime_type,
    },
  };
}

/** People for the "Subido por" filter (profiles are readable app-wide). */
export async function listHubUploadersAction(): Promise<
  ActionResult<HubUploader[]>
> {
  const ctx = await requireUserContext();
  if (!userCan(ctx.roles, "files:read")) return { ok: false, error: NO_FILES };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("user_id, first_name, last_name")
    .limit(500);
  if (error) {
    logger.error("files.hub.uploaders_failed", { userId: ctx.userId, error });
    return { ok: false, error: "No se pudieron cargar los usuarios." };
  }
  const people = (data ?? []).flatMap((p): HubUploader[] => {
    const name = [p.first_name, p.last_name]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ")
      .trim();
    return name ? [{ id: p.user_id, name }] : [];
  });
  people.sort((a, b) => a.name.localeCompare(b.name, "es"));
  return { ok: true, data: people };
}
