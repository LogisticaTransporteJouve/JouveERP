// Chainable stand-in for the browser Supabase client: every call chains, every await resolves empty.
const chain: any = new Proxy(function () {}, {
  get: (_t, k) => k === "then" ? (res: any) => res({ data: null, error: null, count: 0 }) : chain,
  apply: () => chain,
});
export const createClient = () => chain;
export default chain;
