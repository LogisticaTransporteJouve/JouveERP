// A discrete-event model of the Inngest behaviour the AI task scheduler leans
// on, to run real `inngest.createFunction` definitions over simulated days in
// one process (no dev server). It models, from the SDK config each function
// declares:
//   - event delivery, with `ts` in the future held until then;
//   - event-id dedupe for 24 hours from receipt;
//   - function `idempotency` (a CEL path) for 24 hours;
//   - `cancelOn` with `if` (== / != joined by &&) or `match` (which, as the SDK
//     does in InngestFunction.getConfig, replaces `if`);
//   - durable steps: step.run memoized and retried up to `retries` times,
//     step.sleepUntil suspending the run, step.sendEvent delivering events;
//   - cron triggers of the form "TZ=<zone> <minute> <hour> * * *" with
//     minute "*/n" or a number and hour "*" or a number.
// It does not model backoff curves, concurrency, plan limits or the 1,000-step
// cap; tests count steps instead.

type EventIn = { id?: string; name: string; ts?: number; data?: unknown };
type DeliveredEvent = { id?: string; name: string; ts: number; data: unknown };

type Cancel = { event: string; if?: string; match?: string };
type FnConfig = {
  id: string;
  triggers: ({ event: string } | { cron: string })[];
  cancelOn?: Cancel[];
  idempotency?: string;
  retries?: number;
};

type Handler = (ctx: { event: DeliveredEvent; step: unknown }) => unknown;

type Memo = { ok: true; data: unknown } | { ok: false; error: string };

type Run = {
  seq: number;
  fn: SimFunction;
  event: DeliveredEvent;
  memo: Map<string, Memo>;
  attempts: Map<string, number>;
  status: "ready" | "sleeping" | "completed" | "failed" | "cancelled";
  wakeAt: number;
  result?: unknown;
  error?: string;
};

type SimFunction = { config: FnConfig; handler: Handler };

export type FnStats = {
  runs: number;
  steps: number;
  cancelled: number;
  failed: number;
};

const DEDUPE_MS = 24 * 60 * 60 * 1000;
const RETRY_DELAY_MS = 30 * 1000;

class Suspend {
  constructor(readonly until: number) {}
}
class StepFailed extends Error {}

function readPath(root: unknown, path: string): unknown {
  let value: unknown = root;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

function operand(token: string, scope: Record<string, unknown>): unknown {
  const t = token.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1);
  return readPath(scope, t);
}

/** The subset of CEL cancelOn expressions use: `a == b && c != d`. */
export function evalCondition(
  expr: string,
  scope: Record<string, unknown>,
): boolean {
  return expr.split("&&").every((clause) => {
    const ne = clause.split("!=");
    if (ne.length === 2)
      return operand(ne[0] ?? "", scope) !== operand(ne[1] ?? "", scope);
    const eq = clause.split("==");
    if (eq.length === 2)
      return operand(eq[0] ?? "", scope) === operand(eq[1] ?? "", scope);
    throw new Error(`unsupported expression: ${clause}`);
  });
}

function cronOffsetMs(tz: string | undefined): number {
  if (!tz || tz === "UTC") return 0;
  if (tz === "America/Argentina/Buenos_Aires") return -3 * 60 * 60 * 1000;
  throw new Error(`unsupported TZ ${tz}`);
}

/** The first fire time of `cron` strictly after `after`. */
export function nextCron(cron: string, after: number): number {
  const match = /^(?:TZ=(\S+)\s+)?(\S+)\s+(\S+)\s+\*\s+\*\s+\*$/.exec(cron);
  if (!match) throw new Error(`unsupported cron ${cron}`);
  const [, tz, minute = "", hour = ""] = match;
  const offset = cronOffsetMs(tz);
  const minuteOk = (m: number) =>
    minute.startsWith("*/")
      ? m % Number(minute.slice(2)) === 0
      : m === Number(minute);
  const hourOk = (h: number) => hour === "*" || h === Number(hour);
  let t = Math.floor(after / 60000) * 60000 + 60000;
  for (let i = 0; i < 60 * 24 * 2; i++, t += 60000) {
    const local = new Date(t + offset);
    if (minuteOk(local.getUTCMinutes()) && hourOk(local.getUTCHours()))
      return t;
  }
  throw new Error(`no fire time for ${cron}`);
}

function toEventIn(value: unknown): EventIn {
  const name: unknown = Reflect.get(Object(value), "name");
  if (typeof name !== "string") throw new Error("event without a name");
  const id: unknown = Reflect.get(Object(value), "id");
  const ts: unknown = Reflect.get(Object(value), "ts");
  return {
    name,
    id: typeof id === "string" ? id : undefined,
    ts: typeof ts === "number" ? ts : undefined,
    data: Reflect.get(Object(value), "data"),
  };
}

