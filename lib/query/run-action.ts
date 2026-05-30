/**
 * Unwraps the standard `ActionResult<T>` envelope (`{ ok: true, data } |
 * { ok: false, error }`) for use as a `queryFn` or `mutationFn` in TanStack
 * Query.
 *
 * The leading `await Promise.resolve()` is a workaround for a known Next.js
 * 16 issue: server actions trigger a Router setState on invocation, which
 * conflicts with `useSuspenseQuery` / `useSuspenseInfiniteQuery` calling
 * `queryFn` synchronously during render. Deferring the action call to the
 * next microtask ensures it runs after render.
 *
 * Usage:
 *   queryFn: () => runAction(() => listAccountsAction())
 */

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function runAction<T>(
  fn: () => Promise<ActionResult<T>>,
): Promise<T> {
  await Promise.resolve();
  const res = await fn();
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
