---
name: improve-text-md
description: >-
  Deep editorial improvement of a Markdown document — contradiction sweep, implementation audit,
  deduplication, cross-references, precision pass, formatting. Use when asked to deeply improve,
  audit, or de-duplicate a specific Markdown document; for shortening prose use `tighten`.
effort: max
allowed-tools: Agent, Task, Read, Edit, Grep, Glob
disable-model-invocation: true
---

You MUST follow this workflow exactly, in order, phase by phase.
Each phase completes fully before the next begins.

Goal: Transform a Markdown document into a tight, internally consistent, non-redundant text with clickable navigation and uniform formatting — reading like an academic document that happens to use Markdown well.

---

> **Runtime:** where a step says "use a subagent" / "fan out", that assumes a runtime with parallel sub-agents. For the tool-neutral contract and the sequential fallback (Cursor/Codex: run the phases serially in one context, same standard), see `.agents/skills/_shared/runtime/capabilities.md`.

## BEFORE YOU START

1. Read the ENTIRE file. Do not begin any phase without having read every line.
2. Identify the document's domain, structure, and key terms. You need full context to detect contradictions and duplications — partial reads will miss cross-section conflicts.
3. If the file is too large for a single read, read it in sequential chunks and hold the full mental model before proceeding.

---

## PHASE 1: CONTRADICTION ANALYSIS

**Purpose:** Find every internal contradiction — places where the document says two incompatible things.

**How to execute:**

Use a subagent (Agent tool) with the following instructions. This MUST be a deep-reasoning task — do not shortcut it.

```
Subagent prompt:
"Read the entire file [PATH]. Perform an exhaustive contradiction analysis. For every claim,
definition, number, rule, or design decision in the document, check whether ANY other part of the
document says something incompatible. A contradiction is: the same concept described with different
values, a rule stated in one place and violated in another, a term defined differently in two
locations, or a constraint in one section that is impossible given another section's design.

Output a numbered list. For each contradiction:
- C[N]: [one-line summary]
- Location A: line ~[N], section [name] — quote the exact text
- Location B: line ~[N], section [name] — quote the exact text
- Nature: [factual conflict | definitional conflict | rule violation | stale reference]

If you find zero contradictions, say so explicitly. Do NOT invent contradictions that aren't there."
```

**After the subagent returns:**

- Review each contradiction. Determine the source of truth — the more specific, more recent, or more thoroughly reasoned version wins. If unclear and a human is in the loop, ask. ⚠️ This skill has no `Bash`, so it cannot run the mode check itself — **take the mode from whoever
invoked you**: a skill invoked mid-pipeline is unattended by definition, and only a human typing this
skill's name directly is not. Unattended there is nobody to ask: keep the version that is
more specific, more recent or better reasoned, and record the call and the rejected alternative.
- Fix every confirmed contradiction with Edit calls. Change the WRONG location to match the RIGHT one.
- Do NOT fix things the subagent flagged that aren't actual contradictions (e.g., a general statement and a specific refinement of it are not contradictions).

---

## PHASE 2: IMPLEMENTATION ANCHORING AUDIT

**Purpose:** Identify premature implementation details that anchor the reader into specific technical choices before the conceptual model warrants it.

**What to remove:**
- Proposed DDL / SQL schemas (not yet in any codebase)
- Proposed function signatures, class names, or type definitions (not yet in any codebase)
- Proposed JSON structures for APIs that don't exist yet
- Proposed file paths, module names, or package structures for code not yet written
- Workflow names, queue names, or infrastructure identifiers that are speculative

**What to KEEP:**
- References to EXISTING code, tables, triggers, classes, or functions already in the codebase — these are useful for lookup and grounding
- Conceptual data models described in prose ("a single table, one row per X, storing Y and Z")
- Example data structures that illustrate a concept (e.g., showing what OCR output looks like) — these describe existing reality, not proposed implementation

**How to execute:**

Use a subagent (Agent tool):