function toSimFunction(fn: unknown): SimFunction {
  const opts: unknown = Reflect.get(Object(fn), "opts");
  const handler: unknown = Reflect.get(Object(fn), "fn");
  if (
    typeof handler !== "function" ||
    typeof opts !== "object" ||
    opts === null
  ) {
    throw new Error("not an Inngest function");
  }
  const config: FnConfig = {
    id: String(Reflect.get(opts, "id")),
    triggers: Reflect.get(opts, "triggers"),
    cancelOn: Reflect.get(opts, "cancelOn"),
    idempotency: Reflect.get(opts, "idempotency"),
    retries: Reflect.get(opts, "retries"),
  };
  return {
    config,
    handler: (ctx) => Reflect.apply(handler, undefined, [ctx]),
  };
}

export class InngestSim {
  now: number;
  private readonly fns: SimFunction[];
  private readonly runs: Run[] = [];
  private held: DeliveredEvent[] = [];
  private outbox: EventIn[] = [];
  private readonly seenEventIds = new Map<string, number>();
  private readonly idempotency = new Map<string, number>();
  private readonly cronNext = new Map<string, number>();
  private seq = 0;
  readonly stats = new Map<string, FnStats>();
  /** Every event Inngest accepted (after dedupe), for assertions. */
  readonly accepted: DeliveredEvent[] = [];
  /** Drops matching events before Inngest receives them (a lost send). */
  dropEvent: (e: EventIn) => boolean = () => false;

  constructor(
    functions: unknown[],
    start: number,
    private readonly onTime: (now: number) => void,
  ) {
    this.now = start;
    this.fns = functions.map(toSimFunction);
    for (const fn of this.fns) {
      this.stats.set(fn.config.id, {
        runs: 0,
        steps: 0,
        cancelled: 0,
        failed: 0,
      });
      for (const trigger of fn.config.triggers) {
        if ("cron" in trigger)
          this.cronNext.set(fn.config.id, nextCron(trigger.cron, start));
      }
    }
    onTime(start);
  }

  private stat(fn: SimFunction): FnStats {
    const s = this.stats.get(fn.config.id);
    if (!s) throw new Error("unknown function");
    return s;
  }

  /** What `inngest.send` / `step.sendEvent` hand to Inngest. */
  send(events: unknown): { ids: string[] } {
    const list = (Array.isArray(events) ? events : [events]).map(toEventIn);
    this.outbox.push(...list.filter((e) => !this.dropEvent(e)));
    return { ids: list.map((e) => e.id ?? "") };
  }

  private receive(e: EventIn): void {
    if (e.id) {
      const seen = this.seenEventIds.get(e.id);
      if (seen !== undefined && this.now - seen < DEDUPE_MS) return;
      this.seenEventIds.set(e.id, this.now);
    }
    const delivered: DeliveredEvent = {
      id: e.id,
      name: e.name,
      ts: e.ts ?? this.now,
      data: e.data ?? {},
    };
    this.accepted.push(delivered);
    if (delivered.ts > this.now) this.held.push(delivered);
    else this.deliver(delivered);
  }

  private deliver(event: DeliveredEvent): void {
    for (const run of this.runs) {
      if (run.status !== "sleeping" && run.status !== "ready") continue;
      for (const cancel of run.fn.config.cancelOn ?? []) {
        if (cancel.event !== event.name) continue;
        const expr = cancel.match
          ? `event.${cancel.match} == async.${cancel.match}`
          : cancel.if;
        if (!expr || evalCondition(expr, { event: run.event, async: event })) {
          run.status = "cancelled";
          this.stat(run.fn).cancelled++;
        }
      }
    }
    for (const fn of this.fns) {
      if (
        !fn.config.triggers.some((t) => "event" in t && t.event === event.name)
      )
        continue;
      this.start(fn, event);
    }
  }

  private start(fn: SimFunction, event: DeliveredEvent): void {
    if (fn.config.idempotency) {
      const key = `${fn.config.id}:${String(readPath({ event }, fn.config.idempotency))}`;
      const seen = this.idempotency.get(key);
      if (seen !== undefined && this.now - seen < DEDUPE_MS) return;
      this.idempotency.set(key, this.now);
    }
    this.stat(fn).runs++;
    this.runs.push({
      seq: this.seq++,
      fn,
      event,
      memo: new Map(),
      attempts: new Map(),
      status: "ready",
      wakeAt: this.now,
    });
  }

