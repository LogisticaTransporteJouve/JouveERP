// Helper for safely narrowing the scalar result of a Supabase RPC.
//
// The auto-generated supabase-js typing sometimes returns `unknown` (RPCs that
// declare returns text/int/bool in SQL but the TS generator doesn't infer the
// wrapper type correctly). We used to write `data as unknown as T` at every
// call; this helper centralizes the cast and avoids the double-cast at each callsite.
//
// Only use this on RPCs whose return type is known and simple (boolean, number,
// string, or a plain object with a stable shape). For arrays with joins,
// prefer defining the explicit type in the migration and using narrow().

export function rpcAs<T>(data: unknown): T {
  return data as T;
}
