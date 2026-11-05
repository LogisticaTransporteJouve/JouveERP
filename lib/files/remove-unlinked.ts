import "server-only";

import { logAudit } from "@/lib/actions/audit";
import { logger } from "@/lib/logger";
import { getServiceClient } from "@/lib/supabase/service";

/**
 * Deletes a file's row and bytes as soon as nothing links it any more (the
 * scan a document replaced or lost with its deletion), instead of waiting for
 * the nightly orphan sweep. delete_orphan_files re-checks the sweep's rules
 * inside the delete with no age margin, so a file still linked anywhere is
 * kept. Service role: call it only after the action's permission check.
 * Best effort: a failure is logged and left to the sweep. True when the file
 * was deleted.
 */
async function removeUnlinkedFile(fileId: string): Promise<boolean> {
  const service = getServiceClient();
  const { data, error } = await service.rpc("delete_orphan_files", {
    p_ids: [fileId],
    p_max_age: "0 seconds",
  });
  if (error) {
    logger.warn("files.remove_unlinked.failed", {
      fileId,
      error: error.message,
    });
    return false;
  }
  const deleted = data?.[0];
  if (!deleted) return false;

  const { error: storageErr } = await service.storage
    .from(deleted.bucket)
    .remove([deleted.bucket_path]);
  if (storageErr) {
    // The row is gone, so nothing signs these bytes any more.
    logger.warn("files.remove_unlinked.storage_failed", {
      fileId,
      error: storageErr.message,
    });
  }
  return true;
}

/**
 * After a document stopped pointing at a file (replaced, cleared or the
 * document deleted), deletes that file and audits it on the document. An
 * unlinked fleet or employee document scan is no longer hidden from the roles
 * outside fleet_documents:read / hr:read by the files RLS helpers.
 */
export async function removeReplacedFile(input: {
  userId: string;
  auditEvent: string;
  documentId: string;
  previousFileId: string | null;
  nextFileId: string | null;
}): Promise<void> {
  const { previousFileId } = input;
  if (!previousFileId || previousFileId === input.nextFileId) return;
  if (await removeUnlinkedFile(previousFileId)) {
    await logAudit(
      input.auditEvent,
      input.userId,
      { file_id: previousFileId },
      input.documentId,
    );
  }
}