```
Subagent prompt:
"Read the entire file [PATH]. Find every instance of: DDL/SQL, function/method signatures,
JSON schema definitions, class/type definitions, file path proposals, workflow/queue names,
or other implementation-level artifacts. For each, determine: is this referencing something
that EXISTS in a codebase, or is it PROPOSING something new?

Output a numbered list:
- I[N]: [what it is] — line ~[N]
- Type: [existing reference | proposed artifact | illustrative example]
- Recommendation: [keep | replace with prose | remove]"
```

**After the subagent returns:**

- Keep all "existing reference" items untouched.
- Keep all "illustrative example" items (they ground the reader in real data).
- Replace each "proposed artifact" with a prose description of the same concept. A DDL schema becomes "A single table storing X, Y, Z with uniqueness on (A, B, C)." A function signature becomes a description of inputs and outputs.

---

## PHASE 3: DEDUPLICATION ANALYSIS

**Purpose:** Every concept, rule, definition, or design decision should be stated exactly once in its canonical location. All other mentions become cross-references.

**How to execute:**

Use a subagent (Agent tool). This is the most demanding analysis — it requires comparing every paragraph against every other paragraph.

```
Subagent prompt:
"Read the entire file [PATH]. Find every concept, rule, principle, or design decision that
appears in MORE than one location. A duplication is: the same idea expressed in different words,
the same rule stated in two sections, the same number/threshold given in multiple places, or
the same design rationale repeated.

For each duplication:
- D[N]: [concept name]
- Locations: list every section + approximate line where it appears
- Canonical location: which section is the NATURAL home for this concept (where it's first
  needed, most thoroughly explained, or most structurally relevant)
- Other locations: what each non-canonical mention should become (cross-reference, removal,
  or brief reminder with link)

Be thorough. Check: principles, thresholds/numbers, rules, architectural decisions,
definitions of terms, enumerated lists that overlap."
```

**After the subagent returns:**

- For each confirmed duplication, keep the canonical location intact.
- At every other location, either:
  - Replace with a cross-reference: "see [Section name](#anchor)"
  - Remove entirely if the mention adds nothing even as a reminder
  - Keep a ONE-sentence reminder + link if the reader genuinely needs the reminder in context

**Rule:** When in doubt, remove. Readers can follow links. Repeated text creates maintenance burden and future contradiction risk.

---

## PHASE 4: CROSS-REFERENCES AND TABLE OF CONTENTS

**Purpose:** Convert all plain-text references ("see section 3.2", "described above", "as noted in the memory section") into clickable GFM anchor links. Add a full Table of Contents.

**How to execute:**

1. **Build an anchor map.** List every heading in the document and its GFM anchor (lowercase, spaces to hyphens, strip punctuation, deduplicate with `-1` suffix if needed).

2. **Find all cross-references.** Search for patterns like:
   - "see section X" / "see [name]" / "described in X" / "above" / "below"
   - "(section X.Y)" / "as noted in" / "per the X section"
   - Any phrase that points the reader to another part of the document

3. **Convert each to a GFM link.** `see [Section name](#anchor)` — use the actual heading text, not a paraphrase.

4. **Add a Table of Contents** after the document title (or after any existing abstract/summary). Use a flat `-` list containing only `##` headings — no nesting, no `###` or deeper. The TOC must be minimal and scannable, serving as a high-level map of the document's major sections.

5. **Verify every link.** Grep for `](#` and confirm each anchor target exists as a heading. Fix any broken links.

---

## PHASE 5: PRECISION PASS

**Purpose:** Trim fluff (words that add no information). Add precision (under-specified ideas that need sharper definition).

**What to trim:**
- Sentences that restate what was just said in different words
- Preamble paragraphs that say "this section will discuss X" — just discuss X
- Hedge phrases that add no nuance ("it should be noted that", "it is worth mentioning", "importantly")
- Commentary on how good/elegant/simple the design is — let the reader judge
- Any sentence where removing it loses zero information

