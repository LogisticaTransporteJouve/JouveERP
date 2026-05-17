// Helper para narrow seguro del resultado escalar de un RPC de Supabase.
//
// El typing autogenerado de supabase-js a veces devuelve `unknown` (RPCs que
// declaran returns text/int/bool en SQL pero el TS generator no infiere bien
// el tipo del wrapper). Antes usábamos `data as unknown as T` en cada call;
// este helper centraliza el cast y evita el doble-cast en cada callsite.
//
// Solo usar en RPCs cuyo return type es conocido y simple (boolean, number,
// string, o un objeto plano con shape estable). Para arrays con joins,
// preferí definir el tipo explícito en la migration y usar narrow().

export function rpcAs<T>(data: unknown): T {
  return data as T;
}
