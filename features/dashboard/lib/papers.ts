import { addDaysIso } from "@/lib/date-range";

import type { PaperHolderKind, PendingPaper } from "../schema";

/** How far ahead a paper counts as "por vencer". */
export const PAPERS_HORIZON_DAYS = 30;

/** A fleet or employee document as the dashboard reads it. */
export type PaperDoc = {
  id: string;
  kind: string;
  kindLabel: string;
  expires_at: string;
  holderKind: PaperHolderKind;
  /** The truck, driver or employee it belongs to; null when it has none. */
  holderId: string | null;
  holderName: string;
  holderActive: boolean;
  href: string;
};

/**
 * The papers to renew: for each holder and kind, the latest document when it
 * is expired or expires within the horizon. A paper already renewed (a newer
 * one of the same kind for the same holder) is not pending, nor is one of an
 * inactive holder. Expired first, then by date.
 */
export function pendingPapers(
  docs: readonly PaperDoc[],
  today: string,
  horizonDays = PAPERS_HORIZON_DAYS,
): PendingPaper[] {
  const latest = new Map<string, PaperDoc>();
  for (const doc of docs) {
    if (!doc.holderId) continue;
    const key = `${doc.holderKind}:${doc.holderId}:${doc.kind}`;
    const current = latest.get(key);
    if (!current || doc.expires_at > current.expires_at) latest.set(key, doc);
  }
  const until = addDaysIso(today, horizonDays);
  return [...latest.values()]
    .filter((doc) => doc.holderActive && doc.expires_at <= until)
    .map((doc) => ({
      id: doc.id,
      holder_kind: doc.holderKind,
      holder: doc.holderName,
      kind: doc.kindLabel,
      expires_at: doc.expires_at,
      expired: doc.expires_at < today,
      href: doc.href,
    }))
    .sort(
      (a, b) =>
        Number(b.expired) - Number(a.expired) ||
        a.expires_at.localeCompare(b.expires_at),
    );
}
