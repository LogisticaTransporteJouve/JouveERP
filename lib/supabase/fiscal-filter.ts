// The one read-side scope filter. `isFiscal` comes from `isFiscalFor(scope)`:
// `null`/`undefined` returns the query untouched (every channel, rows without a
// channel included); a boolean keeps only rows whose channel has that
// `is_fiscal` and drops the rows with no channel. Visibility never looks at
// `is_active`: an inactive fiscal channel's history still reads as fiscal.

type FiscalFilterable<Q> = {
  eq(column: string, value: boolean): Q;
  not(column: string, operator: string, value: null): Q;
};

/**
 * With `embed` (the alias of the `invoicing_channels` embed the select already
 * carries, e.g. `channel:invoicing_channels(name, is_fiscal)`), filters on
 * `<embed>.is_fiscal` and drops parents whose embed is empty. Without it,
 * filters a view's `channel_is_fiscal` column (NULL never matches `eq`).
 */
export function applyFiscalFilter<Q extends FiscalFilterable<Q>>(
  query: Q,
  isFiscal: boolean | null | undefined,
  embed?: string,
): Q {
  if (isFiscal === null || isFiscal === undefined) return query;
  if (!embed) return query.eq("channel_is_fiscal", isFiscal);
  return query.eq(`${embed}.is_fiscal`, isFiscal).not(embed, "is", null);
}

type ChannelScopeFilterable<Q> = FiscalFilterable<Q> & {
  eq(column: string, value: string | boolean): Q;
  not(column: string, operator: string, value: boolean | null): Q;
};

/**
 * The list filter of a page: always the side (`applyFiscalFilter`, so a
 * fiscal-only user asking for an internal channel by id gets nothing), then
 * either that segregated channel (`scope.channelId`) or the main app without
 * segregated channels. `scope.isFiscal` must already be pinned with
 * `scopeIsFiscalFor(ctx.access, …)`.
 *
 * With `embed`, the table's `channel_id` is NOT NULL and the embed selects
 * `is_segregated`. Without it, a view's `channel_is_segregated` column; rows
 * with no channel (opening balances) stay in the main app.
 */
export function applyChannelScope<Q extends ChannelScopeFilterable<Q>>(
  query: Q,
  scope: {
    isFiscal: boolean | null | undefined;
    channelId: string | null | undefined;
  },
  embed?: string,
): Q {
  const sided = applyFiscalFilter(query, scope.isFiscal, embed);
  if (scope.channelId) return sided.eq("channel_id", scope.channelId);
  return embed
    ? sided.eq(`${embed}.is_segregated`, false).not(embed, "is", null)
    : sided.not("channel_is_segregated", "is", true);
}
