-- Audit w1-s2 F10: a transfer never moves money in or out of a check
-- cartera; between two banks it still works. One transaction, rolled back.

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

begin;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select plan(3);

insert into public.accounts (id, name, type, currency) values
  ('00000000-0000-0000-0000-00000000a121', 'Cartera transfer', 'checks', 'ARS'),
  ('00000000-0000-0000-0000-00000000a122', 'Banco transfer A', 'bank', 'ARS'),
  ('00000000-0000-0000-0000-00000000a123', 'Banco transfer B', 'bank', 'ARS');

select throws_ok(
  $$select * from public.create_transfer('00000000-0000-0000-0000-00000000a121', '00000000-0000-0000-0000-00000000a122',
      'jouve_internal', 10, 'ARS', current_date, date_trunc('month', current_date)::date, 'x')$$,
  '23514',
  'Una cartera de cheques no se transfiere: sus movimientos son los de sus cheques (depositar, endosar, vender)',
  'a transfer out of a cartera is refused'
);

select throws_ok(
  $$select * from public.create_transfer('00000000-0000-0000-0000-00000000a122', '00000000-0000-0000-0000-00000000a121',
      'jouve_internal', 10, 'ARS', current_date, date_trunc('month', current_date)::date, 'x')$$,
  '23514',
  'Una cartera de cheques no se transfiere: sus movimientos son los de sus cheques (depositar, endosar, vender)',
  'so is one into a cartera'
);

select lives_ok(
  $$select * from public.create_transfer('00000000-0000-0000-0000-00000000a122', '00000000-0000-0000-0000-00000000a123',
      'jouve_internal', 10, 'ARS', current_date, date_trunc('month', current_date)::date, 'x')$$,
  'a transfer between banks still works'
);

select * from finish();
rollback;
