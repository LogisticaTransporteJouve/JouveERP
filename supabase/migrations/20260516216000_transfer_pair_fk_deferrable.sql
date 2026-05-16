-- Hotfix — FK transactions.transfer_pair_id debe ser DEFERRABLE.
--
-- Bug latente: la RPC create_transfer (D.2, ya en producción) inserta
-- primero el transfer_out con transfer_pair_id apuntando al transfer_in
-- todavía-no-creado, después inserta el transfer_in con pair al out.
-- Eso requiere FK deferrable, pero la migration original lo definió sin
-- deferrable. En la práctica el RPC venía fallando con
-- "violates foreign key constraint transactions_transfer_pair_id_fkey"
-- en cualquier escenario donde se chequea la FK inline (caso típico:
-- sesión psql directa o trigger nuevo que dispare antes del segundo
-- INSERT).
--
-- Descubierto al smoke-testear el trigger journal_auto_transactions
-- (L.2b). Lo arreglamos acá para destrabar L.2b y no dejarlo como deuda.
--
-- DROP + ADD CONSTRAINT con la nueva variante deferrable es la única
-- forma — Postgres no soporta ALTER CONSTRAINT … DEFERRABLE para FK
-- existentes sin recrear.

alter table public.transactions
  drop constraint transactions_transfer_pair_id_fkey;

alter table public.transactions
  add constraint transactions_transfer_pair_id_fkey
    foreign key (transfer_pair_id)
    references public.transactions (id)
    on delete cascade
    deferrable initially deferred;
