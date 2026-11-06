import Link from "next/link";

import type { AuditSubject } from "../lib/describe";

/** «Sobre qué»: the record's name, linked to its page when it has one. */
export function AuditSubjectLink({
  subject,
}: {
  subject: AuditSubject | null;
}) {
  if (!subject) return <span className="text-muted-foreground">—</span>;
  if (!subject.href) return <span>{subject.label}</span>;
  return (
    <Link
      href={subject.href}
      className="underline underline-offset-2"
      onClick={(e) => e.stopPropagation()}
    >
      {subject.label}
    </Link>
  );
}
