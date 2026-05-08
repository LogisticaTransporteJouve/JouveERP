// No-op replacement for the `server-only` package in test runs.
// Importing the real package during a Vitest run throws because it asserts
// it is being bundled by a Server Component build. In tests we can just let
// the imports succeed.
export {};
