---
name: td-explain
description: >-
  Build an artifact page that makes something in JouveERP understandable fast — how a feature or
  flow works today, a PR or stack, an issue or a set of issues — by walking one concrete case step
  by step, with a system map that lights the path of each step and one mechanism diagram per step.
  A change gets a pair of pages (today / after) on the same case. ES/EN always, light + dark.
  Read-only, never changes code. Use for "/td-explain", "explicame", "quiero entender", "cómo
  funciona X", "artifact para entender", "cómo queda después de estas issues", "show me how X
  works", "what does this PR do".
---

# td-explain

One page that makes a topic understandable: **follow one concrete case through the system**, step by
step, and **draw the mechanism** at every step. Few words, many diagrams. Read-only: never edit,
commit or push.

Build from the shell in `.agents/skills/td-explain/reference/shell/`, never from scratch:

- `head.html`: CSS tokens (light + dark), arrow markers, the page skeleton and the SVG helpers. Replace `__TITLE__`.
- `map.js`: the system map's boxes and edges (`MAPW`, `MAPH`, `MAPN`, `MAPE`). Rewrite it per topic.
- `engine.js`: draws the map and the step card. It also runs the picker, the language toggle, keyboard nav and the `#s=N` deep links. Don't edit it.
- `example.js`: page data for a worked example (a client's cargas → liquidación R → one grouped
  Factura A with its CAE → the receipt that pays it → the libro IVA Ventas). Copy its shape. Each page defines `mapLabels`, `edgeLabels`, `PEOPLE`, `FIGS`,
  `STEPS`, `T` and `SECTIONS`. `FIGS[i]` draws `STEPS[i]`.

To assemble a page, concatenate `head.html + map.js + <page>.js + engine.js` into one `.html` in the
scratchpad (three lines of Python, `python3 -I`). The example's own `map.js` goes with `example.js`;
a new topic replaces both.

## 1. Pin the subject

One line: what the reader must understand. Pick the kind:

- **How it works today:** a feature or flow. One page. The steps follow one request or action end to end.
- **A change** (a PR, a stack, an issue, a milestone or a list of issues): **two pages**, today and after.
  They share the same case, people and map, so the reader can compare them step by step.
  If only the after page is asked for and the today page already exists, build the after page against that today page.
  The after page differs in three ways:
  - Each step is tagged with the PR or issue it comes from (`tags: ["#412"]`).
  - Removed things are dashed or struck through; new things are in the accent colour.
  - "Where it is in the code" becomes **"What changes"** (`codeL: {es, en}`): the new tables, functions and rules by name, plus the `file:line` they replace today.

If the subject is ambiguous (which PR, which flow), ask once. Otherwise go.

## 2. Gather facts

- Read code from a fresh base. Run `git fetch origin main` and add a detached worktree in the
  scratchpad (`git worktree add --detach <scratchpad>/explain-<slug> origin/main`), or use the PR
  head for a change (`git fetch origin pull/<n>/head`). Remove the worktree at the end. Never edit code.
- Split the flow into 3 phases (for example: entry and permission → the core work → what is saved and who sees it).
  Run one read-only `Explore` agent per phase, in parallel, each with
  `.agents/skills/_shared/subagent-constraints/hard-constraints.md` pasted at the top. Ask each for a
  fact list (max ~40 bullets) with `file:line`, inferences marked, no essays. Without sub-agents, run
  the three passes in turn (`.agents/skills/_shared/runtime/capabilities.md`).
- For a change made of issues (GitHub issues with `gh issue view <n> --comments` or the GitHub MCP's
  `issue_read`; Linear issues only
  when the user names them and the Linear MCP is connected, through `nav-linear`, read-only), run one
  more agent in parallel. The count the user names may differ from what it finds, so say which ones you took.
  It reads every issue in full, with its links and **all** its comments. Per issue it returns:
  - the problem today
  - the decided end state
  - decisions and open questions from the comments
  - dependencies

  It also returns an "after all of them" model in ~15 bullets.
- Check yourself the 3–5 numbers the page leans on (limits, retries, concurrency keys, which
  permission a gate checks, which status a filter keeps).
- Every sentence on the page traces to a fact. Drop what you can't trace, or mark it as inferred.
  On the after page, the footer says it shows the issues' design, not code.

## 3. Pick the case and the cast

- One concrete scenario with times and made-up but realistic names, amounts and numbers, reused across the
  whole page (and both pages). For example: Julián enters three cargas in October, Marta settles them in R-00000012 on 3 November
  and invoices Factura A 0003-00001042, the client pays on the 20th, and Sofía sees it in the libro IVA
  Ventas at month end. Never a real client, CUIT or voucher.
- A **cast of 3–5 people**, shown as chips under the case (`PEOPLE`).
  - Include the edge roles the topic cares about, by their role in `lib/auth/permissions.ts`: a role
    that lacks the permission (`operations`, `warehouse`), a fiscal-only `fiscal_reader`, a user with a
    per-user deny, a non-human actor (an Inngest function, the AI assistant).
  - Mark a non-human or new actor with class `ai`.
  - The same people are the columns of the "who sees what" matrix.

## 4. Build the page

In this order:

