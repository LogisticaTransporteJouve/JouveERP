import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

/**
 * True when something still points at the file: an attachment, a Document
 * Intelligence extraction (deleting the file would cascade it away), an
 * employee document or a fleet document. Mirrors the exclusions of
 * `find_orphan_files`. Service role: the caller's RLS hides attachments of
 * records it cannot read (20261105100100) and rows of other users.
 */
export async function isFileStillReferenced(fileId: string): Promise<boolean> {
  const service = getServiceClient();
  const [attachments, extractions, employeeDocs, fleetDocs] = await Promise.all(
    [
      service
        .from("file_attachments")
        .select("id", { count: "exact", head: true })
        .eq("file_id", fileId),
      service
        .from("ai_document_extractions")
        .select("id", { count: "exact", head: true })
        .eq("file_id", fileId),
      service
        .from("employee_documents")
        .select("id", { count: "exact", head: true })
        .eq("attachment_file_id", fileId),
      service
        .from("fleet_documents")
        .select("id", { count: "exact", head: true })
        .eq("attachment_file_id", fileId),
    ],
  );
  const reads = [attachments, extractions, employeeDocs, fleetDocs];
  // Fail safe: if any lookup errors, keep the file.
  if (reads.some((r) => r.error)) return true;
  return reads.some((r) => (r.count ?? 0) > 0);
}

/**
 * Whether the file is a Document Intelligence scan (an extraction reads it),
 * whoever scanned it; null when the lookup fails. Service role, because the
 * extraction's RLS hides other users' scans: the caller uses the answer only
 * to refuse.
 */
export async function isDocumentScanFile(
  fileId: string,
): Promise<boolean | null> {
  const { count, error } = await getServiceClient()
    .from("ai_document_extractions")
    .select("id", { count: "exact", head: true })
    .eq("file_id", fileId);
  if (error) return null;
  return (count ?? 0) > 0;
}
