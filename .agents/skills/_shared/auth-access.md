# Auth & access — never stall on a login

Interactive authentication is a step you TAKE, not a message you send. Run the sign-in so the prompt
reaches the user and they complete it there. Don't report "you need to authenticate first", and don't
ask permission to sign in — just run it.

This covers the CLI credential stores below: you launch those flows yourself, including any browser
tab they open. Surface rather than drive only when the credential is a provider login session you
have no command to create — and say which one. (GitHub access may also come through the GitHub MCP
instead of `gh`; if the MCP is connected and working, no CLI sign-in is needed for what it covers.)

**Scope: the orchestrator.** No subagent can reach the user with a prompt — a read-only one is also
fenced off credential state (`subagent-constraints/hard-constraints.md`), and a writer simply has
nobody to prompt. So before spawning a wave that will need a credential, sign in to the CLIs below
(they persist credentials, so a later shell inherits them). A subagent that hits the wall reports it
upward; it does not authenticate.

## App secrets — never read them

JouveERP keeps its app secrets (Supabase service-role key, AFIP certificate and key, AI provider
keys, Sentry DSN, Inngest keys) in `.env.local` / `.env.production` on the developer's machine and
in the Vercel and Supabase project settings. There is no secret-manager CLI.

- **An agent never reads, cats, greps, copies or prints any `.env*` file** other than the
  `*.example` / `*.template` ones (`.claude/settings.json` denies it). The examples
  (`.env.local.example`, `.env.production.example`) are the source of truth for variable NAMES.
- If a step genuinely needs a secret the shell does not already have (a test that hits AFIP
  homologación, a script that talks to the hosted project), stop and ask the user to run it, or to
  export the variable in their own shell. Never ask them to paste the value into the conversation.
- A secret must never be echoed into a transcript, a log you keep, a commit, a PR comment, or an
  issue. If one shows up in output by accident, say so and do not repeat it.
- Adding a variable means adding its NAME to the matching `.env.*.example` and to every platform
  (Vercel, GitHub Actions secrets) — the value is the user's to set.

## Probe first, sign in only where the probe fails

The CLIs persist credentials to disk, so a later shell — and a subagent — inherits them. Probe each
with a command that makes an authenticated API call, and sign in only where it comes back failing:

```bash
gh auth status >/dev/null 2>&1           || gh auth login
supabase projects list >/dev/null 2>&1   || supabase login    # only for hosted-project reads
vercel whoami >/dev/null 2>&1            || vercel login      # only if a step needs Vercel
```

Probe with a call that hits the provider, not one that only reads the local store: a revoked or
expired token still sits on disk and looks like a session, so a local-only check would skip a
sign-in that is genuinely needed. Probe first because a needless sign-in can leave the user on a
different account than they started on.

The probe is also what tells you WHICH thing failed. If it passed and the real command still failed,
the problem is not authentication — don't re-prompt for it. If the probe itself still fails after a
sign-in, the user most likely missed the prompt: run the sign-in once more. (The CLI not being
installed is neither — report it, with the install command.)

Local development (`supabase start`, `supabase test db`, `pnpm db:types:check`) needs no sign-in at
all; only commands that reach the hosted project do. Never `supabase link` and never
`supabase db push`: migrations reach production only through the `deploy-migrations` job of `ci.yml` on merge
to `main`.

## Running an interactive sign-in

Any of these commands can outlive a default Bash timeout, so raise the tool `timeout` — and do NOT
background it, since a detached process cannot receive the input you are waiting for. Only if the
prompt genuinely cannot reach the user do you surface it, with the exact command to run.

⚠️ **Unattended, do NOT start it at all.** With nobody at the terminal there is no prompt to
complete, and "surface it" has no destination — you would burn a raised timeout on a wait that cannot
end. Check the mode first (`.claude/skills/_shared/night-shift/detect.md`). If it is ON:
record `AWAITING-HUMAN: <the exact sign-in command>`, treat that credential's work as a dead track,
and **keep working every track that does not need it**. Never spend the timeout, and never retry.
