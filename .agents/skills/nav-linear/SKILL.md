---
name: nav-linear
description: >-
  OPTIONAL in JouveERP (the repo does not require Linear; follow-ups live in the PR body). Navigate
  and create work in Linear via MCP only when the user asks or names a Linear issue — branch ↔ issue ↔ PR, review threads, and creating or
  shaping issues, projects, initiatives, views, and problem specs. Use for "what issue is this
  branch", "find the Linear ticket for this PR", reading Linear data through the MCP, creating or
  improving a Linear issue/project/initiative/view, routing an issue to a project, or
  sweeping/triaging a backlog toward the clean-project standard.
---

# Linear: navigate, create, maintain

Linear MCP tools are usually exposed as `mcp__linear__*` or `mcp__Linear__*` (e.g.
`get_issue`, `get_diff`, `get_diff_threads`). In other harnesses the same tools may be exposed
under a server such as `user-Linear` — use whichever prefix is registered. The examples below
write `mcp__linear__` for brevity.

> **OPTIONAL in JouveERP.** The repo does not use Linear as a gate: branches and PR titles carry no
> issue keys, no PR is blocked on a Linear link, and findings routed out of a change go to the PR
> body's `## Follow-ups` section. Use this skill only when the user asks for Linear work, names a
> Linear issue, or the Linear MCP is connected and the user wants an issue filed. If the MCP is not
> connected, say so and fall back to `## Follow-ups` — never block on it.

**Workspace facts — discover, don't assume:** resolve the team with `list_teams` (or take the one
the user names) and use its key (issues look like `<KEY>-12`). Write titles, descriptions and
comments in the language the workspace's existing issues use (JouveERP's team works in Spanish from
Argentina). Repo: `LogisticaTransporteJouve/JouveERP`, base branch `main`.

Three parts:

1. **Navigation** — moving between branches, issues, and PRs.
2. **Creating work** — issues, projects, milestones, initiatives, views.
3. **Maintaining** — what a clean project looks like, and the sweep discipline that gets and keeps it there.

