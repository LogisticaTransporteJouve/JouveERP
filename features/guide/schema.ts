import { z } from "zod";

import { SETUP_ITEM_KEYS, type SetupItemKey } from "./lib/setup-checklist";

/** done_data: the app sees it in the data; done_user: the user marked it. */
export type SetupItemState = "pending" | "done_data" | "done_user";

export type GuideItemStatus = { key: SetupItemKey; state: SetupItemState };

export type GuideState = {
  collapsed: boolean;
  /** Only the items the viewer may see, in checklist order. */
  items: GuideItemStatus[];
};

export const SetGuideCollapsedSchema = z.object({ collapsed: z.boolean() });

export const SetGuideItemDoneSchema = z.object({
  key: z.enum(SETUP_ITEM_KEYS),
  done: z.boolean(),
});

/** The dismissed list after marking `key` done or undone, without
 *  duplicates and without keys the checklist no longer has. */
export function nextDismissed(
  current: readonly string[],
  key: SetupItemKey,
  done: boolean,
): SetupItemKey[] {
  const known = current.filter((k): k is SetupItemKey =>
    (SETUP_ITEM_KEYS as readonly string[]).includes(k),
  );
  const without = known.filter((k) => k !== key);
  return done ? [...without, key] : without;
}

export function itemState(
  derivedDone: boolean,
  dismissed: readonly string[],
  key: SetupItemKey,
): SetupItemState {
  if (derivedDone) return "done_data";
  return dismissed.includes(key) ? "done_user" : "pending";
}
