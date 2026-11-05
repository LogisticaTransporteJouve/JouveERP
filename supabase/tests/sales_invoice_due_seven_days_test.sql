-- A sales comprobante is due 7 days after its date unless it carries a later
-- due date (20261105200000), and only the sync closes an automatic task
-- (20261105200001): the rule itself, the aging, the late interest, the AI
-- summary and the collection tasks. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(20);

-- 1. The rule ---------------------------------------------------------------------

select results_eq(
  $$select public.invoice_effective_due_date('2026-11-02', null),
           public.invoice_effective_due_date('2026-11-02', '2026-11-02'),
           public.invoice_effective_due_date('2026-11-02', '2026-10-30'),
           public.invoice_effective_due_date('2026-11-02', '2026-12-02')$$,
  $$values ('2026-11-09'::date, '2026-11-09'::date, '2026-11-09'::date, '2026-12-02'::date)$$,
  'due 7 days after the date, unless the comprobante carries a later due date'
);

select ok(
  has_function_privilege('authenticated', 'public.invoice_effective_due_date(date, date)', 'execute')
  and not has_function_privilege('anon', 'public.invoice_effective_due_date(date, date)', 'execute'),
  'the user''s client reads the aging through the rule; anon does not'
);

-- 2. Documents ----------------------------------------------------------------------

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-00000000d7c1', false, null, 'Cliente Vence 7', null);

-- A: 8 days old, no due date. B: 7 days old, due date = its date (as ARCA
-- imports it). C: 2 days old. D: 40 days old, due in 10 days.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, fch_vto_pago, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, moneda, cotizacion, status, idempotency_key)
values
  ('00000000-0000-0000-0000-00000000d7a1', 'jouve_internal', '00000000-0000-0000-0000-00000000d7c1',
   'factura', null, 9001, 97001, current_date - 8, null, 2, 99, '0', 1000, 0, 1000, 'PES', 1,
   'emitted', 'due7-a'),
  ('00000000-0000-0000-0000-00000000d7a2', 'jouve_internal', '00000000-0000-0000-0000-00000000d7c1',
   'factura', null, 9001, 97002, current_date - 7, current_date - 7, 2, 99, '0', 500, 0, 500, 'PES', 1,
   'emitted', 'due7-b'),
  ('00000000-0000-0000-0000-00000000d7a3', 'jouve_internal', '00000000-0000-0000-0000-00000000d7c1',
   'factura', null, 9001, 97003, current_date - 2, current_date - 2, 2, 99, '0', 200, 0, 200, 'PES', 1,
   'emitted', 'due7-c'),
  ('00000000-0000-0000-0000-00000000d7a4', 'jouve_internal', '00000000-0000-0000-0000-00000000d7c1',
   'factura', null, 9001, 97004, current_date - 40, current_date + 10, 2, 99, '0', 300, 0, 300, 'PES', 1,
   'emitted', 'due7-d');

-- 3. Aging ------------------------------------------------------------------------------

select results_eq(
  $$select invoice_id, due_date, days_overdue, bucket, fch_vto_pago
      from public.v_aging_documents
     where client_id = '00000000-0000-0000-0000-00000000d7c1'
     order by numero$$,
  $$values
    ('00000000-0000-0000-0000-00000000d7a1'::uuid, current_date - 1, 1, '0_30'::text, null::date),
    ('00000000-0000-0000-0000-00000000d7a2'::uuid, current_date, 0, '0_30'::text, current_date - 7),
    ('00000000-0000-0000-0000-00000000d7a3'::uuid, current_date + 5, -5, '0_30'::text, current_date - 2),
    ('00000000-0000-0000-0000-00000000d7a4'::uuid, current_date + 10, -10, '0_30'::text, current_date + 10)$$,
  'the aging counts from the effective due date and keeps the stored AFIP one'
);

select is(
  (select oldest_days from public.v_client_aging
    where client_id = '00000000-0000-0000-0000-00000000d7c1'),
  1,
  'the client aging follows: the oldest debt is 1 day past due, not 40'
);

-- 4. Late interest and the AI summary -------------------------------------------------

create temp table t_cand on commit drop as
  select * from public.late_interest_candidates(current_date)
   where client_id = '00000000-0000-0000-0000-00000000d7c1';

select results_eq(
  $$select invoice_id, due_date, charge_from from t_cand$$,
  $$values ('00000000-0000-0000-0000-00000000d7a1'::uuid, current_date - 1, current_date)$$,
  'late interest runs from the day after the effective due date, and only on what is past it'
);

select is(
  (select overdue_ars from public.ai_client_sales_summary(
     current_date - 60, current_date, '00000000-0000-0000-0000-00000000d7c1', 50, null)),
  1000::numeric,
  'the AI summary counts as overdue only what is past the effective due date'
);

-- 5. Collection tasks ---------------------------------------------------------------------

-- C carries an open task from before, dated on its fecha (the old rule).
insert into public.tasks (id, title, due_date, origin, kind, source_table, source_id) values
  ('00000000-0000-0000-0000-00000000d7f3', 'Cobrar C', current_date - 2, 'automatic', 'collection',
   'invoices', '00000000-0000-0000-0000-00000000d7a3');

create temporary table t_sync1 as
  select * from public.sync_automatic_tasks(current_date);