  private stepTools(run: Run) {
    const memoized = (id: string): Memo | undefined => run.memo.get(id);
    const replay = (m: Memo): unknown => {
      if (!m.ok) throw new StepFailed(m.error);
      return m.data;
    };
    return {
      run: async (id: string, body: () => unknown) => {
        const m = memoized(id);
        if (m) return replay(m);
        this.stat(run.fn).steps++;
        try {
          const data: unknown = JSON.parse(
            JSON.stringify((await body()) ?? null),
          );
          run.memo.set(id, { ok: true, data });
          return data;
        } catch (error) {
          const attempts = (run.attempts.get(id) ?? 0) + 1;
          run.attempts.set(id, attempts);
          if (attempts <= (run.fn.config.retries ?? 3)) {
            throw new Suspend(this.now + RETRY_DELAY_MS);
          }
          const message =
            error instanceof Error ? error.message : String(error);
          run.memo.set(id, { ok: false, error: message });
          throw new StepFailed(message);
        }
      },
      sleepUntil: async (id: string, at: Date | string) => {
        if (memoized(id)) return;
        const until = new Date(at).getTime();
        if (until > this.now) throw new Suspend(until);
        this.stat(run.fn).steps++;
        run.memo.set(id, { ok: true, data: null });
      },
      sendEvent: async (id: string, events: unknown) => {
        const m = memoized(id);
        if (m) return replay(m);
        this.stat(run.fn).steps++;
        const data = this.send(events);
        run.memo.set(id, { ok: true, data });
        return data;
      },
    };
  }

  private async execute(run: Run): Promise<void> {
    try {
      run.result = await run.fn.handler({
        event: run.event,
        step: this.stepTools(run),
      });
      run.status = "completed";
    } catch (error) {
      if (error instanceof Suspend) {
        run.status = "sleeping";
        run.wakeAt = error.until;
        return;
      }
      run.status = "failed";
      run.error = error instanceof Error ? error.message : String(error);
      this.stat(run.fn).failed++;
    }
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.outbox.shift();
      if (next) {
        this.receive(next);
        continue;
      }
      const ready = this.runs.find(
        (r) =>
          r.status === "ready" ||
          (r.status === "sleeping" && r.wakeAt <= this.now),
      );
      if (!ready) return;
      await this.execute(ready);
    }
  }

  private nextAgenda(): number | null {
    const times = [
      ...this.held.map((e) => e.ts),
      ...this.runs.filter((r) => r.status === "sleeping").map((r) => r.wakeAt),
      ...this.cronNext.values(),
    ];
    return times.length ? Math.min(...times) : null;
  }

  /** Runs everything due up to `until`, in time order. */
  async advanceTo(until: number): Promise<void> {
    await this.drain();
    for (;;) {
      const at = this.nextAgenda();
      if (at === null || at > until) break;
      this.now = Math.max(this.now, at);
      this.onTime(this.now);
      const due = this.held.filter((e) => e.ts <= this.now);
      this.held = this.held.filter((e) => e.ts > this.now);
      for (const e of due) this.deliver(e);
      for (const fn of this.fns) {
        const fire = this.cronNext.get(fn.config.id);
        if (fire !== undefined && fire <= this.now) {
          this.cronNext.set(
            fn.config.id,
            nextCron(this.cronTrigger(fn), this.now),
          );
          this.start(fn, {
            name: "inngest/scheduled.timer",
            ts: this.now,
            data: {},
          });
        }
      }
      await this.drain();
    }
    this.now = Math.max(this.now, until);
    this.onTime(this.now);
  }

  /** Lets in-process work (an action's send) reach Inngest at `now`. */
  async flush(): Promise<void> {
    await this.drain();
  }

  private cronTrigger(fn: SimFunction): string {
    for (const t of fn.config.triggers) if ("cron" in t) return t.cron;
    throw new Error("no cron");
  }

  /** Inngest losing scheduled work: every sleeping run and held event. */
  loseScheduledWork(): void {
    for (const run of this.runs)
      if (run.status === "sleeping") run.status = "cancelled";
    this.held = [];
  }

  live(fnId: string): number {
    return this.runs.filter(
      (r) =>
        r.fn.config.id === fnId &&
        (r.status === "sleeping" || r.status === "ready"),
    ).length;
  }

  results(fnId: string): unknown[] {
    return this.runs
      .filter((r) => r.fn.config.id === fnId && r.status === "completed")
      .map((r) => r.result);
  }
}
