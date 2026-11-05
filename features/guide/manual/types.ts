import type { Permission } from "@/lib/auth/permissions";

// The user guide (docs/manual/) is written as typed content and rendered to
// static HTML by render.ts. Every string a user sees in the app and the guide
// quotes is marked so manual.test.ts can hold it to the source tree.
//
// Inline markup in a GuideText:
//   {{Emitir}}          a UI label quoted verbatim (button, field, tab, menu,
//                       column, toast). Must exist as a string in the code.
//   [[/invoices]]       a link to the guide section of an app route. The route
//                       must exist under app/(dashboard).
//   [[#issue-invoice]]  a link to another task or section of the guide.
//   **bold**, `code`    emphasis and literal values (CUIT, codes, formats).

export type GuideText = string;

/** All of them required, or any one of them (`{ anyOf }`); null = any user. */
export type GuidePermission =
  Permission | readonly Permission[] | { anyOf: readonly Permission[] } | null;

export type GuideError = {
  /** The Spanish message exactly as the app shows it. A variable part is
   *  written as "…": every fragment between them must exist in the code or
   *  the migrations. */
  message: string;
  /** What the user does about it. */
  fix: GuideText;
};

// ── Screen replicas ────────────────────────────────────────────────────────
// A label in a replica is a UI label too (validated) unless it starts with
// "~", which marks sample text (a client name, an amount) shown as is.

export type MockButton = {
  label: string;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  /** The step number this control belongs to: drawn as a numbered marker. */
  marker?: number;
};

export type MockField = {
  label: string;
  kind?:
    | "input"
    | "select"
    | "date"
    | "money"
    | "textarea"
    | "checkbox"
    | "switch"
    | "picker";
  /** Sample content shown in the control (not validated). */
  value?: string;
  marker?: number;
  /** Takes the full row in a two-column form. */
  wide?: boolean;
};

export type MockTable = {
  columns: readonly string[];
  /** Sample rows (not validated). */
  rows: readonly (readonly string[])[];
  /** Draws the "⋯" row menu in the last column. */
  rowMenu?: boolean;
  marker?: number;
};

export type MockMenuItem = {
  label: string;
  marker?: number;
  destructive?: boolean;
};

export type MockScreen =
  | {
      kind: "page";
      caption?: string;
      title: string;
      subtitle?: string;
      actions?: readonly MockButton[];
      tabs?: { labels: readonly string[]; active?: number; marker?: number };
      toolbar?: readonly MockField[];
      stats?: readonly { label: string; value: string }[];
      table?: MockTable;
    }
  | {
      kind: "dialog";
      caption?: string;
      title: string;
      description?: string;
      fields?: readonly MockField[];
      table?: MockTable;
      footer: readonly MockButton[];
    }
  | {
      kind: "menu";
      caption?: string;
      /** The control that opens it (a "⋯" or a button label). */
      trigger?: string;
      items: readonly MockMenuItem[];
    };

// ── Content ─────────────────────────────────────────────────────────────────

export type GuideStep =
  | GuideText
  | {
      text: GuideText;
      /** Sub-steps or options, as a nested list. */
      substeps?: readonly GuideText[];
    };

export type GuideTask = {
  /** Anchor id, unique in the whole guide (kebab-case, Spanish). */
  id: string;
  title: string;
  summary?: GuideText;
  /** What the app checks before letting the user do it. */
  permission: GuidePermission;
  prerequisites?: readonly GuideText[];
  /** Replicas of the screens the steps go through, in order. */
  screens?: readonly MockScreen[];
  steps: readonly GuideStep[];
  /** What happens afterwards: entries, balances, CAE, notifications, locks. */
  after?: readonly GuideText[];
  errors?: readonly GuideError[];
  /** Ids of related tasks or sections. */
  related?: readonly string[];
  /** Extra words people use to ask for it (feeds the search and the AI). */
  keywords?: readonly string[];
};

export type GuideConcept = {
  title: string;
  body: readonly GuideText[];
};

export type GuideSection = {
  /** Anchor id, unique in the whole guide. */
  id: string;
  title: string;
  /** Where it is in the app menu: "Ventas › Comprobantes". */
  menuPath?: string;
  /** The app routes it documents, as page patterns ("/invoices/[id]").
   *  Empty for a concept section with no screen of its own. */
  routes: readonly string[];
  /** Permission to see the screen at all. */
  permission: GuidePermission;
  intro: readonly GuideText[];
  /** What the screen shows (columns, filters, tiles) — a replica. */
  screens?: readonly MockScreen[];
  concepts?: readonly GuideConcept[];
  tasks: readonly GuideTask[];
};

export type GuidePage = {
  /** File name in docs/manual/, e.g. "ventas.html". */
  file: string;
  title: string;
  lead: GuideText;
  sections: readonly GuideSection[];
};
