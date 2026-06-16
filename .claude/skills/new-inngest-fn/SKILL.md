---
name: new-inngest-fn
description: "Add an Inngest function (event- or cron-triggered) in JouveERP lib/inngest/. Use for background jobs, scheduled/cron tasks, durable workflows, or fan-out processing. Triggers on 'inngest', 'cron', 'job en background', 'tarea programada', 'workflow', 'función programada'."
---

# Nueva función Inngest (JouveERP)

> Background y workflows van por **Inngest**, no Temporal (decisión del roadmap).

## Pasos

1. **Cliente:** `lib/inngest/client.ts` exporta `inngest` (id `jouve-erp`).
2. **Si es event-triggered:** definí el nombre const + schema **Zod** en
   `lib/inngest/events.ts`; disparás con `inngest.send({ name, data })`.
3. **Si es cron:** `triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires <expr>" }]`.
4. **Función:** `inngest.createFunction({ id, name, retries }, handler)` con
   `step.run("paso", async () => {...})` por paso. Usá `getServiceClient()` adentro.
5. **Registrar** la función en `app/api/inngest/route.ts`
   (`serve({ client, functions: [...] })`) — si no, no corre.

Templates: `lib/inngest/functions/aging-weekly-summary.ts` (cron) ·
`lib/inngest/functions/issue-invoice.ts` (event).

## Skeleton

```ts
import { inngest } from "@/lib/inngest/client";
import { getServiceClient } from "@/lib/supabase/service";
import { logger } from "@/lib/logger";

export const myFn = inngest.createFunction(
  {
    id: "my-fn",
    name: "Descripción corta",
    retries: 2,
    // cron (Mondays 09:00 ART). Para event-triggered, usar { event: MY_EVENT } en su lugar.
    triggers: [{ cron: "TZ=America/Argentina/Buenos_Aires 0 9 * * 1" }],
  },
  async ({ step }) => {
    const data = await step.run("fetch", async () => {
      const supabase = getServiceClient();
      const { data, error } = await supabase.from("...").select("...");
      if (error) throw new Error(`fetch: ${error.message}`);
      return data;
    });

    await step.run("act", async () => {
      logger.info("my_fn.done", { count: data?.length ?? 0 });
      // ...
    });

    return data;
  },
);
```

## Checklist

- [ ] Registrada en `app/api/inngest/route.ts`.
- [ ] Cron con prefijo `TZ=America/Argentina/Buenos_Aires`.
- [ ] Un `step.run` por paso (idempotencia + retries).
- [ ] Event payloads tipados con Zod en `events.ts`.
- [ ] Queries con `getServiceClient()`, sin `select *`.
