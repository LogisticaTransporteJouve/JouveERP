# AGENTS.md — agent routing in JouveERP

Complements `CLAUDE.md`, which has the stack, the structure, the conventions and the commands. This
file points agents to the shared skills.

## Skills

Skills live in [Agent Skills](https://agentskills.io) format in **`.agents/skills/<name>/SKILL.md`**
(the canonical copy). Each one has a symlink at `.claude/skills/<name>`, which Claude Code discovers
on its own and Cursor finds through its `.claude/skills/` compatibility. A runtime without skill
discovery (for example Codex) routes from this table.

**The `description:` in each skill's frontmatter is the trigger that counts: read it there.** This
table lists only names and paths, so it does not go stale.

| Skill | Path |
|---|---|
| adv-planning | `.agents/skills/adv-planning/SKILL.md` |
| adv-research | `.agents/skills/adv-research/SKILL.md` |
| adv-review | `.agents/skills/adv-review/SKILL.md` |
| auto-build | `.agents/skills/auto-build/SKILL.md` |
| auto-implement | `.agents/skills/auto-implement/SKILL.md` |
| auto-ship-gate | `.agents/skills/auto-ship-gate/SKILL.md` |
| create-e2e-test | `.agents/skills/create-e2e-test/SKILL.md` |
| enforce-claims | `.agents/skills/enforce-claims/SKILL.md` |
| enforce-clean-code | `.agents/skills/enforce-clean-code/SKILL.md` |
| enforce-comment-value | `.agents/skills/enforce-comment-value/SKILL.md` |
| enforce-data-integrity | `.agents/skills/enforce-data-integrity/SKILL.md` |
| enforce-deploy-safety | `.agents/skills/enforce-deploy-safety/SKILL.md` |
| enforce-effects | `.agents/skills/enforce-effects/SKILL.md` |
| enforce-outcomes | `.agents/skills/enforce-outcomes/SKILL.md` |
| enforce-ports-and-adapters | `.agents/skills/enforce-ports-and-adapters/SKILL.md` |
| enforce-reach | `.agents/skills/enforce-reach/SKILL.md` |
| enforce-role-isolation | `.agents/skills/enforce-role-isolation/SKILL.md` |
| enforce-ui-state | `.agents/skills/enforce-ui-state/SKILL.md` |
| improve-text-md | `.agents/skills/improve-text-md/SKILL.md` |
| long-loop | `.agents/skills/long-loop/SKILL.md` |
| nav-github | `.agents/skills/nav-github/SKILL.md` |
| nav-linear (optional) | `.agents/skills/nav-linear/SKILL.md` |
| new-feature | `.agents/skills/new-feature/SKILL.md` |
| new-inngest-fn | `.agents/skills/new-inngest-fn/SKILL.md` |
| new-migration | `.agents/skills/new-migration/SKILL.md` |
| restamp-migrations | `.agents/skills/restamp-migrations/SKILL.md` |
| supabase-postgres-best-practices | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| tighten | `.agents/skills/tighten/SKILL.md` |
| verify | `.agents/skills/verify/SKILL.md` |

`.agents/skills/README.md` explains how they fit together, and
`.agents/skills/_shared/runtime/capabilities.md` how work is split into waves with or without
sub-agents.

To add a skill: create `.agents/skills/<name>/SKILL.md`, the symlink
`ln -s ../../.agents/skills/<name> .claude/skills/<name>` and the row in this table.

## Rules every agent follows

- Never commit or push to `main`; work on a feature branch and open PRs **as drafts** against
  `main`. Never mark a PR ready for review and never merge — the human does both.
- Conventional commits in English with no `Co-Authored-By` or any other trailer/footer.
- Never read `.env*` files other than the `*.example` ones; never run `supabase db push`,
  `supabase link` or a remote `db reset`. Do not start Docker or a local Supabase stack unprompted.
- Validate with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` (in that order, on a fresh
  container after `pnpm install`); `pnpm test:scripts` when `scripts/` or `.github/scripts/` change;
  `pnpm check:migrations`, `pnpm db:types:check` and `supabase test db` only when `supabase/` changes and
  a local stack is already running.
- The PR body follows `.github/pull_request_template.md`: it starts with `## Resumen` and ends with
  `## Follow-ups` for whatever is out of scope.
- Gates call `userCan(ctx.access, "<perm>")`; per-user denies live in `ctx.access` (see `CLAUDE.md`).
- Linear is optional: follow-ups go to the PR body's `## Follow-ups` section.
- `.claude/settings.json` denies the destructive and secret-reading commands above.

## Frontmatter

The portable core is `name` + `description`. The other keys are hints for Claude Code, and
`disable-model-invocation` is a Claude Code **security** key. The full contract is in
`.agents/skills/_shared/runtime/capabilities.md`.

## Cursor rules

`.cursor/rules/` repeats for Cursor the `CLAUDE.md` rules that always apply (commits, style,
migrations, Next.js feature slices).
