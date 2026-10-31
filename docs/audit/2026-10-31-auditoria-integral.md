# Auditoría integral — 2026-10-31

Seis auditorías de solo lectura en paralelo sobre `main` (después de #259), cada una con su lente del repo:
FKs (`enforce-data-integrity`), RLS y permisos (`enforce-role-isolation`), ventas, compras y tesorería
(`enforce-reach`, `enforce-outcomes`, `enforce-effects`, `enforce-data-integrity`), conexiones
(`enforce-reach`, `enforce-clean-code`, `jscpd`) y módulos no contables. La base local tiene muchas facturas
de demo pero casi nada en recibos, OPs, RRHH y flota: varios hallazgos salen del código y de las funciones,
no de los datos.

**Fatales (2):** la anulación de OP por finance deja la caja viva (compras F1) y el Libro diario se rompe al
cargar (conexiones F1).

**Arreglo:** cuatro PRs agrupados por área (integridad en la base, lógica de dinero, conexiones y UI,
RRHH y flota) más el PR del D11 (cheque rechazado), que absorbe el rechazo de cheques (compras S5).

## FKs — resumen

Fatal: ninguno.
S1. deleteTransactionAction borra movimientos ligados (receipt/OP/invoice, cuotas de préstamo, pagos de sueldo); el guard solo cubre UPDATE; FKs SET NULL en loan_installments.transaction_id, payroll_payments.transaction_id, check_movements, account_opening_balances.adjustment_transaction_id. Fix: trigger BEFORE DELETE con 55006 + hint, FKs a RESTRICT.
S2. Borrar cliente/proveedor depende de un pre-conteo que trata error como 0; CASCADE en *_opening_balances, SET NULL en counterparty/checks/issued_checks. Fix: FKs RESTRICT y error de conteo → ok:false.
M1. transactions.receipt_id/payment_order_id, issued_checks.payment_order_id SET NULL; checks.source_payment_line_id CASCADE vs source_receipt_id RESTRICT. Fix: RESTRICT.
M2. cost_center SET NULL choca con período cerrado y dispara repost. Fix: RESTRICT + is_active.
M3. chat_messages.sender_id / chat_channels.created_by NO ACTION bloquean borrar usuarios; opening_balances.created_by inconsistente.
M4. FK duplicada client/supplier_opening_balance_allocations.client_id/supplier_id.
M5. FKs *_by sin índice en invoices/journal_entries etc.; check_movements.transaction_id.
M6. journal_entries.source_table sin CHECK de dominio; email_send_log.entity_id soft escrito por app.
OK: todos los *_id con FK salvo logs; polimorfismo de journal cumple; 0 huérfanos; sin SET NULL en NOT NULL; tipos ok.

## RLS y permisos — resumen

Fatal: ninguno.
S1. admin tiene :write en la matriz pero RLS de accounts, transactions, receipts(+allocations/lines/retentions), payment_orders(+…), checks, check_movements, issued_checks solo admite owner/finance → admin pasa userCan y falla en RLS. Decidir: sumar admin a policies (recomendado: matriz = verdad) o sacar :write a admin.
S2. apply/clear_client_opening_balance RPC: rol interno owner/admin/finance y ejecutable por anon/authenticated; la app es owner-only. Fix: rol 'owner' + revoke public/anon.
S3. NC/ND no gateadas por credit_debit_notes:issue (issueFiscalInvoiceAction solo invoices:issue). Fix: exigir ambos para nc/nd (+ tool IA).
S4. ai_usage_today() DEFINER sin rol, ejecutable por anon. Fix: revoke ×3.
S5. deleteSupplierCategoryAction gate suppliers:write (finance) pero DELETE policy owner/admin → falso éxito. Fix: sumar finance a policy + chequear filas afectadas.
M1. anon/authenticated con TRUNCATE/TRIGGER/REFERENCES en tablas (default privileges). Fix: revoke + alter default privileges.
M2. DEFINER ejecutables por anon: notification_type_enabled(uuid,text) (lee prefs de otro), list_chat_assignable_users, ~15 triggers. Fix: revoke anon (+authenticated si no es RPC UI).
M3. ~50 DEFINER con search_path=public (no explotable). Normalizar al tocar.
M4. auth.uid() sin (select) en policies de ai_chat_sessions/messages/document_extractions.
M5. RLS más amplia que matriz: vehicles SELECT driver; exchange_rates/cost_centers/inflation_adjustments SELECT true; search_global roles a mano.
M6. Permisos sin gate: retentions:_, stock_movements:write, channels:write, files:admin, credit_debit_notes:_; files:write de warehouse sin destino.
M7. deleteChartAccountAction usa roles.includes("admin"); avatars_update_self sin WITH CHECK.
OK: RLS en 91 tablas, ninguna policy anon, vistas security_invoker, 330 actions gateadas, 60 tools IA ok.

## Ventas — resumen

Datos locales: 25.515 facturas fiscales, 0 recibos/NC/USD: invariantes de factura y asiento cuadran (0 faltantes, 0 desbalanceados, IVA mayor = libro).
S1. FIFO automático imputa total − retenciones (receipts-actions.ts:578) mientras asiento y cuenta corriente usan total → factura queda abierta por lo retenido. Fix: remaining = total_amount.
S2. Sobre-imputación: guard_receipt_allocation no descuenta saldo inicial; createReceipt no revalida; NC sin control ≤ saldo abierto; NC posterior al recibo ignorada; aging filtra >0 y oculta negativos. Fix: guard suma opening allocations + guard diferido "saldo abierto ≥ 0" en invoices(NC) y receipt_allocations.
S3. Anular factura interna con NC/ND emitidas las deja huérfanas. Fix: bloquear si hay nc/nd con invoice_origin_id.
S4. Cuenta corriente vs aging: pendiente = gross − applied sin NC (account-actions.ts:219); con filtro fiscal saldo = Σopen_amount sin créditos a cuenta. Fix: leer de v_aging_documents / restar amount_credited_by_nc + sumar créditos sin imputar.
S5. Monedas mezcladas: v_client_account_movements suma ARS+USD; build_receipt_journal_lines sin cotización (descuadra clientes en USD); guard no valida moneda recibo vs factura. Fix: separar por moneda, convertir con cotización, rechazar cross-moneda.
S6. Invalidaciones: useIssueFiscalInvoice solo invoicesKeys (emisión async); useCancelInvoice sin clientsKeys; recibos sin checks/invoices/journal/libroMayor; opening balance sin agingKeys.
M: errores tragados como 0 (cash-flow-actions.ts:201, insights/gather.ts:120, receipts-actions.ts:570 pendingRes); gate de saldo inicial con roles.includes (y RPC más amplio = RLS S2); dashboard mezcla ámbitos (treasury/cashflow/dueDates sin isFiscal); aging days_overdue desde fecha, no fch_vto_pago.
OK: gates, keys y prefetch con isFiscal, paginación, NC/ND origen mismo cliente/canal, anulación fiscal bloqueada, asientos solo fiscales con reversa/re-asiento, libro IVA ventas ok.

## Compras y tesorería — resumen

F1. handle_payment_order_cancellation no es DEFINER: con finance la RLS (DELETE owner-only) filtra el borrado de transactions/check_movements en silencio → OP anulada con egresos vivos. Fix: SECURITY DEFINER + search_path='' (patrón payroll_payment_sync_transaction).
S2. Pendiente de compras con 3 fórmulas: listPendingInvoicesForSupplierAction (:353-371) sin NC ni saldo inicial; guard_payment_order_allocation contra imp_total; cuenta corriente (account-actions.ts:318-327) sin NC; aging sí. Fix: todos leen v_purchase_invoice_open.open_amount.
S3. 30 NC de compra sin invoice_origin_id: aging 941.379.471,72 vs cuenta corriente 905.628.152,41 (dif = NC). Fix: exigir origen o restar a nivel proveedor.
S4. createCheckAction no crea el ingreso a cartera → cartera negativa al depositar (dato local "Probe cartera" −10); error del movimiento received ignorado. Fix: RPC atómica cheque + ingreso.
S5. reject_check: en_cartera no mueve nada; depositado acepta cualquier p_account_id; endosado sin acción. → delegado al PR D11.
S6. Cheques emitidos: banco baja en fecha OP pero asiento al cobro; rechazo/anulación revive deuda en asiento pero OP sigue issued y banco no revierte; cheque suelto sin transacción; transitionIssuedCheckAction sin .eq(status,'emitted'); update cambia monto/banco/OP de cheque ligado.
S7. Flujo de caja: cashToday incluye cuentas checks/echeq e inactivas y además proyecta cheques en cartera → doble conteo.
S8. Flujo de caja ignora errores de lectura (:171,199,222,245); treasury checks_failed solo warn.
S9. Invalidaciones: OP sin treasury/accounts/journal; checks y transactions sin treasury; issued checks solo su lista; payroll sin transactions/treasury; compras sin libroIva/journal; tesorería sin prefetch.
S10. payInstallmentAction no atómico (doble egreso) + importa createTransactionAction cross-feature. Fix: RPC que reclama cuota + egreso.
M: anulaciones sin chequear filas; anular FC de compra con OP imputadas no bloqueado; create_payment_order sin FOR UPDATE en cheque endosado (doble endoso); FIFO OP descarta si falla lectura; sin refine cotización>1 en update de compra; cuenta corriente mezcla monedas; fechas UTC en transiciones; deleteTransaction/saldos iniciales con roles.includes; payroll moneda fija ARS.
OK: gates, keys/prefetch con isFiscal, herencia de canal de cheques, imputaciones por proveedor/canal, letra fiscal, libro IVA compras, DI usa la action.

## Conexiones — resumen

F1. Libro diario: app/(dashboard)/accounting/journal/page.tsx:38-43 prefetch NO infinito con la misma key que useSuspenseInfiniteQuery (use-journal-entries.ts:24-39) → TypeError data.pages. Fix: prefetch {infinite:true, initialPageParam:0, offset/limit JOURNAL_PAGE_SIZE}.
S2. search_index arma '/transactions/'||id (20260517500000_m_closure.sql:210) → 404. Fix: '/transactions?account='||account_id o mapear en global-search-dialog.
S3. Cierre de períodos (period-close-actions.ts list/close/reopen) sin UI. Fix: sección "Períodos cerrados" con gate accounting:write.
S4. Hooks sin UI: useUpdateTransaction/useDeleteTransaction, useUpdateLeave, useGrantVacationBalances, useAdjustVacationBalance, useUpdatePayrollPayment, useUpdatePayrollEntryExtra. Fix: conectar o borrar.
S5. Tool IA searchGlobal gate clients:read; debería ser cualquiera de ENTITY_READ_PERMISSION.
M: keys hardcodeadas (hr attendance page, profile notifications settings) → exportar keys; exporter cost-centers sin botón; 15 barrels index.ts sin uso; actions/hooks muertos (listSuppliersAction, getTransactionByIdAction, listFiscalChannelsAction, listPendingExtractionsAction, deleteFileIfOrphaned, useChartOfAccountsList, useGetOrCreateSelfChannel, useCheckDetail, useClientById, useSupplierById, usePurchaseInvoiceById, useEmployeesList/ById/Search); theme-toggle, *_PATH constantes, etc.; searchIndexRefresh cada minuto sin concurrency limit 1; AI_EVALS_LIVE sin documentar; jscpd 325 clones 5,5% (pallet dialogs, client/supplier forms y pares, PDFs OP/recibo, allocations pickers, libro IVA ventas/compras, DialogFormFooter, confirmation-actions).
OK: 62 nav items ok, links ok, prefetch ok salvo journal, 18 Inngest registradas, 68 tools ok, 27 exports ok.

## Módulos (RRHH, flota, depósito, envíos) — resumen

Datos locales vacíos en esos módulos: los chequeos de datos no prueban nada.
S1. Sueldos van a 5.3.5 "gastos" (build_transaction_journal_lines expense→gastos); 5.3.1 Sueldos sin system_role. Fix: rol sueldos + línea con account/rol propio desde payroll.
S2. Movimiento de pago de sueldo editable/borrable desde tesorería (guard no lo ve). Fix: guard UPDATE/DELETE si existe payroll_payments.transaction_id (= audit FKs S1).
S3. Doble facturación de flete/almacenaje (leer-emitir-vincular, sin claim atómico). Fix: UPDATE…WHERE invoice_id IS NULL RETURNING antes de emitir; exclusión (client_id, daterange) en storage_billing_runs.
S4. invoiceStorageAction lee pallets/tariffs sin paginar (max 1000) → factura menor que preview. Fix: paginateRange.
S5. Carga facturada editable/borrable. Fix: guard DB + action si invoice_id not null.
S6. Borrar vehículo cascadea fuel_loads/maintenance/fleet_documents; trips SET NULL. Fix: RESTRICT + is_active.
S7. grant_vacation_balances arrastra saldos vencidos y acumula (contra LCT art.164); extended se cuenta doble. Fix: arrastrar solo activos no vencidos, cerrar origen, tope.
S8. fuel_loads/maintenance sin FK a purchase_invoices/transactions; no llegan a contabilidad. Fix: FK opcional + reporte de costos sin comprobante.
M: trips.revenue manual vs facturado; hr_settings.vacation_carryover no se lee; invalidaciones cruzadas faltantes (payroll→transactions/accounts/treasury; flete/storage→invoices; fuel/maint/trips→fleetReports); borrados con RLS devuelven ok con 0 filas; invoiceFreight solo owner/admin (confirmar); art.153 aproximado; fleet_documents sin adjuntos; cost_center no en HR/flota.
OK: gates en todas las actions, RLS en todas, payroll→movimiento→asiento sincroniza, crons registrados e idempotentes.
