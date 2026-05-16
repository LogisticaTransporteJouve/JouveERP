-- Dev seed data, runs after migrations during `supabase db reset`.
--
-- Auth users + role grants are NOT seeded here (they need the admin API).
-- Run `pnpm seed:all` after `db reset` to:
--   * create the dev user with owner role
--   * import the AFIP comprobantes (clients/suppliers + sales/purchase invoices)
--   * synthesize operational data (receipts, OPs, checks, transfers, openings)
--
-- This file only holds *static* base data (channels were seeded by the
-- migration that created them; accounts, sales points, and a small
-- starter clients/suppliers set live here so an empty `db reset` still
-- boots into a usable UI).

------------------------------------------------------------------------------
-- 1. Sales points (AFIP POS).
--    Mapping from the user's memory: 00003 jouve_fiscal · 00004 dz_fiscal.
--    POS 1 and 2 are the conventional "internal" PVs used by recibos /
--    OPs / comprobantes internos so the per-channel correlativo has a
--    home.
------------------------------------------------------------------------------
insert into public.sales_points (numero, channel_id, nickname, is_enabled) values
  (1,    'jouve_internal', 'Interno Jouve',           true),
  (2,    'dz_internal',    'Interno DZ Instalaciones', true),
  (3,    'jouve_fiscal',   'Jouve Fiscal',            true),
  (4,    'dz_fiscal',      'DZ Instalaciones Fiscal',  true)
on conflict (numero) do nothing;

------------------------------------------------------------------------------
-- 2. Caja accounts (D.1). Canonical list used by Recibos (F.3) and OPs
--    (K.3) so payment-method pickers have stable defaults from day one.
------------------------------------------------------------------------------
insert into public.accounts (name, type, currency) values
  ('Caja General',                 'cash',    'ARS'),
  ('Caja Cambio',                  'cash',    'ARS'),
  ('Caja USD',                     'cash',    'USD'),
  ('Cheques físicos en cartera',   'checks',  'ARS'),
  ('Cheques electrónicos (e-cheq)','echeq',   'ARS'),
  ('Banco Galicia',                'bank',    'ARS'),
  ('Banco Provincia',              'bank',    'ARS'),
  ('Banco Macro',                  'bank',    'ARS'),
  ('Banco Nación',                 'bank',    'ARS'),
  ('Banco Santander USD',          'bank',    'USD'),
  ('Mercado Pago',                 'wallet',  'ARS')
on conflict do nothing;

------------------------------------------------------------------------------
-- 3. Starter clients (small handful — bulk import happens via seed:all).
------------------------------------------------------------------------------
insert into public.clients (cuit, legal_name, iva_condition) values
  ('30718543866', 'PALLET SIRANS S.R.L.',                                 'responsable_inscripto'),
  ('30621884634', 'OSCAR DIOJTAR S A',                                    'responsable_inscripto'),
  ('30500012516', 'BANCO DE LA PAMPA S. A.',                              'responsable_inscripto'),
  ('30523447102', 'HUMBERTO H AMABLE S R L',                              'responsable_inscripto'),
  ('30504013584', 'LA SUIPACHENSE COOPERATIVA DE',                        'responsable_inscripto'),
  ('30666236471', 'RICARDO HERRERO E HIJO S R L',                         'responsable_inscripto'),
  ('30666243745', 'METALURGICA MERCEDES SOCIEDAD DE',                     'responsable_inscripto'),
  ('23264923239', 'MALLARINI, JOSE',                                      'responsable_inscripto'),
  ('30527770552', 'SA C E I FRANCISCO CORES LTDA',                        'responsable_inscripto'),
  ('30711044686', 'CASA MARTIN DE PRICE EUGENIO ALBERTO Y',               'responsable_inscripto'),
  ('30711169497', 'EDILOT PAIS SOCIEDAD DE',                              'responsable_inscripto'),
  ('20116692431', 'TELLECHEA, JOSE ANTONIO',                              'responsable_inscripto'),
  ('30547975290', 'SAVIAMAR S A',                                         'responsable_inscripto'),
  ('30708900873', 'CORRALON SAN LORENZO S.R.L.',                          'responsable_inscripto'),
  ('20217534845', 'BRAGHI, PABLO OMAR',                                   'responsable_inscripto'),
  ('30714987352', 'INBIO HIGHWAY S.A.',                                   'responsable_inscripto'),
  ('33712141919', 'PAPELERA EP S.R.L.',                                   'responsable_inscripto'),
  ('27215740930', 'ILLANES, MARIA ELINA',                                 'responsable_inscripto'),
  ('30576070566', 'COINCER SOCIEDAD ANONIMA COMERCIAL',                   'responsable_inscripto'),
  ('20102093926', 'ARISTI, CARLOS EDUARDO',                               'responsable_inscripto'),
  ('33709819319', 'POLINET SRL',                                          'responsable_inscripto'),
  ('30624657604', 'LA ÑATA S.A.',                                         'responsable_inscripto'),
  ('30552390977', 'METALURGICA BELGRANO S.R.L.',                          'responsable_inscripto'),
  ('30715417576', 'PRECINTOS PDS S.R.L.',                                 'responsable_inscripto'),
  ('27398967033', 'CALDERON, FLORENCIA GIMENA',                           'responsable_inscripto'),
  ('30604044428', 'INELEC SOCIEDAD DE RESPONSABILIDAD',                   'responsable_inscripto'),
  ('30697149577', 'BETA S R L',                                           'responsable_inscripto'),
  ('20400218731', 'MARSICO, BAUTISTA',                                    'responsable_inscripto'),
  ('30546741253', 'OSDE ORGANIZACION DE SERVICIOS DIRECTOS',              'responsable_inscripto'),
  ('20309192916', 'VIOLA, VICTOR ABELARDO',                               'responsable_inscripto')
on conflict (cuit) do nothing;
