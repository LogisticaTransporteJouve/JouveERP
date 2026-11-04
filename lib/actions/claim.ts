import type { ActionResult } from "@/lib/query/run-action";

/**
 * The header row was inserted but a later step failed (e.g. its items). The
 * entity exists: callers that track what they created (AI drafts, the ARCA
 * tray) must link `createdId` instead of treating this as "nothing was
 * created".
 */
export type PartialCreateFailure = {
  ok: false;
  error: string;
  createdId: string;
};

/**
 * Claim → create → (release on failure). `create` only runs for the caller
 * that won the claim, so a double click or a second tab creates nothing. A
 * partial failure (the row was inserted, a later step failed) keeps the
 * claim: releasing it would let the user create the same document twice.
 */
export async function createWithClaim<T>(opts: {
  claim: () => Promise<boolean>;
  release: () => Promise<void>;
  create: () => Promise<ActionResult<T> | PartialCreateFailure>;
  alreadyProcessed: string;
}): Promise<ActionResult<T> | PartialCreateFailure> {
  if (!(await opts.claim())) {
    return { ok: false, error: opts.alreadyProcessed };
  }
  let result: ActionResult<T> | PartialCreateFailure;
  try {
    result = await opts.create();
  } catch (err) {
    await opts.release();
    throw err;
  }
  if (!result.ok && !("createdId" in result)) {
    await opts.release();
  }
  return result;
}