**This is a living artifact.** When a session surfaces a new failure mode, gotcha, or rule,
fold it into the relevant section IN PLACE (refactor, don't append changelogs) before the
session ends. A lesson that contradicts a line here wins — update the line. **Exception: an edit that would weaken or remove a guardrail (an owner-gate, a
"never", an approval requirement) needs the user's explicit sign-off first**; everything
else is the agent's call. Deliberately repeated guardrail mentions are redundancy by
design — tightening this file never removes them.

**The confirmation rule, everywhere a gate appears below:** a user instruction is the
confirmation for exactly what it NAMES — don't re-ask for the named action ("create an
issue for X" authorizes that issue; "split project P into A and B" authorizes that split).
Two bounds: (1) a **generic ask** ("clean this up", "sweep it", "any smells?") authorizes
the pass and its reversible classification writes, never irreversible structure — container
creation, splits, and bulk auto-closures still need their concrete shape named by the user
or approved from your proposal; (2) absent any user ask, every gate holds — they exist to
stop the agent-initiated versions of these actions.

---

# Part 1 — Navigation

## Overview

- **Linear**: organization, discussions, and high-level reviews.
- **GitHub**: code-line comments and reviews.
- **Native-fields rule:** no MCP write fills Linear-native diff fields.
  `get_diff.linkedIssues[]` populates only from the GitHub↔Linear integration (branch key /
  PR-body reference); `get_diff.reviewers[]` only from the Linear review UI (`appUrl`) — a
  GitHub reviewer request notifies but fills neither. The MCP-verifiable ground truth is
  `issue.attachments[]`.

## Branch → Issue

Extract the Linear key from the branch name (`<team-key>-<number>`, case-insensitive):

```
git branch --show-current | rg -o '\b[A-Za-z]{2,4}-[0-9]+' | head -1 | tr a-z A-Z
```

`feat/abc-12-credit-notes` → `ABC-12`. JouveERP branches normally carry no key (`main`, `claude/...`, detached HEAD,
descriptive names), fall back to searching: the PR title/body for a key, then
`list_issues {query: "<branch words>"}`. A hyphen-digit tail can still fake a key
(`release-2024-fix`), so if the extracted key 404s on `get_issue`, treat the branch as
key-less and fall back.

Start with the issue plus its comments:

```
mcp__linear__get_issue { "id": "<KEY>-12" }
mcp__linear__list_comments { "issueId": "<KEY>-12", "orderBy": "updatedAt", "limit": 50 }
```

`get_issue` returns title, description, state, assignee, attachments.

## The Linear ↔ GitHub contract — only when the work has an issue

In JouveERP a PR without a Linear issue is normal. When the user DID tie the work to an issue, keep
the link honest. (On a read-only lookup, report a missing link; don't write.)

- **A PR tied to an issue is linked to it** — attached via `save_issue { links }` (mechanics
  below), since JouveERP branch names carry no key; verify `issue.attachments[]` carries the PR URL.
- **One issue = one coherent PR-chain.** A stacked set (`(N/X)` titles) on one issue is fine; two
  unrelated PRs on one issue means the issue is two issues — split it. Multi-sided splits stay one
  issue per independently shippable side, each with its own PR.
- **Status mirrors PR state** — In Review ⇔ live open PR; merged ⇒ verify in code, then Done
  (clean-standard #2 / Pass 1 own the procedure).
- **The ship gate does not require a linked issue** (`_shared/pr-readiness/manifest.md` A1 checks
  `## Follow-ups` instead); an overlapping open issue is only an advisory note.
- **Never merge a PR** — merging is the human's call, everywhere, under every mode.

**Linking mechanics:**
- Linking would be automatic if the branch name carried the issue key (`<team-key>-<number>`), but JouveERP branches do not — so attach the URL explicitly (below). PR titles carry no issue key (nav-github Mode 2 owns the title convention); mention the issue under `## Related` in the PR body instead.
- Always verify after opening a PR: `get_issue { id }` → `attachments[]` must contain the PR URL. Per the native-fields rule, do not expect `get_diff.linkedIssues[]` to reflect anything an MCP write did.
- If it did not auto-link (branch missing the key), attach the URL via:

```
mcp__linear__save_issue { "id": "<KEY>-27", "links": [{ "url": "<github-pr-url>", "title": "<pr-title>" }] }
```

`links` is append-only and the link appears in `issue.attachments[]` (session-verified) —
sufficient for the audit (the native diff↔issue link still needs the branch key /
`Fixes <KEY>-<n>` in the PR body, per the native-fields rule).

## Issue → PR

The GitHub PR URL lives in `issue.attachments[].url`. Then fetch PR metadata:

```
mcp__linear__get_diff { "urlOrId": "<github-pr-url>" }
```

`gh` is usually faster for raw PR data; use the Linear `get_diff` / `get_diff_threads` tools when
`gh` is unavailable or you want the Linear-linked view.

## Requesting review of a PR

JouveERP has no review rotation, so this is rare — only when the user
asks. Per the native-fields rule, no MCP write adds a reviewer to a Linear diff; the executable
path is the GitHub reviewer request (fires the webhook, notifies the reviewer):

```
gh pr edit <n> --repo LogisticaTransporteJouve/JouveERP --add-reviewer <github-handle>
```

- **Pre-check `gh pr view <n> --json reviewRequests` FIRST: if a reviewer is already
  requested, do NOT add a second — surface it instead.**
- **No default reviewer: if the user didn't name one, ask who before requesting.**
- Confirm it took: `gh pr view <n> --json reviewRequests`.
- Linear-native `get_diff.reviewers[]` stays empty until someone requests review from the
  Linear `appUrl` page — surface that URL if the user wants the native set filled too.
- Read review output with `get_diff_threads { urlOrId: <pr-url> }` (returns the PR
  discussion / review threads).
- Resolve a reviewer's handle from the PR itself (`gh pr view <n> --json reviews,reviewRequests`), not from a remembered mapping.

---

# Part 2 — Creating and shaping work

**Never create an issue, project, milestone, or initiative on your own initiative — only on
the user's ask (see the confirmation rule above) — and never without a deep read of
existing work to rule out duplication**: search across ALL statuses (including
done/cancelled/backlog), not just the open items.
If something close already exists, surface it and propose updating it instead.
Concretely: `list_issues {query: "<distinctive words>", limit: 50}` searches
titles+descriptions across states but favors recent — run 2–3 phrasings before concluding
nothing exists.

Classifying an *existing* issue — project, milestone, labels, priority (except Urgent — the agent proposes, the owner sets), relations — is the agent's call when confident (a freshly created issue still lands in Triage for human validation); when not confident, PARK/FLAG it for the owner rather than guess a container. **Exception: issues sitting in the Triage lane — a triage run is propose-only end to end; see Part 3 §Triaging the Triage lane.** Creating or renaming containers — projects, milestones, initiatives — is always gated on the owner.

Before creating anything, pick the right container. Each level is defined by what it uniquely
possesses; no need for that property ⇒ one level down. Dates are NOT a discriminator — milestones
carry dates too.

- **Issue** — one pullable unit: one person/agent, one branch or small stack, startable today with a
  known done. Larger than one issue but smaller than a project → parent + sub-issues with `blockedBy`
  chains (hierarchy nests in issues, never milestones).
- **Milestone** — a checkpoint that exists only inside its project. If it would want its own lead
  or priority (fields a milestone cannot hold), it is secretly a project. This is the
  existence gate only — the two-question test (§Projects) stays the description standard.
- **Project** — its own charter (one-line done-condition, or an explicit ongoing charter), a lead,
  status updates.
- **Initiative** — a strategic outcome that survives its projects: groups (or credibly will group) ≥2
  distinct project charters, and shipping any one doesn't finish it. A sub-initiative is an initiative
  nested under one; same no-priority rule.
- **View** — a saved, reusable filter over existing work; a lens, never a container.

Escalation ladder — reach for the cheapest structure that carries the need: ordering only →
sub-issues; checkpoint visibility → milestone; independent charter → project; grouping multiple
charters → initiative (a strategy change; essentially never agent-initiated); just a lens → view.
An umbrella issue with ~10+ sub-issues and distinct workstreams → propose a project (owner-gated);
a "project" that is one PR-stack drains into a parent issue — both moves are link-safe.

Start from the problem, goal, or outcome — not the solution; keep the artifact high-signal and high-level. Don't add technical design or execution detail unless the context requires it, but never strip real technical context (affected files, named residual cases, failure modes, parent/prior-fix references) a reader needs. When improving an existing artifact, **refactor in place** — merge overlaps rather than appending. Omit any section that would be thin, redundant, or obviously AI-written.

## Issues

Confirm it should be an issue at all, then make it easy to understand, route, and act on.
Create with `save_issue { team: "<team>", title, description, ... }` — `team` and `title` are
the required create params; pass NO `id`. Title and description in the workspace's language.

- **Title** exposes the actual problem or outcome and is easy to search for later.
- **Description** lets a reader classify and route without hidden context: state the core problem in direct language, define the current scope boundary, add the few principles/constraints that materially shape the work, and state success in outcome terms.
- Use the write-problem-spec section (below — an in-doc method, not a callable tool) when the issue needs clearer problem framing. When it's driven by a user/feature request, pressure-test the signal before writing it up: record what the user actually did (the workaround, the abandoned flow, what it cost them) and how often it happens, not what they said they'd want. If the only evidence is a stated preference or a hypothetical, say so in the description instead of writing it up as validated demand.

**Routing (team)** — use the team the user names, or the workspace's single team if there is
only one. Never invent a team. The routing decision that matters is the
project (below).

**Placement (issue → project)** — goals and tie-breaks:

- A **feature** files to the project that owns the surface it builds (its product-area home).
- An **engine/model change** — anything altering a shared engine's model or computation basis — files with the engine, not the surfaces that display it.
- **Cluster consistency**: an issue sharing a root cause, subsystem, or incident with an existing cluster joins the cluster's home. Two tie-breaks: this outranks the surface pull below, but yields to the engine/model rule — a cluster spanning a surface defect and a shared-engine change splits along that seam.
- A **live user-facing defect** files where the surface/feature it breaks lives, even when the code fix lands elsewhere (weakest tie-break — yields to the engine and cluster rules).
- **Strip the AI**: classify an AI-flavored issue by the domain problem left after mentally deleting the AI. The assistant's runtime, chat route, tool set, and prompt plumbing (`features/ai/agent.ts`, `features/ai/registry/`, `features/ai/model.ts`) are AI-platform work; extraction-quality work belongs with Document Intelligence; a dev-only local driver, eval harness plumbing, or other dev-experience work is dev tooling, not AI-platform work.
- **Behavior-neutral cleanup** (dedup, dead code, naming, docs) scoped to one owning subsystem's internals stays with that subsystem; only cross-cutting hygiene with no owning subsystem goes to the codebase-health project. Work that reshapes a seam or shared **contract** (`lib/afip`, `features/ai/model.ts`, `lib/auth/permissions.ts`, shared `lib/` types) stays with the domain owning the contract, even when behavior is unchanged.
- **Deployed-environment integrity** (promotion, deploy drift, runtime capacity) and **pre-merge CI** (gates, test infra, dev environments) are different homes. An issue whose **deliverable** is a detection/alert, IaC pipeline, or eval harness files by that deliverable, not by the subject it inspects.
- **Security**:
  - Data exposure past a role boundary (a role-isolation break: an ungated action, RLS, grants, service-role paths) → the security project, even on a feature surface.
  - Auth/session plumbing that merely misfires or self-heals, no exposure → stays with the surface it breaks.
  - Within a domain, persist-vs-heal is the tie-break: bad state that *persists* → the integrity/security home; failures that *self-heal on retry* → the reliability home.
  - Dependency/CVE and hardening findings → the security project's open hardening bucket.
- **Platform vs provider — the provider-swap test**: mentally swap the named provider (AFIP's web service, an AI model, the BCRA rate feed, the mail provider) for another. Issue still exists → general-form work, files with the platform (the provider label just marks who instantiates it today). Defect exists only because of that provider's API behavior → the provider project. No shared code names a concrete adapter.
- **Finite vs standing**: work driving a container toward its done-condition files in the finite (migration/delivery) container; open-ended operational health work (reliability, pipelines, contract governance) files in the standing health container (Part 3's container law).
- **A review/deep-review companion issue follows its subject** — it lives wherever the issue it reviews lives, and moves when it moves.
- **Multi-sided splits are legitimate**: when one phenomenon needs independently shippable fixes in separate areas of the codebase, keep an issue per side, each filed where its code lives, stating the dividing line.
- **No orphans**: an issue that fits no project is a structure gap, not a terminal state. Before accepting homelessness, LOOP: re-read every project charter for a widening fit, check where labeled/related siblings live (precedent beats first impressions — an issue often belongs where its labeled or related siblings already live, via a charter clause you skimmed past), and only after several genuine loops fail may an issue go without — propose widening a charter, renaming a container, or adding an open-ended capture project (owner-gated) instead. "It's just polish" does not excuse skipping the loop.

**Metadata** — a newly created issue goes into **Triage** by default: the workspace's intake lane, where a human validates and routes it (Linear's built-in Triage Intelligence suggests labels/project/priority there). Only start it in a non-triage status when the same flow is also executing the work (e.g. you file it and immediately open its PR). Set priority (Urgent only as an owner proposal), project, and relations whenever determinable with high confidence; treat missing clarity here as something to resolve or flag, not a reason to leave the issue loosely classified.

**Labels** — add the full relevant existing label set; prefer canonical labels over inventing new ones, and treat missing obvious labels as a quality problem.

- One best-fit **Type** label (use the workspace's existing type labels; the canonical shape is): `Type › Bug` for incorrect behavior/regressions, `Type › Feature` for net-new user-facing or system capability, `Type › Polish` for small quality improvements with limited behavior change, `Type › Refactor` for internal cleanup that preserves intended behavior.
- Most specific **product-area** label that fits (e.g. facturación, tesorería, contabilidad, RRHH, flota, asistente IA); avoid a catch-all "misc" label unless nothing else fits.
- Provider labels are the sanctioned home for provider names — but drop the provider label when an edit removes the provider-specific leg from the issue (a stale provider label misroutes the next placement decision).
- **`AI good fit`** means the issue is a strong candidate for near-fully-autonomous implementation by a coding agent. Suggest it only when ALL four hold: the problem is specific, success is easy to verify, the likely change is contained, and the downside of a mistaken first pass is low. A fix that fans out across many consumer files, or needs a harness driven, fails "contained". Do NOT suggest it merely because something seems small, nor when the issue is underdefined, cross-cutting, sensitive, product-judgment-central, or likely to uncover architecture questions during execution. **Never** for auth, permissions/RLS, security, privacy, money/accounting/fiscal correctness, incidents, major refactors, or architecture changes.

Match the workspace's existing triage and classification patterns rather than inventing new ones.

## Projects

Start from one project unless there's a clear reason to split.

- **Name** in the workspace's language, matching existing projects, capitalized consistently.
- **Team** is the team the user named.
- **Icon** — a built-in icon matching the purpose and nearby conventions. No emojis. Invalid icon names 400 the whole create — have a fallback ready ("Heart", "Book", "Rocket" are known-valid).
- **Description** holds purpose, scope, phase/version framing, boundaries, non-goals, and success criteria — only where they clarify naturally. Concise and decision-oriented; not the home for every supporting detail.
- **Milestones** for meaningful delivery stages/checkpoints; put execution into issues assigned to milestones. Prefer smaller milestones when sequencing and progress visibility matter.
- **Every milestone gets a description of 1–2 lines** answering two questions: *is this done?* and *does my issue belong here?* A milestone is one of two shapes, both valid: it has a **reason to be done** (state the observable done-condition) or it is **deliberately open-ended** (state what collects here, plus "Ongoing"). Never execution detail or solution design. A missing description, or one that just restates the title, is a defect.
- **When two adjacent containers could each claim an issue class, write the routing rule into BOTH descriptions as mirrored boundary clauses** ("owns X; Y files with <sibling> instead"), so whichever one someone opens first carries the rule. Applies milestone↔milestone and project↔project.
- **Sequential milestones are named `MX — <name>`.** Most projects' milestones are parallel thematic workstreams and stay unprefixed. When they instead form a *gated sequence* — each can only meaningfully start once the previous is done, and finishing the last means the project is done — number them `M1 — Spec`, `M2 — Dark foundation`, … A good reference shape for a new source adapter is Spec → Dark foundation → Conformance → Runtime plumbing → Activation. Rules: number only the spine (open-ended buckets stay unprefixed and sort after); two milestones is enough if genuinely gated; test against reality before numbering (a later milestone well ahead of an earlier one means they are not gated); prefer `MX` over `Phase N`; don't zero-index. Renaming is safe — it never re-keys or breaks links.
- **Target dates only on finite containers.** A project or milestone with an open-ended charter must not carry a target date — that date is a lie that erodes trust in all the other dates. A project mixing finite and open-ended milestones may date the finite ones; the project-level date is only honest once the open-ended content is split out (Part 3's container law).
- **Structure follows the owner's model and the real work — never precedes it.** When two containers are effectively the same thing, merge — the project unit is "one coherent body of work," not an abstract surface/capability boundary (owner-gated).
- **Sizing**: small projects carry minimal or no milestones; end-of-life projects get zero new structure (drain and close); pre-spec projects get zero milestones; big ambiguous domains get a scoping phase, not invented ladders; infra/compliance/security projects stay deliberately lean (~two milestones). An empty milestone is kept only when it encodes roadmap intent; superseded or speculative empties are retired (owner-gated).
- **Layer encapsulation — HARD RULE:** an initiative description never names projects; a project description never names milestones; a milestone description never enumerates specific issues. Downward references are the violation (a child may reference its parent or a sibling — naming a *sibling project* in a boundary clause is encouraged). If a milestone description enumerates feature items, each becomes a REAL issue and the description is cut back to 1–2 lines. Enforce on every create and edit — no grandfathering (Linear history preserves old text; detail lives in issues).
- **Project updates** for ongoing progress, risks, and stakeholder communication.
- Prefer one explicit **lead** when there's a clear owner.
- Use **linked documents** for detailed frameworks, taxonomies, and reusable models that would make the description heavy; a **separate follow-up document** for beyond-scope work you want visible without broadening the project.
- Use **initiatives** only when multiple projects need grouping under a broader goal.

## Initiatives

Use an initiative only when the work is a broader goal grouping multiple projects over time.

- Start from the problem, goal, or strategic outcome; keep it high-level (per the Part 2 opener). No issue-level breakdown unless the context requires it.
- **Name** in the workspace's language, capitalized like existing projects; **description** decision-oriented and easy to scan.
- Prefer one explicit **owner**; set status, target date, and labels when determinable with high confidence. Labels for cross-cutting strategic categories (product line, region, company goal, planning period).
- **Initiatives carry no priority.** Ranking them is a deliberate planning act, not a queue; sweeps leave the all-None state alone.
- **Sub-initiatives** only when a larger goal genuinely benefits from nesting.

## Views

First inspect existing views in the relevant area and mirror their structure, specificity, and metadata patterns. Keep the view general and reusable.

- **Parent** — the user's team unless the view is genuinely workspace-wide.
- **Name** short and consistent with nearby views; **description** states what it surfaces; **icon** built-in, no emojis.
- **Filter** properly scoped to the intended project/label boundary; don't accidentally include unrelated workspace items.
- Before finishing, sanity-check that parent, filter scope, title, description, and icon all align with the same intended audience.

## write-problem-spec

Write the problem clearly before writing about solutions, from the perspective of the problem owner.

- The main spec covers: what's happening, why it matters, who it affects, what's in and out of scope, what success looks like. Prefer principles, boundaries, risks, and desired outcomes over implementation detail.
- Clear, plain, high-signal language; decision-oriented — a reader should grasp problem, boundary, principles, and success without reading every supporting document.
- One current delivery scope; beyond-scope work in a follow-up document; detailed frameworks/examples/mappings in linked documents.
- When editing an existing spec, refactor in place: merge overlaps, keep the structure coherent. Main spec holds the current problem framing; linked documents hold reusable models. Don't write future possibilities into the main spec unless they're current scope.

---

# Part 3 — Maintaining: what good looks like

## The clean-project standard

A project is CLEAN when every one of these holds. This is the target state every
maintenance pass moves toward, and the checklist an "any smells left?" audit runs against:

1. **Every live issue's premise is verified** — the defect/need it describes still exists on
   the current default branch, checked in code, not assumed from the description. Stale
   claims inside a still-valid issue are rewritten in place.
2. **Status matches PR reality** — In Review ⇔ live open PR; In Progress ⇔ actively worked;
   Done ⇔ verified in code. (Pass 1 below is the procedure.)
3. **Ready = fully scoped, Backlog = unscoped only** (definitions in Pass 4). This lifts
   to the project level: **a project is strictly ready only when NO issue sits in Backlog
   except ones genuinely awaiting scoping** — every remaining Backlog issue must say what
   scoping it waits on.
   **Triage is empty at rest** — it is a transient intake lane; fresh arrivals and
   deliberate reopens pass through it, they don't live there.
4. **Every issue has a milestone** (unless the project carries none), and every milestone
   description passes Part 2's two-question test with mirrored boundary clauses on adjacent
   containers. In a milestone-free project, none is correct. Otherwise **a milestone-less
   issue is a diagnostic, not a tagging gap**: either the issue is in the wrong project
   (most common — check placement first), or the milestone structure is missing a real
   workstream. Resolve the cause; don't force-fit into the least-bad bucket.
5. **Finite and standing work live in separate containers — the container law.** A project
   whose charter has a done-condition contains only closable work and may carry a target
   date; standing workstreams live in a never-closing health project with no date. A
   project mixing both cannot honestly carry a date and will never close as scoped — split
   it per §Container splits.
6. **No duplicates; overlaps are codified.** Strict duplicates consolidate via
   `duplicateOf` (mechanics under Terminal-state discipline). Real-but-partial overlaps get
   a `relatedTo` link plus a one-line boundary in each description ("this owns X; that owns
   Y; whichever lands first builds the shared piece").
7. **Priority per §Issue priority** — five values, evidence-classified; issue priority is
   absolute in the pull queue and never duplicates the Bug label. The smell is an Urgent
   that is unstarted with no modeled blocker and no live-harm floor.
8. **Labels per Part 2 §Labels.**
9. **Companions travel with their subject** — per Part 2 §Placement; a review companion
   moves with the issue it reviews.
10. **Closed history is welcome, not noise** — Done/Canceled issues stay where their live
    siblings live. Emptied legacy milestones (after a container split) are deleted or left
    as archive; either is fine, but they must contain nothing live.
11. **The project's own status is honest** — project status (Backlog / Planned / In Progress
    / Completed / …) matches its issues: any started or in-review issue ⇒ In Progress; a
    fully-shipped scoped charter ⇒ Completed, not idling. A "Backlog" project with live work
    is a defect the pass fixes. Priority/status/date coherence lives in §Project priority.

## Issue priority

Impact classifies; time attaches only through real dates (`dueDate`), never per-tier SLAs.

- **Urgent** — drop-current-work. Legal in exactly three states: started; blocked *itself* with the
  blocker modeled (`blockedBy`, or a concrete unmerged PR/deploy gate named in the body) — that an
  issue blocks *others* is never grounds for Urgent, the unblocked head-of-chain enabler is High; or
  active production harm per a floor. **The agent proposes Urgent; only the owner sets it** — single edits and
  sweeps alike. A pending proposal holds its floor tier (≥ High), is labeled so it surfaces once
  not per-sweep, and escalates after 7 days on a floored issue. Unattended runs record
  "awaiting human: Urgent proposal" and move on.
- **High** — a live defect (evidence rule below), a floored issue, the unblocked head-of-chain enabler
  of a committed project (committed := In Progress ∧ priority ≥ High). Agent-settable when confident — one issue at a time on its own
  evidence, never a bulk apply.
- **Medium** — latent defect (the default for verified-but-unsignalled bugs) or scoped non-bug enabler.
- **Low** — cleanup/polish; pulled opportunistically, no promise.
- **None** — legal only in Triage or unscoped Backlog; on a Ready/started issue, classify it.

**Live vs latent is evidence, not vibes.** Live = any of: (a) a user signal — a reported
symptom quoted or linked in attachments or body (read titles/body); (b) a cited error/analytics signal
(Sentry, logs) or incident; (c) owner assertion; (d) an agent-verified root-cause reachable in
production AND on a user-facing path or corroborated by (a)/(b). A verified prod-code bug with no signal defaults Medium and promotes when a signal appears.
Reachability undecidable → take the lower tier and flag.

**Moves are asymmetric.** Promote on new evidence (agent call up to High; Urgent always a proposal).
Never demote for evidence-absence — demote only on affirmative contradiction: the premise fails a
Pass-3 re-verify, the mechanism is no longer reachable (removed/flag-gated), a floor's predicate no
longer holds, or the blocker premise is gone.

**Floors (override the intrinsic tier; security > financial > deadline):**
- Security: role-boundary (role-isolation) or credential exposure ⇒ at least High even latent; reachable in production ⇒
  propose Urgent.
- Financial correctness: wrong numbers (invoice totals, IVA, balances, aging, journal entries, a CAE'd voucher) rendered on a user-facing production surface ⇒ propose
  Urgent; reachable-but-latent/flag-gated/preview ⇒ High; internal-only surfaces ⇒ intrinsic tier.
- Deadline: date-decaying work (e.g. a tax-season deadline, a provider deprecation, a demo) must carry `dueDate`; ≤ 7 days ⇒
  at least High; imminent-and-critical ⇒ propose Urgent. Date passed ⇒ re-classify by intrinsic impact
  and surface re-date/de-scope/escalate; a cancel candidate only when the value fully decayed.
  Terminal-state discipline owns any close.
- Within a tier: dated issues pull ahead of undated, soonest `dueDate` first.

Priority never encodes type (Bug label's job), effort (estimate's job), or stack order (`blockedBy`'s
job — a blocked dependent holds its own intrinsic tier, never the chain head's). No Type is confined to
a tier: a dated, imminent deadline Feature floors to Urgent, a verified Bug with no signal sits at Medium.

**Audit checks** (relations need per-issue `get_issue {includeRelations}` — not bulk-queryable; never
key any check on `updatedAt`; `startedAt` on a born-In-Progress or bulk-flipped issue records the
flip, not work — confirm against `stateHistory`):
1. `Urgent ∧ unstarted ∧ no blocker ∧ no floor` → surface same-day: start-or-demote, owner's call. A
   floored unstarted Urgent surfaces as escalate/assign instead — never demote for being unstarted.
   Never flip status to satisfy a check.
2. `Urgent ∧ unstarted ∧ body names a PR/issue key as blocker` → resolve that key's live state; if
   merged/Done, surface "blocker stale — re-classify". Model blockers as `blockedBy` wherever a
   blocking issue exists.
3. `Urgent ∧ no impact case` (no Bug/security/financial-area label ∧ no `dueDate` ∧ no user
   signal) → surface "what's the impact case?" — regardless of description length.
4. Modeled blocker now Done/merged → re-run the classifier; latent may now be live.
5. New live-evidence on a Medium/Low → promote per the classifier (singular, evidence-cited).
6. `None ∧ Ready-or-started` → classify.

If native Linear SLAs are ever enabled (owner decision), sweeps read the `sla*` fields and never
recompute clocks.

## Project priority

Advisory context for exactly two things: which issue priorities get assigned inside a project, and
whose proposals win the owner's attention. **Issue priority is absolute in the pull queue** — no view
or agent re-orders issues by project tier.

- **Urgent** = the focal push, owner-declared, standing or finite. Intent ≤ ~2; adding one means
  naming what it displaces. The sweep notes the count, nothing more.
- **High** = committed and being worked. `High/Urgent ∧ status ∈ {Backlog, Planned}` → surface.
- **Medium** = active but interruptible; the standing-health default (not a ceiling).
- **Low** = intake only. A Low project's `targetDate` is not credible → surface: raise the tier or
  drop the date (date-clear is UI-only — hand the owner the click).
- **None** = Backlog/pre-spec only. `None ∧ In Progress` → surface with the decidable candidate
  (done-condition charter ⇒ High-candidate; standing charter ⇒ Medium); the owner picks.

**All project-priority writes are owner-gated** — the sweep surfaces, the owner sets. Project *status*
honesty stays the agent's fix (clean-standard #11).

**Date checks:** `targetDate` past → surface at any priority: re-date or de-scope, owner's call, never
auto-close. `targetDate ≤ 7d` → surface only when it exposes an inversion — the project sits below
dateless higher-priority projects, or its priority is < High; an on-plan In-Progress ≥High project
approaching its date is not a finding. An Urgent project with a stale or At-risk status update is the
dilution smell — read project status updates (per-project enrichment), not the list query.

## Operating doctrine — how to run a maintenance pass

**Iterate; don't aim for perfect in one pass.** Run the same issues repeatedly, each pass
leaving them cleaner: first fix statuses, then duplicates, then verify premises in code,
then split containers. Clean ONE project fully first and use it as the reference standard
for the rest.

**Looping is the default — scale it to scope.** Budget **a minimum of 2 loops ALWAYS — even
for a handful of issues — plus one more per 15 issues in scope** (18 → 3 loops; 45 → 5): at
least one fixing loop and one verification loop over what changed. Above ~15 issues, fan the
loop out as subagent waves (one auditor per project or milestone, findings-only, main context
writes) rather than grinding sequentially. Stop when a loop converges — a full loop finding
nothing agent-actionable, then one confirming loop — not when the count runs out.

**Mirror to disk before any bulk work.** Resolve the project first with
`list_projects {query, fields: [...]}` (narrow `fields` — the default set can 400 on
complexity). Then dump the whole working set to disk before any decision or write — every
issue via `get_issue` (full body + attachments), labels, statuses, milestones, projects,
and a manifest with scope + each issue's `updatedAt`. Decide locally, write to Linear
last as a batch — re-check `updatedAt` at write time and skip anything that moved. On large
sets, fan out as subagent waves per the looping rule above.

**Previews do not discharge the read.** The `list_issues` preview omits exactly what
matters: hidden PR attachments, landing gates ("safe only after PR #N"), hard boundaries
("do NOT do X — killed 3+ times"), and open design decisions. Every issue the pass will
judge gets a full `get_issue`.

**Verify in code, in both directions.** The repo's default branch is the referee — which
means a maintenance pass needs a checkout; without one, run a metadata-only pass and say so
in the report rather than faking code verification.
- *Looks open, actually shipped*: an issue can be resolved by a PR that never carried its
  key — search PRs by title words, not just the key, because a closed PR often has a merged
  sibling under a different number. Then confirm the fix in the code itself (a merged PR
  title is a claim, not proof).
- *Looks current, actually stale*: an issue can survive while its description lies — the
  named mechanism was rewritten, the blocker merged, the "not yet merged" stack landed.
  Still-real + stale-description = rewrite in place, not close.
- Grep the named files/symbols/strings against `origin/<default>`; check migrations for
  claimed schema; read the code's own comments (they often document the decision the issue
  asks for).

**Use dates as the staleness radar.** `createdAt` more than ~4 weeks old with no
substantive update is the danger zone — verify those first. A batch of issues whose
`stateHistory` flipped in the same second is one bulk action and may have reverted correct
states (restore them). `updatedAt` ordering finds both the neglected tail and the
recently-churned set worth re-checking.

**Terminal-state discipline.**
- **Done** is for finished work verified in code. **Canceled** is for obsolete/no-op/stale
  premise with cited evidence (file+symbol, covering Done issue, or the owner's call).
  NEVER Cancel finished work — that misrepresents what shipped.
- **"Symbol not found on the default branch" is NOT cancel evidence by itself**: an issue
  referencing files that don't exist yet is usually a valid follow-up to an in-flight PR —
  check the attached/linked PRs before treating a failed grep as a stale premise.
- **Duplicate beats Canceled** for consolidations, and the order is fixed:
  survivor = the more complete issue (tie-break lowest id) → write anything the survivor
  should inherit onto it FIRST → only then `save_issue {duplicateOf}` on the other, which
  auto-closes it. Marking before inheriting loses the richer body from the pull queue.
  A bulk consolidation (more than a handful of auto-closes) is surfaced as a list for
  owner verdicts before marking.
- When unsure, leave it live and record why. A reopened issue (Done → Triage after new
  evidence) is a human signal — investigate the residual, rewrite the scope to what
  actually remains, and only then judge it.
- Worth-doing calls belong to the owner: an issue that survives verification but might not
  be *worth doing* is the owner's cancel, not the agent's — surface the list, apply their
  verdicts.

**Edit in place; leave no tracks.** The edits ARE the description, labels, state, priority,
relations. Never append a changelog, never post an AI-authored comment. Two bounds: a dated
verification note inside the description ("verified against main <date>: …") is
acceptable when it corrects a stale claim; and "remove duplication" never licenses deleting
a hard boundary or landing gate ("do NOT do X", "safe only after PR #N") — those read like
redundant prose to a fresh agent and are exactly the content that must survive every rewrite.

**Search the whole workspace before declaring something missing.** A "missing" sub-issue in
an (N/M) sequence often exists in ANOTHER project, correctly routed by its deliverable
(a CI fix to the build project, a hardening fix to the security project) and parented back
to the umbrella. Check `parentId` children and adjacent-id issues before filing a gap.

## The milestone sweep — eight passes

The full hygiene pass for one milestone or project. Run in order — each later pass assumes
the earlier ones are honest.

**Pass 1 — Status vs PR reality.** Pull every started-state issue; establish each one's real
PR state from BOTH directions: match issue keys against all PR titles/branches
(`gh pr list --state all --json number,title,headRefName,state,isDraft`, regex
`[A-Za-z]{2,4}-\d+`) AND read `issue.attachments[]` via `get_issue` (a PR can be attached
without carrying the key; a closed PR can have a merged sibling under another number). Then judge:

- In Review requires a live OPEN PR. Closed-unmerged PR → back to Ready; nothing at all → Ready.
- In Progress with only MERGED PRs → **verify done in the code, then mark Done** — check the
  actual files/symbols on the default branch, don't trust the PR titles. Part numbering
  lies: a "(1/3)" PR's siblings may belong to OTHER issues; read the issue's own scope note
  before assuming remainder.
- **Check `stateHistory` for bulk-action damage**: same-second flips are one bulk action and
  may have reverted correct Done states — restore them.
- A "parked / reopen when X" preamble in the description means Backlog, not Ready
  (parked = awaiting an unscoped decision; distinct from scoped-but-gated, which Pass 4
  keeps Ready with `blockedBy`).

**Pass 2 — Umbrellas.** Scan descriptions for multi-part roadmaps (`umbrella`,
`tracking issue`, `PR \d`, `(N/M)`, `[N of M]`, `phase N`, `PR stack`). For each: do the
claimed sub-issues actually exist (check `parentId` children — including in OTHER projects;
watch for missing numbers in an (N/M) sequence)? An umbrella whose sequence is mostly
shipped gets its remainder carved into real issues (each with the verbatim scope, gates,
and review notes from the roadmap text) and is closed on that ground. An umbrella tracking
an **unmerged** mega-branch is different: the work isn't done, the call is
slice-or-abandon the branch — surface it, don't close it.

**Pass 3 — Relevance re-verify.** For everything that will sit in Ready: re-check the
claimed defect against the default-branch head per the verify-in-code doctrine (rot
concentrates in the status layer, not content). An issue whose blocker has since MERGED
gets its "do not start until X" clause rewritten to "unblocked".

**Pass 4 — Ready vs Backlog + relations.** House rule: **Ready = fully scoped**, even when
it cannot start yet — model every gate, including an unbuilt dependency, as a `blockedBy`
relation. **Backlog = unscoped only** (missing problem definition, pending product call,
unproven premise — the description says exactly what decision it waits on). The
project-level corollary: a Backlog residue is legitimate ONLY as needs-scoping; any issue
found there that is in fact scoped and clear is promoted to Ready during the pass, so a
strictly-ready project has zero scoped issues left in Backlog. Sub-issue
stacks get their internal ordering as blockedBy chains too. Verify relations stuck — the
API accepts the params but does not echo relations back.

**Pass 5 — Priority.** Apply §Issue priority: the evidence rule, the floors, and audit checks 1–6.

**Pass 6 — Labels.** Per Part 2 §Labels.

**Pass 7 — Placement.** Apply Part 2's placement rules — in particular the provider-swap
test and the container law — and treat every milestone-less issue as a placement
diagnostic (clean-standard #4): wrong project first, missing milestone second, force-fit
never.

**Pass 8 — Stack, companion & orphan hygiene.** Co-locate a sub-issue stack's milestones
with its parent; move review/deep-review companions with their subject (clean-standard #9).
An empty issue awaiting its author's input gets assigned to that author and the right
milestone — not silently Triaged over their head.

## Triaging the Triage lane — four-step protocol

The protocol for "triage the issues in Triage" — processing the intake lane itself.
**Propose-only: nothing moves out of Triage without explicit human approval.** This
overrides the confirmation rule's "reversible classification writes" allowance for this
lane — a generic "run triage" authorizes the read-and-analysis pass and the proposal
report, not the writes. Only after the owner approves (per issue or as a batch) do the
approved writes execute. Run all four steps per issue, in order:

**1. Read and understand — then explain from zero.** Full `get_issue` (+ relations,
comments, attachments — read the source evidence it links, not just the summary).
Then explain the issue to the owner assuming ZERO prior context: what surface this is,
what the reporter actually experienced, and why it matters — from basics, no codenames or
internal shorthand left undefined. The owner should be able to judge the issue from your
explanation alone without opening it.

**2. Falsify first.** The first attack vector is "this is NOT an issue": already fixed on
the default branch, working as intended, a misunderstanding, a duplicate, or evidence too
thin (stated preference, not observed behavior). Verify against code/PRs where checkable.
Only what survives falsification gets triaged as real. For survivors, sketch the solution
space with the **path of least resistance** first: the smallest change that resolves the
reported harm (config/copy/guard-rail beats feature beats refactor), and name the heavier
alternatives it was chosen over.

**3. Look under and around it.** Does the issue point at something underlying — a failure
class, a shared mechanism, a missing invariant — rather than a one-off? Would the same
root cause bite other code paths that should be folded into the same fix now (one PR per
failure mode: fold same-mechanism siblings in, split different mechanisms out)? Say what
you checked and what you'd fold in or spin off.

**4. Detailed triage — as a proposal.** Run the full classification (project,
milestone, labels, priority, relations, target status per the Ready bar) and report it
back as a per-issue suggestion table with reasoning — but write nothing that moves an
issue out of Triage until the owner approves. **Never set an assignee** in a triage run;
on High and Urgent proposals you may *suggest* one (with the reason they're the right
owner) for the human to set. Pre-approval, the only safe writes are additive
non-state facts (e.g. a `relatedTo` to a discovered duplicate candidate); when in doubt,
propose instead.

## Bulk triage to Ready

Promoting many backlog issues to a pullable "Ready" state — one issue's worth of Part 2's
rules, applied at scale, with the disk-mirror discipline above.

**Two sweep shapes, two scopes.** A *promote-to-Ready* sweep touches Backlog only. A
*project/milestone migration* sweep may touch any non-terminal state — project and
milestone changes never re-key. Both leave Triage/Done/Canceled/
Duplicate untouched (except container splits, which move closed history deliberately) and
skip any issue whose state changed under you. Classify from issue content, never the title
alone.

**The Ready bar (all must hold):** in the right team, title/description in the workspace's language · exactly one Type
label · a specific product-area label · a real priority set with intent (Urgent is proposed to the owner, never set by a sweep) · a self-contained
description (problem / scope boundary / outcome-shaped success, preserving real technical
facts) · relations/project set where inferable · premise verified still-worth-doing ·
status per Pass 4 (scoped-but-gated is Ready with `blockedBy`; an issue with an open PR by
its assignee is **In Progress**, not Ready).

**Done is out of a promote-sweep's vocabulary.** A completed spike/decision-record sitting
in Backlog wants `Done` — do NOT Cancel it; surface it for a human.

**Reconciling on a living backlog:** relations use stable UUIDs; when finding *new vs.
already-processed* work, diff by `createdAt` or UUID, never by a key you cached earlier.

## Container splits (finite vs standing)

The recipe for clean-standard #5, proven in production. **The split is owner-gated AS A
WHOLE** — the user names or approves it before step 1, because step 3 is effectively
irreversible (bulk history moves):

1. Create the standing project: no target date, "Ongoing — never closes" in the summary,
   boundary clauses in the description naming the finite sibling.
2. Recreate the open-ended milestones there verbatim (+ "Ongoing"). `save_milestone`
   CANNOT move a milestone across projects — it silently no-ops; recreate-and-reassign is
   the only path.
3. Move ALL member issues — live and closed — with `save_issue {project, milestone}` per
   issue, so the old milestones empty completely. Pass milestone by ID: two projects now
   have same-named milestones, and a name resolves ambiguously.
4. Rewrite the finite project's description to its narrowed charter + the mirrored boundary.
5. Verify with a fresh `list_issues` that no issue still references the old milestone ids;
   the emptied originals are then UI-deletable (no MCP milestone delete exists).
6. What MCP cannot do, hand to the user as one-click UI actions: clear a project target
   date, delete milestones.

## MCP mechanics & gotchas

- `save_issue`: create requires `team` + `title` and NO `id` param (not `id: "new"`).
  Milestone param is `milestone` (name **or ID** — use the ID whenever same-named
  milestones exist in multiple projects). `id`/`issueId` params accept the human key
  (`<KEY>-12`) or UUID; `team` accepts name, key, or ID.
- `list_issues` truncates descriptions and omits `attachments[]`; page with the returned
  `cursor`; it favors recently-updated issues. Only `get_issue` has the full body.
- `list_projects` with the default field set can exceed the API complexity limit — pass a
  narrow `fields` array.
- `save_milestone` cannot move a milestone across projects (silent no-op, observed); there
  is no milestone-delete tool (UI only).
- Project `targetDate` cannot be cleared via MCP — empty string is silently ignored,
  `updatedAt` doesn't even bump (observed). UI only.
- `duplicateOf` must be sent ALONE — pairing it with `state` can 400 or silently revert;
  it auto-transitions the state (there is no direct `state: "Duplicate"`). Re-fetch to
  confirm it stuck.
- Relations (`blocks`/`blockedBy`/`relatedTo`) are **append-only**; drop one with
  `removeBlocks`/`removeBlockedBy`/`removeRelatedTo`. **Converting a relation (e.g. block →
  related) on the same issue pair takes TWO calls** — a remove+add of the same pair in one
  `save_issue` fails and aborts the whole save. Relations are accepted but not echoed back;
  verify via `get_issue {includeRelations: true}`.
- Issue-mention chips (`<issue id=…>KEY</issue>`) regenerate from the mention node: a patch
  editing only the label text "succeeds" but changes nothing. After a re-key the rendered
  label can stay STALE — the fix is editing the surrounding text in the same `patch` call,
  which forces a re-parse and refreshes the chip to the current key.
- `save_issue` `patch` anchors must match the current content exactly once; a "successful"
  save whose response still shows the old text means the anchor sat in a regenerated
  region (see mention chips) — don't retry blindly.
- `create_attachment` is a deprecated base64 file upload, NOT a URL-attach tool — PR links
  go through `save_issue {links}` (Part 1).
- Icons: invalid names 400; keep a known-valid fallback. Known-valid: `Gears`, `Heart`,
  `Book`, `Rocket`. Known-invalid: `Pulse`, `Pen`, `Pencil`.
- Batch parallel `save_issue` calls freely for independent issues; serialize edits to the
  same issue (e.g. survivor inheritance before `duplicateOf`).
