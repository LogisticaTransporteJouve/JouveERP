-- E.5 — Add IIBB and inicio_actividades to business_units.
--
-- AFIP RG 1415/2003 (Anexo II) requires every fiscal invoice to display:
--   - Ingresos Brutos number (or the literal "no contribuyente")
--   - Inicio de actividades (with the leyenda "INICIO DE ACTIVIDADES")
--
-- Both belong on the issuer (business unit) so they're embedded once and
-- read by the PDF template at issuance time.

set row_security = off;

alter table public.business_units
  add column if not exists iibb_number text,
  add column if not exists inicio_actividades date;

-- Backfill for the seeded DZ & Sons row. The exact values land via Studio
-- once the user has them; defaulting to placeholders keeps the column
-- non-empty for the existing fixture.
update public.business_units
set iibb_number = coalesce(iibb_number, 'no contribuyente'),
    inicio_actividades = coalesce(inicio_actividades, '2010-01-01'::date)
where id = 'dz_sons';

set row_security = on;
