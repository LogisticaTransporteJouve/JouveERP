---
name: tighten
description: >-
  Compress verbose text into minimal clear text — necessary and sufficient, self-contained, plain,
  leading with the answer. Use when asked to tighten, compress, shorten, condense, "dry it", "cut
  the fluff", "make it concise", or on a PR description, commit, plan, status summary, handoff, or
  external message (PR comment, Slack, email, issue), including a long draft you are about to send.
---

# Tighten

Compress text to **minimal clear text**: necessary and sufficient, self-contained, plain, leading with
the answer. Process verbose drafts — yours or the user's — into the form they want to read, send, or
commit.

## What "tight" means

**Necessary and sufficient:** every word and fact is load-bearing (necessary), nothing the reader needs
is missing (sufficient). The hard constraint is clarity; brevity serves it — as short as possible before
it loses substance. A shorter version that drops a load-bearing fact is a failure. Cut fluff **and** keep
substance.

**Minimal = least reader effort, not fewest characters.** Structure that lowers effort — bullets for
parallel items, **bold** on scanned labels, numbered options to choose from, a line break between
thoughts, a ✅/❌ verdict — is part of *clear* and is free; spend markdown wherever it buys clarity.
Every word, fact, and mark earns its place by lowering reader effort, or it goes — decorative emoji are
noise.

**Never ship a first draft.** Draft hard → compress → output. Existing text is your draft; run the loop
on it.

## The loop

**Level — default medium.** Switch only on an explicit level word: "low"/"light" or "high"/"to the
bone". Never infer level from soft phrasing ("tidy", "clean it up", "a bit shorter") — those stay medium.

- **low** — one pass, no panel: strip the obvious (hedging, filler, leakage, dead formatting), fix the
  clear wins, but keep structure, order, and voice. Don't re-lead or convert prose to lists unless broken.
- **medium (default)** — full loop: restructure, re-lead, shape to necessary and sufficient.
- **high** — medium's content cut to the bone. The lever is word count, not formatting: keep free
  structure (bold, glyphs, lists), make words as few as possible — fragment sentences, drop connectives —
  but keep every load-bearing fact and the one example. Must read **visibly shorter than medium**; if the
  same length, you reformatted instead of cutting — redo. Stop at the last fully clear version; never
  lossy or grammar-mangled.

### 1. Inventory what must survive

Name the **load-bearing spec** before cutting — what you'll grade candidates against. Without it,
compression goes lossy.

- **Artifact + audience.** A commit subject, an 11-word reply, and a PR description get different lengths
  and registers. Is the reader *inside this session* or *cold*? A cold reader (anyone external) sees only
  what they wrote plus the visible code.
- **What must survive:** the ask/answer; the one concrete example; the *why* (not just the conclusion);
  any before→after delta; the honest arc (what changed or dropped).
- **Target length.** Match the audience — an 11-word question gets ~30 words back, not 95. A real change
  earns a real PR body; a trivial one earns a line.
- **Leakage to strip** (external only): anything needing session context — "Took this deeper", "after
  careful analysis", "the plan", "earlier feedback flagged", defenses of unquestioned things, pointers to
  plan files / prior sessions, over-formal pings for a casual CC. Also *how you learned* a fact
  ("confirmed via a local replay", "after digging") — state the fact, not your method.

### 2. Fan out candidates

> **Runtime:** this step assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: produce the candidates serially in one context, same standard), see `.claude/skills/_shared/runtime/capabilities.md`.

Spawn a small panel of agents (varied models/efforts), each producing one compressed candidate. You
curate, not author. Give each: the source, the load-bearing spec, the style below, the target length.
Keep them encapsulated so your phrasing doesn't anchor them; bias them to cut harder than you would —
adding a lost detail back is easier than spotting bloat you're attached to.

Vary across three lenses to harvest from:

- **conservative** — trim wording, keep structure;
- **aggressive** — cut to the bone;
- **reframe** — restructure, re-lead, find a cleaner example.

Diversity is the three lenses, **not** the model tier. Telling load-bearing from filler is high-judgment
work, and the aggressive cut is hardest — staff capable models (Sonnet/Opus); if you vary tier, the
strongest takes the aggressive cut, never the weakest. Each agent returns its candidate plus one line:
what it cut, what it kept.

**Scale the panel to the artifact.** A two-line Slack reply needs draft → compress → review inline, maybe
one second opinion. A PR body, plan, or long status summary earns the full panel. Four agents on one
sentence breaks the same rule you're applying.

### 3. Curate critically

Don't pick a winner. Each candidate is a **bag of decisions** — how it opened, grouped, phrased, what it
cut. Judge each on merit and assemble from the survivors; the best final often matches none of the three.
Nothing comes in unexamined — agents over-cut, flatten nuance, and drop a load-bearing fact while
sounding confident. Rebuild against the spec:

- **Sufficient?** Every must-survive item there — example, why, delta, ask?
- **Necessary?** Anything the reader doesn't need? Cut it.
- **Self-contained?** (external) Reads cold, no leakage tells?
- **Plain?** Jargon and idioms swapped for literal words — "starts a workflow" not "enqueues", "doesn't
  fix the real problem" not "papers over it".
- **Leads with the answer?** Verdict first, nuance after.
- **Structure pulling its weight?** Each mark lowers effort, and nothing that would is missing (no wall
  of prose where a list belongs).

A change must leave the text **simpler or equal** — a true-but-neutral edit isn't worth making. Ties on
clarity → keep the shorter.

