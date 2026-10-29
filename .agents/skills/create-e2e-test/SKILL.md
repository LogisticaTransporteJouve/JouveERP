---
name: create-e2e-test
description: Create a Playwright end-to-end test for a JouveERP page or user flow in `tests/e2e/<feature>.spec.ts`, reusing the existing auth setup and fixtures, with the PR's acceptance criteria as the oracle. Use when asked to write an e2e test, a Playwright test, or a browser smoke for a feature.
disable-model-invocation: true
---

# Create an E2E test (Playwright)

The suite lives in `tests/e2e/` and runs locally against an already-running stack (see `/verify`
§1); `playwright.config.ts` does NOT start the dev server. There is no e2e CI job today, so run the
spec yourself before pushing.

## What already exists — reuse it

- `playwright.config.ts` — `testDir: ./tests/e2e`, `baseURL` from `PLAYWRIGHT_BASE_URL` (default
  `http://localhost:3000`), one worker, a `setup` project then `chromium` with `storageState`.
- `tests/e2e/auth.setup.ts` — signs in at `/auth/login` with `E2E_USER_EMAIL` / `E2E_USER_PASSWORD`
  (default the seeded owner `tomas@jouve.test` / `Test1234!`), opens the sidebar, saves state to
  `STORAGE_STATE_PATH` from `tests/e2e/constants.ts`. Every spec in the `chromium` project is
  already authenticated — never log in inside a spec.
- `tests/e2e/fixtures.ts` — import `test` and `expect` from this fixtures module, never from
  `@playwright/test` (it hides the Next dev overlay that intercepts clicks).
- Examples: `tests/e2e/invoices.spec.ts` (UI smoke, no AFIP), `tests/e2e/invoices-emit.spec.ts`
  (gated on `RUN_AFIP_E2E=1` with `test.skip`), `tests/e2e/login.spec.ts`, `tests/e2e/chat.spec.ts`.

## Before writing

1. **Oracle = the PR's acceptance criteria** (the plan's success criteria or the PR body). Cite the
   bullets you cover in a comment at the top of the spec; one `test()` per behaviour.
2. Read the page/component source: route under `app/(dashboard)/`, Spanish labels and roles,
   Dialog titles, the server action it calls and its permission.
3. Check the existing specs so you extend rather than duplicate.

## Rules

- File: `tests/e2e/<feature>.spec.ts`. Use `test.describe()` and `test.step()` for multi-step flows.
- Locators in priority order: `getByRole(…, { name })`, `getByLabel`, `getByText`, `getByTestId`
  (last resort). Never CSS selectors, XPath, `.nth()`, `.first()`, `.last()`.
- No `waitForTimeout()` — use auto-waiting assertions. No hardcoded hosts — `page.goto("/path")`.
- CRUD lives in a centered `Dialog` (`getByRole("dialog", { name: … })`), not a Sheet.
- Each test seeds what it needs through the UI and tolerates leftover data from earlier runs (unique
  names per run); no shared mutable state between tests.
- Anything that needs external credentials (AFIP homologación, an AI provider) is gated behind an
  env flag with `test.skip(!ENABLED, "<what is required>")`, like `tests/e2e/invoices-emit.spec.ts`.
- A permission flow runs as a lesser role: `E2E_USER_EMAIL=<user> E2E_USER_PASSWORD=<pw>` with a user
  prepared as in `/verify` §2; assert the module is hidden and the action refuses.

## Run it

```bash
pnpm test:e2e tests/e2e/<feature>.spec.ts
pnpm test:e2e:ui                      # debug interactively
```

Report the command, pass/fail, and which acceptance bullets the spec covers.