select results_eq(
  $$select source_id, due_date, status from public.tasks
     where source_table = 'invoices' and kind = 'collection'
       and source_id in ('00000000-0000-0000-0000-00000000d7a1',
                         '00000000-0000-0000-0000-00000000d7a2',
                         '00000000-0000-0000-0000-00000000d7a4')
     order by source_id$$,
  $$values ('00000000-0000-0000-0000-00000000d7a1'::uuid, current_date - 1, 'open'::text)$$,
  'a factura gets its collection task 8 days after its date, none before'
);

select results_eq(
  $$select status, auto_closed from public.tasks
     where id = '00000000-0000-0000-0000-00000000d7f3'$$,
  $$values ('done'::text, true)$$,
  'an open collection task of a factura not due yet closes by itself'
);

select is(
  (select change from t_sync1 where task_id = '00000000-0000-0000-0000-00000000d7f3'),
  'closed',
  'and the sync reports it'
);

select is(
  current_setting('jouve.syncing_tasks', true),
  '',
  'the sync clears its flag when it ends'
);

create temporary table t_sync2 as
  select * from public.sync_automatic_tasks(current_date + 1);

select results_eq(
  $$select due_date, status from public.tasks
     where source_table = 'invoices' and kind = 'collection'
       and source_id = '00000000-0000-0000-0000-00000000d7a2'$$,
  $$values (current_date, 'open'::text)$$,
  'the next day the factura due today gets its task'
);

create temporary table t_sync3 as
  select * from public.sync_automatic_tasks(current_date + 6);

select results_eq(
  $$select status, auto_closed, due_date from public.tasks
     where id = '00000000-0000-0000-0000-00000000d7f3'$$,
  $$values ('open'::text, false, current_date + 5)$$,
  'once past its effective due date the closed task opens again with that date'
);

-- 6. Only the sync closes an automatic task -------------------------------------------------

select throws_ok(
  $$update public.tasks set status = 'done', completed_at = now()
     where id = '00000000-0000-0000-0000-00000000d7f3'$$,
  '23514',
  'Una tarea automática no se marca como hecha: se cierra sola cuando su documento ya no tiene nada pendiente.',
  'an automatic task is not marked done by hand'
);

-- Settled by a credit note for all of it: the sync closes it.
insert into public.invoices
  (id, channel_id, client_id, kind, letter, punto_venta, numero, fecha, concepto,
   doc_tipo, doc_nro, imp_neto, imp_iva, imp_total, status, idempotency_key, invoice_origin_id)
values
  ('00000000-0000-0000-0000-00000000d7a5', 'jouve_internal', '00000000-0000-0000-0000-00000000d7c1',
   'nc', null, 9001, 97005, current_date, 2, 99, '0', 200, 0, 200, 'emitted',
   'due7-c-nc', '00000000-0000-0000-0000-00000000d7a3');
create temporary table t_sync4 as
  select * from public.sync_automatic_tasks(current_date + 6);

select results_eq(
  $$select status, auto_closed from public.tasks
     where id = '00000000-0000-0000-0000-00000000d7f3'$$,
  $$values ('done'::text, true)$$,
  'the sync closes it once the document has nothing pending'
);

select lives_ok(
  $$update public.tasks set status = 'open', completed_at = null, auto_closed = false
     where id = '00000000-0000-0000-0000-00000000d7f3'$$,
  'reopening by hand stays allowed'
);

insert into public.tasks (id, title, origin) values
  ('00000000-0000-0000-0000-00000000d7f9', 'Llamar a Cliente Vence 7', 'manual');

select lives_ok(
  $$update public.tasks set status = 'done', completed_at = now()
     where id = '00000000-0000-0000-0000-00000000d7f9'$$,
  'a manual task is still marked done by hand'
);

-- Through the API too.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000d7b1', 'finance@due7.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-00000000d7b1', 'finance');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-00000000d7b1","role":"authenticated"}', true);

select throws_ok(
  $$update public.tasks set status = 'done', completed_at = now(), auto_closed = true
     where source_id = '00000000-0000-0000-0000-00000000d7a1'$$,
  '23514',
  null,
  'nor through the API, not even flagged as the sync''s'
);

select is(
  (select count(*)::int from public.v_aging_documents
    where client_id = '00000000-0000-0000-0000-00000000d7c1' and due_date is not null),
  3,
  'finance reads the aging with its due dates'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 7. Hand-closed tasks from before go to the sync -----------------------------------------

-- As 20261105200001 left one closed by hand while its factura is unpaid.
alter table public.tasks disable trigger tasks_guard_automatic_close;
update public.tasks
   set status = 'done', completed_at = now(), auto_closed = false,
       completed_by = '00000000-0000-0000-0000-00000000d7b1'
 where source_id = '00000000-0000-0000-0000-00000000d7a1';
alter table public.tasks enable trigger tasks_guard_automatic_close;

update public.tasks set auto_closed = true, completed_by = null
 where origin = 'automatic' and status = 'done' and not auto_closed;
create temporary table t_sync5 as
  select * from public.sync_automatic_tasks(current_date);

select results_eq(
  $$select status, auto_closed, completed_by from public.tasks
     where source_id = '00000000-0000-0000-0000-00000000d7a1'$$,
  $$values ('open'::text, false, null::uuid)$$,
  'a task closed by hand while its factura is unpaid opens again'
);

select is(
  (select count(*)::int from public.tasks
    where origin = 'automatic' and status = 'done' and not auto_closed),
  0,
  'no automatic task is left closed by hand'
);

select * from finish();

rollback;
