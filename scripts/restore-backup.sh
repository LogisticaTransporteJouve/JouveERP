#!/usr/bin/env bash
# M.1 — restaurar un dump de backups-daily/ a una DB target.
#
# IMPORTANTE: el restore SOBRESCRIBE la DB target. Nunca apuntar a prod
# salvo emergencia. El uso típico es:
#   * drill mensual: restaurar a un proyecto Supabase temporal y
#     verificar que las tablas y row counts coinciden.
#   * recovery de incidente: restaurar a un proyecto nuevo y migrar
#     usuarios.
#
# Uso:
#   ./scripts/restore-backup.sh backup-2026-05-16.dump postgresql://...target
#
# Requisitos:
#   * pg_restore (viene con el client de Postgres 14+).
#   * El dump debe estar descargado localmente. Para bajar uno del
#     bucket, usá Supabase Studio → Storage → backups-daily → click +
#     download, o:
#       supabase storage download backups-daily/backup-YYYY-MM-DD.dump
#
# Proceso:
#   1. Validar argumentos.
#   2. pg_restore --clean --if-exists --no-owner --no-acl.
#   3. Verificar row counts en tablas clave vs el dump.

set -euo pipefail

DUMP_FILE="${1:-}"
TARGET_URL="${2:-}"

if [[ -z "$DUMP_FILE" || -z "$TARGET_URL" ]]; then
  echo "Uso: $0 <dump-file> <target-database-url>"
  echo ""
  echo "Ejemplo:"
  echo "  $0 backup-2026-05-16.dump postgresql://postgres:pwd@host:5432/postgres"
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump $DUMP_FILE no existe."
  exit 1
fi

echo "============================================================"
echo "RESTAURANDO $DUMP_FILE → $TARGET_URL"
echo "============================================================"
echo ""
echo "Esto va a:"
echo "  - DROPEAR todas las tablas y funciones existentes en la DB target"
echo "  - RECREARLAS con el schema del dump"
echo "  - INSERTAR todos los datos del dump"
echo ""
read -p "¿Seguir? (escribí 'restore' para confirmar): " CONFIRM
if [[ "$CONFIRM" != "restore" ]]; then
  echo "Abortado."
  exit 1
fi

echo ""
echo "→ pg_restore en progreso..."
pg_restore \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --dbname="$TARGET_URL" \
  --verbose \
  "$DUMP_FILE"

echo ""
echo "============================================================"
echo "✓ Restore completado. Verificá row counts:"
echo "============================================================"
psql "$TARGET_URL" -c "
select
  'invoices' as tabla, count(*) as filas from public.invoices union all
  select 'purchase_invoices', count(*) from public.purchase_invoices union all
  select 'clients',           count(*) from public.clients union all
  select 'suppliers',         count(*) from public.suppliers union all
  select 'transactions',      count(*) from public.transactions union all
  select 'receipts',          count(*) from public.receipts union all
  select 'payment_orders',    count(*) from public.payment_orders union all
  select 'journal_entries',   count(*) from public.journal_entries
order by tabla;
"

echo ""
echo "Si los row counts cuadran con prod (o con el snapshot esperado),"
echo "el drill fue exitoso. Logueá la fecha del drill en"
echo "/admin/backups → \"Marcar drill OK\"."
