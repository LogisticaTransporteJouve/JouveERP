# Auditoría: IA, tareas y accesos (2026-11-04)

- [x] **Insights:** una lectura que falla conserva las tarjetas de su tipo
      (antes se borraban); flota y anomalías leen todas las filas (paginado;
      pasado el tope de drenado la corrida falla y las tarjetas quedan); las
      anomalías se comparan por moneda (ARS y USD por separado, con `US$`);
      la regeneración es una transacción (`regenerate_ai_insights`) con lock
      y un índice único por fingerprint vivo.
- [x] **Propuestas IA:** una aceptada sin resultado (el pedido murió) se
      cierra como fallida y se puede volver a preparar.
- [x] **Escaneo:** el control de duplicados compara también tipo y letra, y
      avisa si la búsqueda falló.
- [x] **Herramientas IA:** `limit` acotado en órdenes de pago, recibos y
      asientos; una página cortada avisa que hay más.
- [x] **Dashboard:** la agenda nombra las secciones cuya lectura falló en vez
      de decir "sin vencimientos". **Remitos:** el número escaneado se busca
      exacto en SQL antes del tope de 200.
- [x] **Tareas:** `tasks-daily` reclama vencidas y por vencer en pasos
      separados y asigna toda tarea automática abierta sin asignar, salvo
      la que alguien dejó sin responsables a mano; los comentarios e
      historial de una tarea restringida no se devuelven.
- [x] **Permisos:** `retentions:write` gatea cargar o cambiar retenciones de
      un recibo (sin él, ningún formulario de recibo muestra el editor) y
      `stock_movements:write` gatea entrar, despachar, borrar o mover un
      pallet. Salen de la matriz `channels:read`, `channels:write`,
      `files:admin`, `retentions:read`, `credit_debit_notes:read` y
      `stock_movements:read` (ningún gate los leía); un test exige que cada
      permiso se lea fuera de la matriz.
- Aprobación de `20261104096000` y `20261104096100`: en **Antes de
  promover**.
- [x] pgTAP verde en CI (stack fresco); sin verificar contra datos de
      producción: las dos migraciones y el anti-join de tareas sin asignar. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).

- [x] Aprobar `20261104096000` (insights) y `20261104096100` (denegaciones de
      permisos quitados) con el deploy. Sin la primera, el analista falla
      (no existe el RPC) y las tarjetas quedan como estaban. — hecho: aplicadas en producción (están en `production-latest`, `bbe08b38`).
- [x] No verificado contra una base real: las dos migraciones, el pgTAP de
      `regenerate_ai_insights` y el anti-join de tareas sin asignar. — hecho: las migraciones están en producción (`production-latest`, `bbe08b38`) y su pgTAP corre verde en el job `database` de CI (`main` en `e239ee7`).

### Auditoría w2: IA, UI y adjuntos

- [x] **Insights:** la lista se lee entera, se filtra por dominio y se ordena
      por gravedad antes de mostrar 50 ("Mostrando 50 de N"); una lectura que
      falla se muestra como error, no como "No hay insights todavía". "Visto"
      sobre una tarjeta ya recalculada avisa en vez de dar éxito.
- [x] **Propuestas:** una aceptada que quedó sin resultado se muestra primero
      con "No se sabe si la acción se completó"; la nueva se arma al volver a
      abrir. Aceptar una propuesta refresca todo (como en el chat).
- [x] **Adjuntos:** una lectura que falla dice "No se pudieron leer los
      adjuntos" (antes: sin adjuntos y un reintento en bucle).
- [x] **Pallets:** los botones siguen los permisos de las acciones (crear,
      cargar varios, despachar y borrar piden `stock_movements:write`;
      editar y bloquear, `pallets:write`); sin `stock_movements:write` la
      edición traba depósito, estado, cantidad y fechas.
- [x] **Listas al facturar:** flete, liquidación y almacenaje refrescan
      también cuando la factura se emitió pero no se vinculó. Impuestos
      refresca Gestión y Conciliación; recategorizar, libros y Gestión.
- [x] **Nits:** cheque de una OP con monto, moneda y cuenta trabados; flete
      que no se borra si falla la lectura de la tarifa; historial de chat que
      descarta solo el mensaje inválido; deudas por cheques pendientes sin
      tope; Gestión parcial con filas de un bucket desconocido; búsquedas por
      nombre que toman `%` y `_` literal; cobranzas en riesgo que avisan si
      faltan los dólares; margen por cliente que falla pasado el tope del RPC;
      error de lectura de cuota y del catálogo de gastos; "Estimar" y "Pagar"
      solo con los permisos que piden; guía de `/aging/mora`; totales de la
      rendición en una columna en el celular; historial de bloqueos en hora
      argentina.
- [ ] No verificado en el navegador: los diálogos y paneles se probaron con
      tests de componentes (jsdom), no en la app.
