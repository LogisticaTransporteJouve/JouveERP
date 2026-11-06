import type { JsonValue } from "@/lib/actions/audit";

import {
  PAYLOAD_REFS,
  entityKey,
  isUuid,
  type AuditEntity,
  type EntityKind,
  type EntityLookup,
} from "./entities";
import {
  auditGroupOf,
  auditSentence,
  auditSubjectKind,
  type AuditGroupId,
} from "./registry";

/** «Sobre qué»: the record an event is about, named and linked. */
export type AuditSubject = { label: string; href: string | null };

export type AuditDescription = {
  sentence: string;
  subject: AuditSubject | null;
  group: AuditGroupId | null;
};

/** Payload records that can stand for the event when its target cannot,
 *  most specific first. */
const SUBJECT_FALLBACK_KEYS = [
  "nd_invoice_id",
  "invoice_id",
  "purchaseInvoiceId",
  "trip_id",
  "client_id",
  "supplier_id",
  "employee_id",
  "vehicle_id",
  "driver_id",
] as const;

type Describable = {
  event_type: string;
  target_resource_id: string | null;
  target_user_id: string | null;
  /** Already masked. */
  payload: JsonValue;
};

function asObject(v: JsonValue): { [k: string]: JsonValue | undefined } {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

/** «Factura A 0003-00022312 · TRANSPORTES SUR SA» from «la Factura A …». */
export function subjectLabel(entity: AuditEntity): string {
  const bare = entity.label.replace(/^(el|la|los|las) /, "");
  const head = bare.charAt(0).toUpperCase() + bare.slice(1);
  return entity.party ? `${head} · ${entity.party}` : head;
}

export function describeAuditEvent(
  event: Describable,
  lookup: EntityLookup,
): AuditDescription {
  const p = asObject(event.payload);
  const get = (kind: EntityKind, id: JsonValue | undefined) =>
    isUuid(id) ? (lookup.get(entityKey(kind, id)) ?? null) : null;

  const subjectKind = auditSubjectKind(event.event_type);
  const subject = subjectKind
    ? get(subjectKind, event.target_resource_id)
    : null;
  const targetUser = get("user", event.target_user_id);

  const sentence = auditSentence(event.event_type, {
    p,
    subject,
    ref: get,
    targetUser: targetUser?.label ?? null,
  });

  let about: AuditEntity | null = subject;
  for (const key of SUBJECT_FALLBACK_KEYS) {
    if (about) break;
    const kind = PAYLOAD_REFS[key];
    if (kind) about = get(kind, p[key]);
  }
  if (!about && targetUser) about = targetUser;

  return {
    sentence,
    subject: about ? { label: subjectLabel(about), href: about.href } : null,
    group: auditGroupOf(event.event_type),
  };
}
