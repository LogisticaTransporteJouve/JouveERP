import { toPlainText } from "./markup";
import {
  accessCan,
  anchorHref,
  makeResolver,
  roleNames,
  stepText,
  taskTexts,
  type Anchor,
} from "./model";
import type { GuidePage, GuidePermission } from "./types";
import type { Access } from "@/lib/auth/permissions";

// How-to search over the guide content, for the assistant's searchGuide tool:
// plain keyword scoring (no embeddings), title and keywords weighted over the
// steps. The guide is small (a few hundred tasks), so it scans everything.

const STOPWORDS = new Set(
  "a al como con cómo de del donde dónde el en es hace hacer hago la las lo los me mi para por que qué se si su sus un una uno y o puedo quiero tengo cuando cuál cual esto este esta".split(
    " ",
  ),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** A crude Spanish stem: enough for "emito" ~ "emitir", "facturas" ~
 *  "factura" ~ "facturación". */
function stem(t: string): string {
  return t.length <= 4 ? t : t.slice(0, Math.max(4, t.length - 3));
}

function matches(query: string, doc: string): boolean {
  return doc.startsWith(query) || query.startsWith(doc);
}

type Doc = { anchor: Anchor; fields: { stems: string[]; weight: number }[] };

function buildDocs(pages: readonly GuidePage[]): Doc[] {
  const r = makeResolver(pages);
  const stems = (texts: readonly string[]) => [
    ...new Set(texts.flatMap((t) => tokens(toPlainText(t, r))).map(stem)),
  ];
  const docs: Doc[] = [];
  for (const page of pages) {
    for (const section of page.sections) {
      docs.push({
        anchor: { kind: "section", page, section },
        fields: [
          { stems: stems([section.title, section.menuPath ?? ""]), weight: 3 },
          { stems: stems(section.intro), weight: 1 },
        ],
      });
      for (const task of section.tasks) {
        docs.push({
          anchor: { kind: "task", page, section, task },
          fields: [
            { stems: stems([task.title, ...(task.keywords ?? [])]), weight: 4 },
            {
              stems: stems([section.title, section.menuPath ?? ""]),
              weight: 2,
            },
            { stems: stems(taskTexts(task)), weight: 1 },
          ],
        });
      }
    }
  }
  return docs;
}

const cache = new WeakMap<readonly GuidePage[], Doc[]>();

export type GuideHit = {
  title: string;
  /** "/manual/ventas.html#emitir-factura" */
  href: string;
  where: string;
  permission: GuidePermission;
  /** The roles that can do it, by name. */
  roles: string;
  /** Whether this user can (roles and per-user denies). */
  allowed: boolean;
  summary?: string;
  prerequisites: string[];
  steps: string[];
  after: string[];
  errors: { message: string; fix: string }[];
};

export function searchGuide(
  pages: readonly GuidePage[],
  query: string,
  access: Access,
  limit = 3,
): GuideHit[] {
  let docs = cache.get(pages);
  if (!docs) {
    docs = buildDocs(pages);
    cache.set(pages, docs);
  }
  const q = [...new Set(tokens(query).map(stem))];
  if (q.length === 0) return [];
  const r = makeResolver(pages);
  const plain = (t: string) => toPlainText(t, r);

  return docs
    .map((doc) => {
      let score = 0;
      let hits = 0;
      for (const term of q) {
        let best = 0;
        for (const f of doc.fields) {
          if (f.weight > best && f.stems.some((s) => matches(term, s)))
            best = f.weight;
        }
        score += best;
        if (best > 0) hits += 1;
      }
      // Covering more of the question beats repeating one word.
      return { doc, score: score * (hits / q.length) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ doc }) => {
      const a = doc.anchor;
      const where =
        a.section.menuPath ?? `${a.page.title} › ${a.section.title}`;
      const href = `/manual/${anchorHref(a)}`;
      if (a.kind === "section") {
        return {
          title: a.section.title,
          href,
          where,
          permission: a.section.permission,
          roles: roleNames(a.section.permission),
          allowed: accessCan(access, a.section.permission),
          summary: a.section.intro.map(plain).join(" "),
          prerequisites: [],
          steps: a.section.tasks.map((t) => `Tarea: ${t.title}`),
          after: [],
          errors: [],
        };
      }
      const t = a.task;
      return {
        title: t.title,
        href,
        where,
        permission: t.permission,
        roles: roleNames(t.permission),
        allowed: accessCan(access, t.permission),
        summary: t.summary ? plain(t.summary) : undefined,
        prerequisites: (t.prerequisites ?? []).map(plain),
        steps: t.steps.map((s) =>
          [
            plain(stepText(s)),
            ...(typeof s === "string" ? [] : (s.substeps ?? []).map(plain)),
          ].join(" — "),
        ),
        after: (t.after ?? []).map(plain),
        errors: (t.errors ?? []).map((er) => ({
          message: er.message,
          fix: plain(er.fix),
        })),
      };
    });
}
