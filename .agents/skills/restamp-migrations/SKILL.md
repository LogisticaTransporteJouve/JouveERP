---
name: restamp-migrations
description: >-
  Give one or more of this branch's Supabase migrations in `supabase/migrations/` fresh UTC
  timestamps, preserving their relative order, via `pnpm db:restamp`. Use when a branch's migration
  is older than the newest one on `origin/main`, CI's "New migration names and timestamps" step
  fails ("not after …"), two PRs collide on a stamp, or the user says "restamp", "bump the migration
  timestamp", "my migration is out of order".
argument-hint: "[<name-substring>...]"
allowed-tools: Bash, Read
---

# /restamp-migrations

Renames the selected `supabase/migrations/<stamp>_<name>.sql` files to
`$(date -u +%Y%m%d%H%M%S)_<name>.sql` with `git mv`, one second apart so the selection keeps its
relative order. The script is `scripts/dev/restamp-migrations.sh`; its comments say why stamps are UTC.

```shell
pnpm db:restamp                 # every migration this branch adds on top of origin/main, plus untracked ones
pnpm db:restamp <substring>...  # only migrations whose name contains it; lists them and asks [y/N]
```

The script refuses, before renaming anything, when a selected file:

- is already on `origin/main` — a merged migration is never renamed (CLAUDE.md: never edit a merged
  migration; production has applied it);
- does not match `^[0-9]{14}_[a-z0-9_]+\.sql$`;
- would not sort after the newest stamp on `origin/main`.

With substrings and no terminal it aborts; an agent shows the user the list and pipes `y` only after
they confirm.

## When to run it

- Your branch adds a migration whose stamp is **not after** the newest one on `origin/main` — another
  PR merged a later one first. Rebase on `origin/main`, then run `pnpm db:restamp` with no arguments.
- Two open PRs carry the same or interleaved stamps: restamp the one that will merge second.

## Steps

1. With no arguments the tool restamps ALL of the branch's migrations, not only the stale one, so they
   keep their order among themselves. With substrings it sorts the matches by current name first.
2. Grep for the old stamps (`git grep <old-stamp>`): comments in other migrations, docs, skills or
   tests can cite a migration by filename. Point them at the new stamp.
3. Re-apply locally (`supabase db reset` on the local stack), run `bash scripts/check-migrations.sh origin/main`,
   and regenerate types only if the schema changed (`pnpm db:types:generate`). Commit the renames.

Never run `supabase db push` or `supabase link` (blocked by `.claude/settings.json`); production
migrations deploy only through CI's approved `Push migrations to production` job.
