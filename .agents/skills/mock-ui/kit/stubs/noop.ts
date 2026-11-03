// Sentry and other side-effect clients: every property and call is a no-op.
const noop: any = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : noop), apply: () => noop });
export default noop;
export const captureException = noop;
export const captureMessage = noop;
export const withScope = noop;
