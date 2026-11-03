---
name: td-build
description: >-
  Take one JouveERP change from a description, a GitHub issue or a Linear issue to a draft PR end
  to end: td-plan (stops for the user's decisions and OK), td-implement, td-review, then push and
  open the draft PR with a visual body, tracking every stage on the plan page's progress bar.
  Conventional one-line commits, never merges, never writes to Linear. Use for "/td-build",
  "/td-build #123", "hacelo de punta a punta con td", "llevalo de la issue al PR", "take this from
  issue to PR with the plan page". The unattended chain with no user stops is /auto-build.
argument-hint: "<what to build, a GitHub issue (#123 or URL) or a Linear key>"
---

# td-build

One change, from issue to draft PR, with two stops for the user: the decisions and the plan OK.
Everything else runs on its own.

## Stages and the progress bar

The plan page carries a progress bar at the top (from `/td-plan`'s page, above the header):

`Research → Attack → Your decisions → Your OK → Build → Verify → Review → PR`

Each stage is done (accent), current (outlined, with "since HH:MM"), waiting on the user (warn), or
pending (neutral). Labels go through the ES/EN switch like the rest of the page. Republish the page
each time a stage changes, so the user can follow it from the link.

## 0. The goal

- Take it from the argument. A GitHub issue: `gh issue view <n> --comments` (or the GitHub MCP's
  `issue_read`). A Linear key: read it through `nav-linear` only if the Linear MCP is connected. A
  plain description is enough: Linear is optional in JouveERP and nothing waits on an issue.
- A named Linear issue still in Triage: stop and tell the user. Never create, move or comment on
  Linear issues, and never create or comment on GitHub issues; that is the user's.
- Work on the Linear issue's `gitBranchName` when there is one, otherwise `claude/<slug>` (or the
  `claude/...` branch the harness already assigned), created from `origin/main` if missing
  (`git fetch origin main && git checkout -b <branch> origin/main`). Never on `main`.

## 1. Plan → `/td-plan`

Run it through its decisions (the user answers them one at a time) and its attacker rounds. Then
mark **Your OK** as waiting and ask the user to approve the plan from the page, with
`AskUserQuestion` (approve / change something). Don't build without the OK.

## 2. Build → `/td-implement`

With the approved plan. Its commits are conventional one-line English messages (`type(scope): …`,
`(KEY)` only with a Linear key, no `Co-Authored-By`). If `/verify` fails after its 3 tries, stop
here: mark Verify as failed on the page and report.

## 3. Review → `/td-review` (fix path)

On the branch. Its fixes are committed the same way.

## 4. PR

- `git push -u origin <branch>`. The pre-push hook (`scripts/hooks/pre-push.sh`) runs the
  forbidden-words check, the migration checks, `pnpm lint`, `pnpm typecheck` and `pnpm test`; let it
  run. Use `--no-verify` only when it fails for a reason outside this change (for example eslint
  scanning other agents' worktrees under the agent worktrees folder), after running the same checks
  yourself, and say so in the report.
- Write the PR body following `.agents/skills/nav-github/SKILL.md` §PR descriptions: the
  `.github/pull_request_template.md` sections in Spanish, starting with `## Resumen` (2–4
  sentences), `## Cambios` (a handful of one-line bullets), the template's checklists ticked
  (`## RLS / permisos tocados`, `## Seguridad`, `## Migración`, `## Impacto AFIP / fiscal`,
  `## Uso de IA`, `## Verificación`, `## Cómo probar`), and `## Follow-ups` for what was routed out.
  A linked issue goes under `## Related` (`Closes #123`; a Linear key as plain text). Current state
  only, no run story, no Claude footer, no link to the private plan page. Keep it short (nav-github:
  ~25 lines plus `## Follow-ups`).
- **For a behaviour change**, open `## Cambios` with a Mermaid view of the behaviour, drawn on the
  case's worked example (its real screens, entities and amounts, made up but realistic):
  - `flowchart TB` with two subgraphs, `Hoy · <entidad>` above `Después de este PR · <entidad>`,
    joined by `today ~~~ after` so Hoy renders first; inside each, `direction LR`.
  - Actors rounded `(["Marta · finance"])`, data or what is handed over slanted `[/"…"/]`, outcomes
    square. Every arrow has a verb label. About seven nodes per subgraph.
  - The only colour is on outcomes, as a border: the wrong one today `stroke:#d92d20,stroke-width:3px`,
    the right one after `stroke:#079455,stroke-width:3px`. Dashed arrows for what a later PR does
    (name it).
  - A second small view only when the change has a lifecycle or order worth seeing (created with,
    removed with). The code-shape `diff` block, when it helps, goes under the diagrams.
  - Render each view with `npx -y -p @mermaid-js/mermaid-cli mmdc -i v.mmd -o v.png -b white -s 2`
    in the scratchpad and look at the image before posting; fix order and stray nodes once. If it
    cannot render (no network, no browser), post the Mermaid source unrendered and say so.
- Open it as a **draft** unless the user says otherwise: `gh pr create --draft --base main`, or the
  GitHub MCP's `create_pull_request` with `draft: true` where `gh` is not signed in. Title per
  nav-github: conventional English, under 70 characters, `[DESTRUCTIVE]` first for a destructive
  migration.
- Never mark it ready, never run the bot/CI gate, never merge. Offer `/auto-ship-gate` as the next
  step; run it only when the user says so.

## Final report

Reply in the user's language: the plan page link (all stages done), the draft PR link, the commits,
deviations from the plan, review result, and anything unverified or waiting on the user.
