SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Denies of the permissions dropped from the matrix (audit w1-s4 F4).
--
-- retentions:read, stock_movements:read and credit_debit_notes:read left
-- lib/auth/permissions.ts: no gate read them. A stored deny of one of them
-- used to hide its whole module, so it also denied the module's write
-- (retentions:write, stock_movements:write, credit_debit_notes:issue), which
-- the matrix keeps and now gates. resolveAccess drops a deny string it does
-- not know, so without this the user would regain that write. Each such deny
-- becomes a deny of the write it covered.
--
-- The old rows stay: the current code ignores them, and code rolled back to
-- before this change reads them as it did. channels:read, channels:write and
-- files:admin denies need nothing: their modules had nothing else to deny.

insert into public.user_permission_denies (user_id, permission, reason, created_by)
select d.user_id, m.write_permission, d.reason, d.created_by
  from public.user_permission_denies d
  join (
    values
      ('retentions:read', 'retentions:write'),
      ('stock_movements:read', 'stock_movements:write'),
      ('credit_debit_notes:read', 'credit_debit_notes:issue')
  ) as m (read_permission, write_permission)
    on m.read_permission = d.permission
on conflict (user_id, permission) do nothing;
