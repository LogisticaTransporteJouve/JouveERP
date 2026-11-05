import { z } from "zod";

import { GUIDE_PAGES } from "@/features/guide/manual/content";
import { searchGuide as searchGuidePages } from "@/features/guide/manual/search";
import { manualAccess } from "@/lib/manual/serve";

import { defineAiAction } from "../define";
import { errResult, okResult } from "../result";

export const searchGuide = defineAiAction({
  name: "searchGuide",
  domain: "general",
  // Anyone who can open the chat: the guide documents every task, including
  // the ones this user cannot do (each hit says whether they can).
  permission: "ai:chat",
  sideEffect: "read",
  sources: ["docs/manual"],
  description:
    "Busca en la guía de uso de JouveERP cómo se hace algo en el sistema (emitir una factura, cargar un cheque, cerrar un período…): devuelve las tareas que coinciden con quién puede hacerlas, si este usuario puede (allowed), los pasos con los textos exactos de los botones, qué pasa después, los errores posibles y el link a la sección (href). Para preguntas de uso, no de datos.",
  input: z.object({
    query: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe("Lo que el usuario quiere hacer, en sus palabras."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(3)
      .describe("Cuántas tareas devolver (1 a 5)."),
  }),
  run: async (ctx, input) => {
    // The guide documents the internal channel: a fiscal-only user is
    // refused it, as /manual refuses them (lib/manual/serve.ts).
    if (manualAccess(ctx.access) !== "allowed") {
      return errResult("La guía de uso no está disponible para tu usuario.");
    }
    const hits = searchGuidePages(
      GUIDE_PAGES,
      input.query,
      ctx.access,
      input.limit,
    );
    return okResult(
      hits.length === 0
        ? "La guía no tiene una tarea que coincida."
        : `${hits.length} tarea(s) de la guía.`,
      hits,
    );
  },
});
