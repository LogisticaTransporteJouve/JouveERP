import { z } from "zod";

import { listUsersAction } from "@/features/admin-users/actions/users-actions";
import { listBackupsAction } from "@/features/backups/actions/backups-actions";
import { listImportRunsAction } from "@/features/imports/actions/import-actions";

import { defineAiAction } from "../define";
import { errResult, okResult, reachedCap } from "../result";

// The admin pages a question can be about (/admin/users, /admin/imports,
// /admin/backups), each through the page's own read action and permission
// (users:read, imports:read, audit:read).

export const getUsers = defineAiAction({
  name: "getUsers",
  domain: "general",
  permission: "users:read",
  sideEffect: "read",
  sources: ["auth.users", "user_roles"],
  description:
    "Usuarios del sistema (Administración → Usuarios): email, roles, alta y último ingreso. Para '¿quién tiene acceso como finanzas?' o '¿cuándo entró por última vez X?'.",
  input: z.object({}),
  run: async () => {
    const res = await listUsersAction();
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} usuarios.`, res.data);
  },
});

/** Runs listImportRunsAction returns at most (its own cap). */
const IMPORT_RUNS_CAP = 200;

export const getImportRuns = defineAiAction({
  name: "getImportRuns",
  domain: "general",
  permission: "imports:read",
  sideEffect: "read",
  sources: ["import_runs"],
  description:
    "Importaciones de planillas (Administración → Importaciones): tipo, archivo, estado, filas totales, insertadas, con el código del banco completado (extractos), salteadas e inválidas, quién y cuándo, y si se deshizo. Las 200 más recientes.",
  input: z.object({}),
  run: async () => {
    const res = await listImportRunsAction();
    if (!res.ok) return errResult(res.error);
    return okResult(`${res.data.length} importaciones.`, res.data, {
      partial: reachedCap(res.data.length, IMPORT_RUNS_CAP),
    });
  },
});

/** Files listBackupsAction returns at most (its own cap). */
const BACKUPS_CAP = 100;

export const getBackups = defineAiAction({
  name: "getBackups",
  domain: "general",
  permission: "audit:read",
  sideEffect: "read",
  sources: ["storage: backups-daily"],
  description:
    "Backups diarios de la base (Administración → Backups): archivo, tamaño y fecha, el más nuevo primero. Para '¿cuándo fue el último backup?'.",
  input: z.object({}),
  run: async () => {
    const res = await listBackupsAction();
    if (!res.ok) return errResult(res.error);
    const latest = res.data[0];
    return okResult(
      `${res.data.length} backups` +
        (latest ? ` · el último ${latest.createdAt}.` : "."),
      res.data,
      { partial: reachedCap(res.data.length, BACKUPS_CAP) },
    );
  },
});