**What to add precision to:**
- Magic numbers without rationale (why 3? why 70%? why 30 days?)
- Ambiguous edge cases ("the system handles this appropriately" — HOW?)
- Undefined terms used as if the reader knows them
- Processes described without specifying who/what initiates them or what happens on failure
- Thresholds or rules without specifying what happens at the boundary

**How to execute:**

Read section by section. For each paragraph, ask:
1. Can I delete any sentence without losing information? Delete it.
2. Is there a claim here that a new reader would need to ask "what exactly do you mean?" Add the missing specificity.
3. Are there concrete examples where they'd help, or unnecessary examples where the concept is already clear? Add or remove accordingly.

This phase is manual — do NOT use a subagent. You need the full document context to judge what's redundant vs. necessary. Work through the document sequentially, section by section.

---

## PHASE 6: FORMATTING NORMALIZATION

**Purpose:** Make the document visually consistent — uniform heading style, list syntax, emphasis patterns, blockquote usage, dash types, spacing.

**Formatting rules (academic Markdown style):**

**Headings:**
- `#` document title, `##` major sections, `###` workstreams/subsections, `####` sub-topics
- No trailing punctuation on headings (exception: `?` in genuine questions)
- Numbered sub-headings (`#### 1. Name`) are fine under a parent that introduces the enumeration

**Lists:**
- All unordered lists use `-` (never `*` or `+`)
- No indentation on top-level bullets (0 spaces before `-`)
- Nested bullets indented 2 spaces
- Numbered lists use `1.`, `2.`, etc. (not all `1.`)

**Emphasis:**
- **Bold** for key terms on first/defining use, for lead phrases in definition-list-style paragraphs (`**Term.** Explanation...`), and for column headers in text
- *Italic* for sub-labels within a section, for caveats/notes, and for foreign terms
- `Code` for identifiers, field names, enum values, file paths, table names, function names — anything that would appear literally in code
- No bold-italic (`***`) — pick one

**Blockquotes:**
- Reserve `>` for two purposes only: (1) key principles or primary statements that anchor the section, and (2) `> **Open:**` editorial notes marking unresolved design questions
- Do NOT use blockquotes for caveats, footnotes, or secondary commentary — use *italic* or parenthetical instead

**Tables:**
- Blank line before and after every table
- Use tables for structured comparisons (3+ items with shared dimensions), NOT for 2-item lists
- Align `|` columns for readability in source (not required but preferred)

**Code blocks:**
- Use fenced blocks (` ``` `) with a language tag for actual code/data examples
- NEVER use `text` fenced blocks for editorial notes — convert to `> **Open:**` blockquotes

**Dashes:**
- Em-dash (`—`) for parenthetical breaks, with spaces on both sides (` — `). Use sparingly. Em-dashes are "lazy punctuation" — prefer restructuring into full sentences using commas, semicolons, colons, or separate sentences. Reserve em-dashes for cases where the parenthetical genuinely reads better as an aside than as its own clause.
- En-dash (`–`) for numeric ranges only (e.g., `2–4`, `40–50%`)
- Hyphen (`-`) for compound words and list markers only

**Spacing:**
- One blank line between paragraphs
- One blank line before and after headings, tables, code blocks, and blockquotes
- No trailing whitespace
- No double blank lines anywhere
- No indentation on prose paragraphs

**Verify:**
- Grep for `^\* ` (wrong bullet marker)
- Grep for `  $` (trailing spaces)
- Grep for common inconsistencies: mixed dash types in similar contexts, inconsistent bold patterns in list items
- Read the TOC links against actual headings one more time

---

## COMPLETION CHECKLIST

After all 6 phases:

- [ ] Zero internal contradictions
- [ ] No speculative implementation artifacts (DDL, signatures, proposed JSON schemas)
- [ ] Every concept stated once in its canonical location; other mentions are cross-references
- [ ] All cross-references are clickable GFM anchor links
- [ ] TOC present and complete
- [ ] No fluff sentences; all thresholds and rules are specified precisely
- [ ] Consistent formatting: bullets, dashes, bold/italic, blockquotes, code, spacing

Report what changed in each phase as a brief summary to the user.
