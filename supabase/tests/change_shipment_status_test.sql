-- change_shipment_status (20261106111000): the status change and its history
-- row in one transaction; a transition that does not apply to the current
-- status writes nothing; RLS decides which cargas a caller reaches. One
-- transaction, rolled back.

begin;

select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'ops@shipment-status.test'),
  ('00000000-0000-0000-0000-0000000005a2', 'warehouse@shipment-status.test');
insert into public.user_roles (user_id, role_id) values
  ('00000000-0000-0000-0000-0000000005a1', 'operations'),
  ('00000000-0000-0000-0000-0000000005a2', 'warehouse');

insert into public.shipments (id, status) values
  ('00000000-0000-0000-0000-0000000005b1', 'not_started'),
  ('00000000-0000-0000-0000-0000000005b2', 'not_started');

select ok(
  has_function_privilege('authenticated', 'public.change_shipment_status(uuid, text, text, date, text, date)', 'execute')
  and not has_function_privilege('anon', 'public.change_shipment_status(uuid, text, text, date, text, date)', 'execute'),
  'authenticated runs change_shipment_status; anon does not'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);

select is(
  public.change_shipment_status('00000000-0000-0000-0000-0000000005b1', 'in_progress', 'sale'),
  'not_started',
  'it returns the status it left'
);

select results_eq(
  $$select old_status, new_status, comment, changed_by
      from public.shipment_status_history
     where shipment_id = '00000000-0000-0000-0000-0000000005b1'$$,
  $$values ('not_started'::text, 'in_progress'::text, 'sale'::text,
            '00000000-0000-0000-0000-0000000005a1'::uuid)$$,
  'the history row carries the old and new status and the caller'
);

select lives_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000005b1',
      'delivered', p_delivery_date => '2026-11-06')$$,
  'in progress → delivered'
);

select results_eq(
  $$select status, delivery_date from public.shipments
     where id = '00000000-0000-0000-0000-0000000005b1'$$,
  $$values ('delivered'::text, '2026-11-06'::date)$$,
  'delivered stamps the delivery date'
);

select throws_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000005b1', 'cancelled')$$,
  '55006',
  null,
  'a delivered carga cannot be cancelled'
);

select results_eq(
  $$select s.status, (select count(*)::int from public.shipment_status_history h
                        where h.shipment_id = s.id)
      from public.shipments s
     where s.id = '00000000-0000-0000-0000-0000000005b1'$$,
  $$values ('delivered'::text, 2)$$,
  'the refused change wrote neither the status nor a history row'
);

select lives_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000005b2',
      'cancelled', p_failure_reason => 'sin stock')$$,
  'not started → cancelled'
);

select lives_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000005b2',
      'reprogrammed', p_failure_reason => 'nueva fecha', p_scheduled_date => '2026-11-20')$$,
  'cancelled → reprogrammed'
);

select results_eq(
  $$select status, failure_reason, scheduled_date from public.shipments
     where id = '00000000-0000-0000-0000-0000000005b2'$$,
  $$values ('reprogrammed'::text, 'nueva fecha'::text, '2026-11-20'::date)$$,
  'reprogram stores the reason and the new date'
);

select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}', true);

select throws_ok(
  $$select public.change_shipment_status('00000000-0000-0000-0000-0000000005b2', 'reprogrammed')$$,
  'P0002',
  'No se encontró la carga.',
  'a carga the caller cannot see reads as not found'
);

select * from finish();
rollback;
