import { AlertTriangle, FileWarning, ListTodo, Route, Sun } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Section } from "@/components/ui/section";
import { TRIP_STATUS_LABELS, isTripStatus } from "@/features/trips/schema";
import { formatArDateShort } from "@/lib/format";

import {
  PAPER_HOLDER_KINDS,
  PAPER_HOLDER_LABEL,
  type PendingPaper,
  type TodayTask,
  type TodayTile,
  type TodayTrip,
} from "../schema";

const MAX_ROWS = 8;
/** Papers shown per holder group (trucks, drivers, employees). */
const MAX_PAPERS_PER_GROUP = 4;

/**
 * "Hoy y esta semana" (decision D12): what is due by the end of the week or
 * already overdue, today's trips and the papers to renew. A tile is passed
 * only when the user can read its module; a failed read shows its message.
 */
export function TodayWeek({
  today,
  tasks,
  trips,
  papers,
  papersHref,
}: {
  today: string;
  tasks: TodayTile<TodayTask[]> | null;
  trips: TodayTile<TodayTrip[]> | null;
  papers: TodayTile<PendingPaper[]> | null;
  /** Where "Ver todo" of the papers goes: the module the user can read. */
  papersHref: string;
}) {
  if (!tasks && !trips && !papers) return null;
  return (
    <Section
      title="Hoy y esta semana"
      icon={Sun}
      description="Lo vencido, lo que vence en los próximos 7 días, los viajes de hoy y los papeles por renovar"
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {tasks && (
          <Tile title="Vencimientos" icon={ListTodo} href="/tasks">
            <TileBody
              tile={tasks}
              empty="Nada vencido ni por vencer esta semana."
              render={(rows) => <TaskList rows={rows} today={today} />}
            />
          </Tile>
        )}
        {trips && (
          <Tile title="Viajes de hoy" icon={Route} href="/trips">
            <TileBody
              tile={trips}
              empty="Sin viajes para hoy."
              render={(rows) => <TripList rows={rows} />}
            />
          </Tile>
        )}
        {papers && (
          <Tile title="Papeles por vencer" icon={FileWarning} href={papersHref}>
            <TileBody
              tile={papers}
              empty="Sin papeles vencidos ni por vencer en 30 días."
              capped={false}
              render={(rows) => <PaperList rows={rows} />}
            />
          </Tile>
        )}
      </div>
    </Section>
  );
}

function Tile({
  title,
  icon: Icon,
  href,
  children,
}: {
  title: string;
  icon: typeof Sun;
  href: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Icon aria-hidden className="size-4 text-muted-foreground" />
          {title}
        </h3>
        <Link
          href={href}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Ver todo
        </Link>
      </div>
      {children}
    </div>
  );
}

function TileBody<T>({
  tile,
  empty,
  render,
  capped = true,
}: {
  tile: TodayTile<T[]>;
  empty: string;
  render: (rows: T[]) => ReactNode;
  /** Cut the list at MAX_ROWS; off when the list caps its own groups. */
  capped?: boolean;
}) {
  if (!tile.ok) {
    return <p className="p-3 text-sm text-muted-foreground">{tile.error}</p>;
  }
  if (tile.data.length === 0) {
    return <p className="p-3 text-sm text-muted-foreground">{empty}</p>;
  }
  const hidden = capped ? tile.data.length - MAX_ROWS : 0;
  return (
    <>
      {render(capped ? tile.data.slice(0, MAX_ROWS) : tile.data)}
      {hidden > 0 && (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          +{hidden} más.
        </p>
      )}
    </>
  );
}

function TaskList({ rows, today }: { rows: TodayTask[]; today: string }) {
  return (
    <ul className="divide-y">
      {rows.map((t) => {
        const overdue = t.due_date < today;
        return (
          <li key={t.id}>
            <Link
              href={t.href}
              className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50"
            >
              <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                {t.due_date === today ? "Hoy" : formatArDateShort(t.due_date)}
              </span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {overdue && (
                <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                  <AlertTriangle aria-hidden className="size-3.5" />
                  Vencida
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TripList({ rows }: { rows: TodayTrip[] }) {
  return (
    <ul className="divide-y">
      {rows.map((t) => (
        <li key={t.id}>
          <Link
            href={t.href}
            className="flex items-start gap-3 px-3 py-2 text-sm hover:bg-accent/50"
          >
            <span className="w-20 shrink-0 font-mono text-xs">
              {t.patente ?? "Sin camión"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {t.driver ?? "Sin chofer"}
                {t.clients.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {t.clients.join(", ")}
                  </span>
                )}
              </span>
              {(t.origin || t.destination) && (
                <span className="block truncate text-xs text-muted-foreground">
                  {t.origin ?? "—"} → {t.destination ?? "—"}
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {isTripStatus(t.status) ? TRIP_STATUS_LABELS[t.status] : t.status}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PaperList({ rows }: { rows: PendingPaper[] }) {
  return (
    <div className="divide-y">
      {PAPER_HOLDER_KINDS.map((kind) => {
        const group = rows.filter((p) => p.holder_kind === kind);
        if (group.length === 0) return null;
        const expired = group.filter((p) => p.expired).length;
        return (
          <div key={kind}>
            <p className="bg-muted/30 px-3 py-1 text-xs font-medium text-muted-foreground">
              {PAPER_HOLDER_LABEL[kind]} · {expired} vencido(s),{" "}
              {group.length - expired} por vencer
            </p>
            <ul className="divide-y">
              {group.slice(0, MAX_PAPERS_PER_GROUP).map((p) => (
                <li key={p.id}>
                  <Link
                    href={p.href}
                    className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/50"
                  >
                    <span className="shrink-0 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatArDateShort(p.expires_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {p.kind} · {p.holder}
                    </span>
                    {p.expired && (
                      <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
                        <AlertTriangle aria-hidden className="size-3.5" />
                        Vencido
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
            {group.length > MAX_PAPERS_PER_GROUP && (
              <p className="px-3 py-1 text-xs text-muted-foreground">
                +{group.length - MAX_PAPERS_PER_GROUP} más.
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