**Compress only — don't edit substance.** Tighten rewords and restructures; it doesn't fact-check or add
claims. Before output, scan the source once for a claim that looks wrong or inconsistent (a number, a
name, a contradiction). Found one? Keep it verbatim and flag it in the note — never correct it in place.

### 4. Output

Show the compressed text for approval — whenever a human is in the loop, even when you'll then apply it.

⚠️ **Autonomy — MODE CHECK.** Read `.claude/skills/_shared/night-shift/detect.md` (resolve it from the repo root) and follow it
(`cat "<your scratchpad>/night-shift.state"` — substitute your real scratchpad path from your system
prompt; `$SCRATCHPAD` is **not** a set variable, and **do not add `2>/dev/null`** — both turn a broken
read into a confident, wrong `OFF`). Check it yourself, **never on a caller's say-so**. When it
records `night-shift: ON`, "for approval" has no destination:
show the text, apply it, and keep going. The approval gate is for a human in the loop. What does NOT
lift is the rail below on **sending** — an external message is an outward-facing write and stays
governed by the calling skill's own rails.

**The note is the exception.** Most passes are routine — output the deliverable alone. Add a note only
when a line genuinely applies, and include only that line:

> **⚠️ Flagged (not changed):** a source claim that looks wrong.
> **Cut you might veto:** a borderline drop a reader might have kept.
> **Road not taken:** a strong alternative you nearly chose.
> **Why so little changed:** the source was already tight.

The note is for your review only, never part of what's sent. Overrides: **"show what you cut"** forces
full accounting; **"just the message"** suppresses all but the ⚠️ flag.

**Offer to apply it** where natural (commit, PR body, plan file) — only after the user okays the
text, or, when your mode check returned ON, straight away (see Autonomy above).
Sending external messages is the user's to do; confirm even for a `gh` PR comment. ⚠️ Under the mode
this does **not** become free: send only where a step of the skill that invoked you mandates that
exact action by name, and if nothing does, record `AWAITING-HUMAN: <message not sent>` and carry on.

## The style

**Keep:**

- **One tiny concrete example per concept** — "one supplier invoice for $ 121.000, uploaded as a PDF
  and again as a photo → 'counted 2×'." Needn't be exact; it transmits the idea. The single biggest clarity
  lever; staying abstract is the default failure. A two-word example pinned to an abstract term is
  near-free: "an AFIP code like 10016 (CbteFch out of range)", not "an AFIP code".
- **The why before the mechanism**; plain names over codenames ("the invoice+payment filter", not "F1").
- **Before→after deltas** ("Before → nothing flagged; Now → A & B flagged").
- **The honest arc** — what was dropped, where direction changed.
- **Glyphs ✅ / ❌ / ⚠️** to carry verdicts; one per claim, prose for the nuance.

**Cut:**

- Hedging and defensive justification ("we believe this works", "just to be safe").
- Anything defending an unquestioned decision.
- Process narration and preamble ("after careful analysis", "great question").
- Jargon the reader may not know; over-formality for a casual context.
- Three sentences doing one's work.
- Decorative formatting — emoji for their own sake, bold on everything, needless nesting.
- Session leakage in anything external.

**Shape:**

- Lead with the verdict; nuance after.
- Lean toward an outline. Parallel items (cases, options, checks, steps) are a bullet list, not an inline
  "A + B. C." run-on. Prose only for a flowing argument.
- **Bold** the labels the reader scans for (Done / Next / Why); number a real sequence; break a line
  between distinct thoughts.
- Handing the reader a choice → enumerate the options (1), (2), (3) so they pick at a glance.
- In markdown, break lines at **meaning boundaries** — one idea per line, blank line between groups.
  Break at sentence ends and between independent clauses; turn a hidden list ("load X, key Y, stamp Z")
  into a real bulleted list. Don't break mid-clause or for width. Keep sentences short. (A flowing one-
  or two-sentence note to a person relaxes this.)
- Match the source's register; don't formalize a casual note.

## Examples

**1 — External reply. Replying to an 11-word review question: "why move the maps instead of deleting them?"**

Before (~95 words):

> Took this deeper than relocating. Four maps → one typed `KIND_ACTION satisfies Record<ReviewIssueKind, string>` plus a `TWO_SOURCE_ACTION` const for the `isTwoSource` override. Section A heading is now a single count-driven sentence — kind framing already lives on the sheet title above, so the body wasn't adding info. The extractor's `descriptions` stays where it is — it drives confidence grading and the title fallback, not copy ownership. FE now matches the codebase convention for presentation copy. Doesn't preempt copy eventually moving to a CMS — just removes the immediate surface area.

After (~35 words):

> Cleaned it up: dropped the per-kind heading map (the sheet title already carries the framing) and collapsed actions to one typed `Record<ReviewIssueKind, string>` + a two-source override. Matches the inline pattern in the other review UIs.

**2 — Technical explanation.**

Before (~340 words): a prose intro and apology, two labeled axes, a 3-step list, a full code trace, three more paragraphs.

After (~150 words):

> `is_current` ≠ the confirmation. Two different columns:
> - `is_current` — "is this the latest extraction output?" (the import job owns it)
> - `confirmed`/`dismissed` — the user's decision (the user owns it)
>
> Re-extraction preserves confirmations by **copying them onto the new rows**, not by sparing the old ones:
> 1. Read existing decisions (the SELECT includes `confirmed`/`dismissed` rows even if already not current)
> 2. Stamp them onto the freshly-extracted rows
> 3. Flip all old rows to `is_current=false`, insert the new rows — which already carry the decisions
>
> So the wipe hits the *old* copy; the confirmation lands on the *new* current copy. The UI is unchanged.
