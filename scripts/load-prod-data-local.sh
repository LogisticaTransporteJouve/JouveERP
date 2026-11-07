#!/usr/bin/env bash
# Copies production's public data into the LOCAL Supabase stack (never the
# other way). Replaces the local business data; keeps the local users and
# their roles (tomas@jouve.test stays owner).
#
#   pnpm db:load-prod                               # usa la contraseña guardada
#   pnpm db:load-prod --forget                      # borra lo guardado
#
# Connects through the Supabase session pooler (IPv4; the direct
# db.<ref>.supabase.co host is IPv6 only). The first run asks for the
# production database password (hidden), finds the pooler host of the
# project's region and, once the read works, saves the password in the macOS
# Keychain (item "jouve-prod-db") and the host in ~/.config/jouve/prod-db-host;
# later runs ask nothing. The password reaches pg_dump as PGPASSWORD, never in
# its command line. PROD_DB_URL, if set, is used as is instead.
# Left out: credentials and tokens (AFIP, ARCA, Strix), users and their access,
# per-user chat/AI/notifications, and caches that rebuild themselves.
set -euo pipefail

PROJECT_REF="${PROJECT_REF:-pdungqgfqsjjafoectjs}"
REGION="${REGION:-sa-east-1}"
DB_CONTAINER="${DB_CONTAINER:-supabase_db_JouveErp}"
OUT_BASE="$(mktemp -t jouve-prod-data)"
OUT="${OUT_BASE}.sql"
trap 'rm -f "$OUT_BASE" "$OUT" "$OUT.err"' EXIT

KEEP_LOCAL=(
  roles user_roles user_profiles user_permission_denies user_guide_states
  afip_ta_cache arca_web_account strix_account rate_limit_buckets padron_cache
  notifications push_subscriptions dashboard_layouts
  ai_chat_sessions ai_chat_messages ai_chat_confirmations ai_usage ai_insights
  ai_weekly_summaries chat_channels chat_channel_members chat_messages
  search_index search_index_state
)

exclude=()
for t in "${KEEP_LOCAL[@]}"; do exclude+=(--exclude-table-data="public.$t"); done

KEYCHAIN_SERVICE="jouve-prod-db"
HOST_FILE="${HOME}/.config/jouve/prod-db-host"

if [[ "${1:-}" == "--forget" ]]; then
  security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "$PROJECT_REF" >/dev/null 2>&1 || true
  rm -f "$HOST_FILE"
  echo "Borré la contraseña y el host guardados."
  exit 0
fi

# --no-password: a wrong or missing password fails instead of waiting for a
# prompt nobody sees.
dump() {
  docker exec -i -e PGPASSWORD "$DB_CONTAINER" pg_dump "$1" --no-password \
    --data-only --schema=public --no-owner --no-privileges \
    "${exclude[@]}" > "$OUT"
}

if [[ -n "${PROD_DB_URL:-}" ]]; then
  echo "Leyendo producción (solo lectura)…"
  dump "$PROD_DB_URL"
else
  saved=false
  if PGPASSWORD="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$PROJECT_REF" -w 2>/dev/null)"; then
    saved=true
    echo "Uso la contraseña guardada en el Llavero (${KEYCHAIN_SERVICE})."
  else
    PGPASSWORD=""
    while [[ -z "$PGPASSWORD" ]]; do
      read -r -s -p "Contraseña de la base de producción (${PROJECT_REF}): " PGPASSWORD
      echo
      [[ -z "$PGPASSWORD" ]] && echo "La contraseña está vacía: escribila (no se ve mientras tipeás) y dale Enter."
    done
  fi
  export PGPASSWORD

  hosts=()
  [[ -s "$HOST_FILE" ]] && hosts+=("$(cat "$HOST_FILE")")
  for cluster in aws-1 aws-0; do hosts+=("${cluster}-${REGION}.pooler.supabase.com"); done

  dumped=""
  for host in "${hosts[@]}"; do
    echo "Leyendo producción (solo lectura) por ${host}…"
    if dump "postgresql://postgres.${PROJECT_REF}@${host}:5432/postgres" 2> "$OUT.err"; then
      dumped="$host"
      break
    fi
    if grep -q "tenant/user" "$OUT.err"; then continue; fi
    cat "$OUT.err" >&2
    if grep -qi "password authentication failed" "$OUT.err" && [[ "$saved" == true ]]; then
      echo "La contraseña guardada ya no sirve: corré con --forget y volvé a correr para cargarla de nuevo." >&2
    fi
    rm -f "$OUT" "$OUT.err"
    exit 1
  done
  rm -f "$OUT.err"
  if [[ -z "$dumped" ]]; then
    echo "Ningún pooler de ${REGION} conoce el proyecto ${PROJECT_REF}: copiá la cadena «Session pooler» del dashboard y corré con PROD_DB_URL='…'." >&2
    rm -f "$OUT"
    exit 1
  fi

  if [[ "$saved" != true ]]; then
    security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$PROJECT_REF" \
      -l "JouveERP — base de producción (solo lectura local)" -w "$PGPASSWORD"
    echo "Guardé la contraseña en el Llavero (${KEYCHAIN_SERVICE}): la próxima vez no la pide."
  fi
  mkdir -p "$(dirname "$HOST_FILE")"
  echo "$dumped" > "$HOST_FILE"
  unset PGPASSWORD
fi
echo "Volcado: $(wc -l < "$OUT") líneas en $OUT"

keep_list=$(printf "'%s'," "${KEEP_LOCAL[@]}")
keep_list="${keep_list%,}"

echo "Vaciando los datos de negocio locales y cargando los de producción…"
{
  echo "begin;"
  echo "set local session_replication_role = replica;"
  echo "do \$\$ declare v text; begin"
  echo "  select string_agg(format('public.%I', tablename), ', ') into v"
  echo "    from pg_tables where schemaname = 'public'"
  echo "     and tablename not in (${keep_list});"
  echo "  if v is not null then execute 'truncate ' || v; end if;"
  echo "end \$\$;"
  cat "$OUT"
  echo "commit;"
} | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q

rm -f "$OUT"
echo "Listo: la base local tiene los datos de producción."
