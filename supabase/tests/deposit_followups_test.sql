-- Follow-up of 4.4: a general tariff may be limited to one area (never a
-- client's), and every block and unblock of a pallet leaves who, when and
-- why in pallet_block_events. One transaction, rolled back.

begin;

select plan(9);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000049a1', 'warehouse@deposito-fu.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000049a1', 'warehouse');

insert into public.clients (id, is_fiscal, cuit, legal_name, iva_condition) values
  ('00000000-0000-0000-0000-0000000049c1', false, null, 'Cliente Depósito FU', null);
insert into public.warehouses (id, name) values
  ('00000000-0000-0000-0000-0000000049b1', 'Depósito FU');
insert into public.storage_areas (id, warehouse_id, name) values
  ('00000000-0000-0000-0000-0000000049e1', '00000000-0000-0000-0000-0000000049b1', 'Frío FU');
insert into public.pallets (id, warehouse_id, client_id, code, entry_date) values
  ('00000000-0000-0000-0000-0000000049f1', '00000000-0000-0000-0000-0000000049b1',
   '00000000-0000-0000-0000-0000000049c1', 'DFU-1', '2026-10-01');

-- 1. Area tariffs -------------------------------------------------------------------

select lives_ok(
  $$insert into public.storage_tariffs (rate_per_pallet, valid_from, area_id)
    values (5000, '2026-01-01', '00000000-0000-0000-0000-0000000049e1')$$,
  'a general tariff can be limited to one area'
);
select throws_ok(
  $$insert into public.storage_tariffs (client_id, rate_per_pallet, valid_from, area_id)
    values ('00000000-0000-0000-0000-0000000049c1', 5000, '2026-01-01',
            '00000000-0000-0000-0000-0000000049e1')$$,
  '23514', null,
  'a client''s storage tariff has no area (its tarifario carries those)'
);

-- 2. Block history ------------------------------------------------------------------

update public.pallets
   set blocked_at = now(), blocked_by = '00000000-0000-0000-0000-0000000049a1',
       block_reason = 'Control de calidad'
 where id = '00000000-0000-0000-0000-0000000049f1';

select results_eq(
  $$select action, reason, actor_id from public.pallet_block_events
     where pallet_id = '00000000-0000-0000-0000-0000000049f1'$$,
  $$values ('blocked'::text, 'Control de calidad'::text,
            '00000000-0000-0000-0000-0000000049a1'::uuid)$$,
  'a block is recorded with its reason and who did it'
);

select throws_ok(
  $$select public.unblock_pallet('00000000-0000-0000-0000-0000000049f1', '  ')$$,
  '23514', 'Contá por qué se desbloquea el pallet (hasta 500 caracteres).',
  'an unblock needs its reason'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000049a1","role":"authenticated"}', true);

select is(
  public.unblock_pallet('00000000-0000-0000-0000-0000000049f1', 'Aprobado'),
  true, 'the warehouse unblocks it with a reason'
);
select results_eq(
  $$select action, reason, actor_id from public.pallet_block_events
     where pallet_id = '00000000-0000-0000-0000-0000000049f1'
     order by created_at, action$$,
  $$values ('blocked'::text, 'Control de calidad'::text,
            '00000000-0000-0000-0000-0000000049a1'::uuid),
           ('unblocked'::text, 'Aprobado'::text,
            '00000000-0000-0000-0000-0000000049a1'::uuid)$$,
  'the unblock is recorded with its reason and who did it, and the warehouse reads the history'
);
select is(
  public.unblock_pallet('00000000-0000-0000-0000-0000000049f1', 'otra vez'),
  false, 'unblocking a pallet that is not blocked changes nothing'
);
select throws_ok(
  $$insert into public.pallet_block_events (pallet_id, action)
    values ('00000000-0000-0000-0000-0000000049f1', 'blocked')$$,
  '42501', null,
  'nobody writes the history by hand'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select is(
  (select count(*)::int from public.pallet_block_events
    where pallet_id = '00000000-0000-0000-0000-0000000049f1'),
  2, 'and nothing else was recorded'
);

select * from finish();
rollback;
