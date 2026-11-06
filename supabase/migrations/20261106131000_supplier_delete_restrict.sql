SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Deleting a supplier category or a supplier is refused by the database while
-- something still points at it, not only by the app's "is it in use" count.
--
-- deleteSupplierCategoryAction and deleteSupplierAction count the references
-- and then delete, with nothing in between: a supplier assigned to the
-- category meanwhile lost it (suppliers.category_id was ON DELETE SET NULL),
-- and a file attached to the supplier meanwhile was deleted with it
-- (file_attachments.supplier_id was ON DELETE CASCADE). Both FKs become
-- ON DELETE RESTRICT; every other FK to suppliers already is
-- (20261031193400), and the allocations reach it through their header.
--
-- The writers that delete them: only those two actions delete a category;
-- the supplier delete and undo_import_run (import_run_outside_reference
-- already refuses an undo while any FK row outside the run points at the
-- supplier) delete suppliers. The actions map the FK violation (23503) to
-- their Spanish message.
--
-- Existing rows are not touched: every current row already satisfies the FK,
-- so VALIDATE only scans (suppliers and file_attachments are small).
--
-- Rollback: older code counts first and then deletes; a delete that the count
-- missed now fails with the same 23503 it already maps.

-- squawk-ignore ban-drop-constraint
alter table public.suppliers drop constraint suppliers_category_id_fkey;
alter table public.suppliers add constraint suppliers_category_id_fkey
  foreign key (category_id) references public.supplier_categories (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.suppliers validate constraint suppliers_category_id_fkey;

-- squawk-ignore ban-drop-constraint
alter table public.file_attachments drop constraint file_attachments_supplier_id_fkey;
alter table public.file_attachments add constraint file_attachments_supplier_id_fkey
  foreign key (supplier_id) references public.suppliers (id) on delete restrict not valid;
-- squawk-ignore constraint-missing-not-valid
alter table public.file_attachments validate constraint file_attachments_supplier_id_fkey;