1. **Header:** eyebrow (area · "cómo funciona hoy" or "después de <hito>"), a title that is a name of 2–4 words, a one-line lede, and the ES/EN toggle.
2. **The case:** the story in two lines, plus the people chips.
3. **The walk:** two columns that stack on narrow screens.
   - Left, sticky: **the system map**, 7–9 boxes grouped by where they run (browser, Next server,
     Postgres, Inngest, AFIP, an AI provider…). Every arrow has a short verb label.
     - The current step's boxes and arrows light up in the accent colour. `warn:[edgeKey]` lights an edge in warn instead.
     - The flow line under the map names the hop.
     - On the after page, the box sublabels and edge labels describe the new behaviour.
   - Right: the step picker (5–9 steps), then the step card:
     - number and tags
     - title
     - **one sentence**
     - **one diagram of that step's mechanism**
     - at most 2 facts (`flag:` marks a problem)
     - the folded list of code locations or changes

     Back / Next buttons and arrow keys move between steps.
4. **Sections** (`SECTIONS`), chosen to fit:
   - On the today page:
     - **Each entry:** every way the flow starts (a form, an AI CFO tool, an Inngest cron, an import), and what it carries or sets.
     - **Who sees what:** a matrix of the cast × things. A warn dot means "sees it and shouldn't".
     - **What isn't obvious:** 3–6 cards, each with a title, one or two lines, and the consequence in warn.
   - On the after page:
     - **Before and after:** a table of question | today | after, about 10 rows.
     - **Who sees what:** the same matrix as on the today page, with the warn cells gone.
     - **In what order:** a graph of which issue or PR blocks which. Leave out the transitive edges, show the in-progress one in accent and the cancelled ones dashed, and put external blockers in a note.
     - **Other changes:** cards with the issue or PR, for changes that aren't a step.
     - **What's still open:** cards for points the comments left undecided, and for what is out of scope.
5. **Footer:** the commit read, the date, and for issues the read date and which issues were taken.

## Theme

**Follows the system.** `head.html` already has it:
- The light palette sits on bare `:root`.
- The dark palette sits under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }` and again under `:root[data-theme="dark"]`.

Every colour is a token. Only `accent` (the path, what's new) and `warn` (problems) carry meaning; everything else is neutral.

## 5. Diagrams

Each step's diagram shows the mechanism, not its name. Pick the shape that fits:

| The step is about | Draw |
|---|---|
| a request and what it carries | sender → receiver, with the payload as a `list()` beside it |
| something that lives over time | a timeline with the events on it |
| what something is made of | a stack of labelled layers, in order |
| a choice, a fallback or a retry | the chain, with "si no" / "else" between the links |
| work that runs in different places | one row per place, with arrows to where each ends |
| messages between parts (app ↔ AFIP, app ↔ Inngest) | a sequence diagram (lifelines and labelled messages) |
| a write and its failures | the transaction box, with one branch per failure |
| which value lands where, or who can do what | `matrix()` |
| removed vs new (after page) | a struck `list(…,"dash")` with `x:` items, next to the new accent box |

Helpers in `head.html`:
- `svg`, `box`, `ar(d, "on"|"warn"|"dash")`, `tx`, and `fig(svg, caption)`.
- `list(x, y, w, title, items, cls)`. Prefix an item with `a:` for accent, `w:` for warn, or `x:` for struck through.
- `matrix(W, x0, colW, cols, rows, rowH)`. A cell is `y` (accent dot), `w` (warn dot), `-`, or text, which can take the `a:` or `w:` prefix.

Rules:
- Label every arrow.
- Give each `svg` a max width of about 1.2 × its viewBox width. `svg()` already does this.
- Give each figure a one-sentence caption.

## 6. Check once, publish

- Screenshot the full page in light. Screenshot each step through its deep link (`#s=N`), in light
  and in dark. `CHROME` is the Chrome binary: `google-chrome` (Linux; add `--no-sandbox` in a
  container) or `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (macOS):
  ```
  "$CHROME" --headless=new --hide-scrollbars --window-size=1280,2600 --blink-settings=preferredColorScheme=1 --screenshot=full.png file://<page>
  "$CHROME" --headless=new --hide-scrollbars --window-size=1280,1000 --blink-settings=preferredColorScheme=0 --screenshot=s4.png "file://<page>#s=4"
  ```
- Crop the step cards and paste them into one grid image with PIL. Read the full page and the grid once.
- Fix overlapping labels, text that runs out of its box, and confusing strike-throughs. Then publish without a second look.
- Check that both languages are complete. Make a copy of the page with `let lang="es"` changed to `"en"`
  and the `localStorage` read removed. Dump it with `"$CHROME" --headless=new --dump-dom`, once per step
  (`#s=N`), because only the current step's card is in the DOM. Strip `<script>` and `<style>`, then
  grep the visible text for Spanish (accents, `¿¡`, common words like `de la con sin para que`).
  Do the same with ES, grepping for English. Fix every hit before publishing; code identifiers, paths and SHAs don't count.
- Publish each page with the Artifact tool. Reply in the user's language with:
  - the link or links
  - the 3–4 most surprising facts
  - which issues were taken, if the count didn't match
  - a note that the pages are private until shared

## Writing

- Short. One sentence per step, at most 2 facts. If a diagram says it, don't repeat it in words.
- Name things the way the user sees them in the app (Comprobantes, libro IVA Ventas, recibo, asiento),
  and give the code name once (`issueFiscalInvoiceAction`, `issue-invoice`) where it helps find it.
- Spanish copy is Spanish from Argentina, like the app.
- Both languages carry the same content, and every visible string goes through `L(es, en)`: diagram
  labels, sublabels, list items, captions and `PEOPLE` roles included. A literal string in a `box()`,
  `tx()` or `list()` call shows the same text in both languages, so it's a bug unless it's a code name.
