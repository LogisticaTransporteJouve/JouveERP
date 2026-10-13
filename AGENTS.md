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
| enforce-clean-code | `.agents/skills/enforce-clean-code/SKILL.md` |
| enforce-comment-value | `.agents/skills/enforce-comment-value/SKILL.md` |
| enforce-ports-and-adapters | `.agents/skills/enforce-ports-and-adapters/SKILL.md` |
| enforce-role-isolation | `.agents/skills/enforce-role-isolation/SKILL.md` |
| nav-github | `.agents/skills/nav-github/SKILL.md` |
| nav-linear (optional) | `.agents/skills/nav-linear/SKILL.md` |
| new-feature | `.agents/skills/new-feature/SKILL.md` |
| new-inngest-fn | `.agents/skills/new-inngest-fn/SKILL.md` |
| new-migration | `.agents/skills/new-migration/SKILL.md` |
| supabase-postgres-best-practices | `.agents/skills/supabase-postgres-best-practices/SKILL.md` |
| tighten | `.agents/skills/tighten/SKILL.md` |

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
- Validate with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; add `pnpm db:types:check`
  and `supabase test db` (once `supabase/tests/` exists) only when `supabase/` changes and a local stack is already running.
- Linear is optional: follow-ups go to the PR body's `## Follow-ups` section.
- `.claude/settings.json` denies the destructive and secret-reading commands above.

## Frontmatter

The portable core is `name` + `description`. The other keys are hints for Claude Code, and
`disable-model-invocation` is a Claude Code **security** key. The full contract is in
`.agents/skills/_shared/runtime/capabilities.md`.

## Cursor rules

`.cursor/rules/` repeats for Cursor the `CLAUDE.md` rules that always apply (commits, style,
migrations, Next.js feature slices).
