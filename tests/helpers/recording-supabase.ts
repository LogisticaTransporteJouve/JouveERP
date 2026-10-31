// A fake Supabase client for unit tests of service-client code: every query
// is recorded (table, operation, payload, options and each filter) and
// answered by the test's `respond`, so a test can assert which rows a write
// targets (owner filters, compare-and-set on status) without a database.

export type RecordedCall = {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  payload?: unknown;
  options?: unknown;
  filters: [string, string, unknown][];
};

export type FakeResponse = { data: unknown; error: unknown; count?: number };

export function recordingSupabase(
  respond: (call: RecordedCall) => FakeResponse = () => ({
    data: null,
    error: null,
  }),
) {
  const calls: RecordedCall[] = [];

  function from(table: string, rpcArgs?: unknown) {
    const call: RecordedCall =
      rpcArgs === undefined
        ? { table, op: "select", filters: [] }
        : { table, op: "rpc", payload: rpcArgs, filters: [] };
    calls.push(call);
    const answer = async () => respond(call);
    const filter =
      (kind: string) => (column: string, value?: unknown, extra?: unknown) => {
        call.filters.push([
          kind,
          column,
          extra === undefined ? value : [value, extra],
        ]);
        return builder;
      };
    const builder = {
      select: (_columns?: string, options?: unknown) => {
        if (options !== undefined && call.op === "select") {
          call.options = options;
        }
        return builder;
      },
      insert: (payload: unknown) => {
        call.op = "insert";
        call.payload = payload;
        return builder;
      },
      update: (payload: unknown) => {
        call.op = "update";
        call.payload = payload;
        return builder;
      },
      upsert: (payload: unknown, options?: unknown) => {
        call.op = "upsert";
        call.payload = payload;
        call.options = options;
        return builder;
      },
      delete: () => {
        call.op = "delete";
        return builder;
      },
      eq: filter("eq"),
      neq: filter("neq"),
      in: filter("in"),
      lt: filter("lt"),
      lte: filter("lte"),
      gte: filter("gte"),
      not: filter("not"),
      ilike: filter("ilike"),
      or: filter("or"),
      is: filter("is"),
      order: () => builder,
      limit: () => builder,
      range: () => builder,
      maybeSingle: answer,
      single: answer,
      then<T>(resolve: (value: FakeResponse) => T, reject?: (e: unknown) => T) {
        return answer().then(resolve, reject);
      },
    };
    return builder;
  }

  /** `rpc(name, args)` records a call with `op: "rpc"` on table `name`. */
  const rpc = (name: string, args: unknown = {}) => from(name, args);

  return { client: { from, rpc }, calls };
}

/** The value of the first `kind` filter on `column`, if any. */
export function filterValue(
  call: RecordedCall,
  kind: string,
  column: string,
): unknown {
  return call.filters.find(([k, c]) => k === kind && c === column)?.[2];
}
