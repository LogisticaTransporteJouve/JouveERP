-- Dev seed data, runs after migrations during `supabase db reset`.
--
-- Auth users + role grants are NOT seeded here because they require the
-- supabase admin API. Run `pnpm seed:dev` after `db reset` to recreate the
-- dev user with the owner role.
--
-- Clients are seeded from a real Libro de IVA snapshot deduped by CUIT.
-- iva_condition is set to 'responsable_inscripto' as a placeholder — open
-- any client and click "Verificar AFIP" to refresh from padrón A4.

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

-- Caja accounts (D.1). Pre-seeded with the canonical list used by the
-- business so Recibos (F.3) has somewhere to credit payments out of the box.
insert into public.accounts (name, type, currency) values
  ('Caja General',                 'cash',    'ARS'),
  ('Caja Cambio',                  'cash',    'ARS'),
  ('Cheques físicos en cartera',   'checks',  'ARS'),
  ('Cheques electrónicos (e-cheq)','echeq',   'ARS'),
  ('Banco Galicia',                'bank',    'ARS'),
  ('Banco Provincia',              'bank',    'ARS'),
  ('Banco Macro',                  'bank',    'ARS'),
  ('Mercado Pago',                 'wallet',  'ARS'),
  ('Banco Nación',                 'bank',    'ARS')
on conflict do nothing;
