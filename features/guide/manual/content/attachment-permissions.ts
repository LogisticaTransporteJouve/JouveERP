import { HUB_ENTITY_LABEL } from "@/features/files/lib/hub";
import {
  ATTACHMENT_WRITE_PERMISSION,
  type AttachmentFkTarget,
} from "@/lib/files/attachment-targets";

import type { GuidePermission } from "../types";

/** The records with an attachments area on screen (cheques and cash
 *  movements have none). */
const RECORDS_WITH_UPLOAD: readonly AttachmentFkTarget[] = [
  "invoice",
  "receipt",
  "purchase_invoice",
  "payment_order",
  "client",
  "supplier",
  "fuel_load",
  "tax_document",
];

/** Attaching or removing a file takes `files:write` plus the record's write
 *  permission: straight from the map the server checks
 *  (lib/files/attachment-targets.ts), so it cannot drift. */
export function attachmentPermissionByRecord(): {
  record: string;
  permission: GuidePermission;
}[] {
  return RECORDS_WITH_UPLOAD.map((target) => ({
    record: HUB_ENTITY_LABEL[target],
    permission: ATTACHMENT_WRITE_PERMISSION[target],
  }));
}

/** The full permission to attach to one kind of record. */
export function attachmentPermission(
  target: AttachmentFkTarget,
): GuidePermission {
  return ["files:write", ATTACHMENT_WRITE_PERMISSION[target]];
}
