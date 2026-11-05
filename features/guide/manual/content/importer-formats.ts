import { IMPORT_FIELDS } from "@/features/imports/lib/fields";
import { IMPORT_KIND_LABELS, IMPORT_KINDS } from "@/features/imports/schema";

import type { GuideConcept } from "../types";

/** The columns each import kind reads, straight from the importer's own
 *  field list (features/imports/lib/fields.ts): it cannot drift. */
export function importerFormatConcepts(): GuideConcept[] {
  return IMPORT_KINDS.map((kind) => ({
    title: `Planilla: ${IMPORT_KIND_LABELS[kind]}`,
    body: IMPORT_FIELDS[kind].map((f) => {
      const req = f.required ? " (obligatoria)" : "";
      const hint = f.hint ? `: ${f.hint}` : "";
      const aliases = f.aliases.length
        ? ` También se reconoce como: ${f.aliases.join(", ")}.`
        : "";
      return `**${f.label}**${req}${hint}${aliases}`;
    }),
  }));
}
