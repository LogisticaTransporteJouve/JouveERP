import "server-only";

import { getServiceClient } from "@/lib/supabase/service";

/**
 * True when a table other than file_attachments still points at the file:
 * a Document Intelligence extraction (deleting the file would cascade it away)
 * an employee document or a fleet document. Mirrors the exclusions of `find_orphan_files`.
 * Service role: the caller's RLS may hide rows of other users.
 */
export async function isFileReferencedElsewhere(
  fileId: string,
): Promise<boolean> {
  const service = getServiceClient();
  const [extractions, employeeDocs, fleetDocs] = await Promise.all([
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
  ]);
  // Fail safe: if any lookup errors, keep the file.
  if (extractions.error || employeeDocs.error || fleetDocs.error) return true;
  return (
    (extractions.count ?? 0) > 0 ||
    (employeeDocs.count ?? 0) > 0 ||
    (fleetDocs.count ?? 0) > 0
  );
}
