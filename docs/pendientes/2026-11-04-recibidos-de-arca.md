# Recibidos de ARCA (2026-11-04)

- [x] Bandeja de Mis Comprobantes → Recibidos: subir el archivo, aceptar
      cada comprobante como compra (importes de ARCA) o descartarlo
      (`20261104104001`, `/purchases/arca`).
- [x] Compras en una cuenta asignada a Neutro no suman en Gestión, tampoco
      en caja (`20261104104002`).
- [x] Clave fiscal del usuario de ARCA en Vault, editable por owner y admin
      en Admin → AFIP (`20261104110601`).
- [x] Traer de ARCA solo: robot HTTP (`lib/afip/mis-comprobantes/robot.ts`),
      función Inngest `arca-received-sync` (todos los días, últimos 60 días;
      `retries: 0`) y botón «Traer de ARCA» con período en la bandeja.
- [ ] Probar el robot contra ARCA desde producción (región `gru1`): el
      recorrido sale de la grabación del owner, nunca corrió de punta a punta.
- [x] Robot más seguro (auditoría w4): solo habla con `afip.gob.ar` y
      `afip.gov.ar` por https y la clave no sigue una redirección a otro
      sitio; dos ingresos fallidos seguidos frenan la cuenta
      (`20261104120000`, compare-and-set sobre las credenciales leídas); un
      mes cuyas filas no coinciden con `recordsTotal` falla; tope de 200 s
      por corrida; un comprobante se vincula solo si el total también
      coincide; el centavo de redondeo de ARCA va a no gravado (A) o al neto
      (B/C) al aceptar.
- [x] Diálogo de aceptar (pedido del owner): botón «Crear proveedor
      «Razón social»» con el CUIT de ARCA cuando no está cargado; vencimiento
      en la fecha del comprobante o en la fecha + los días de pago del
      proveedor; en lugar del selector de ítems, las líneas por alícuota con
      que se guarda.
- [x] Vínculo que se sostiene (auditoría w5): compara total, moneda y, en una
      A, el IVA (`20261104122000`); si se edita la compra vinculada y deja de
      coincidir, el comprobante vuelve a pendientes. El centavo de redondeo
      que pasa al neto va también a la línea más grande, así el total
      guardado es el de ARCA.
- [x] Estado honesto (auditoría w5): solo cuentan para el freno las fallas
      con la clave ya mandada (o un CUIT rechazado); después de un mes que
      corta la corrida, los meses que siguen se informan como no leídos; el
      tope de 200 s cuenta desde el arranque; una corrida que se corta por
      cualquier error sella su fin, y una que muere sin sellar se muestra como
      cortada; una lectura fallida ya no se muestra como «falta el usuario»;
      Admin → AFIP dice cuando la última corrida tuvo errores.
- [x] Auditoría w6: el comprobante vuelve a pendientes también si se edita
      la clave de la compra (proveedor, tipo, letra, punto de venta, número o
      canal) y una compra se queda con un solo comprobante
      (`20261104131000`); una falla después de que ARCA aceptó la clave ya no
      frena la cuenta (cuenta como ingreso que anduvo); un mes que ARCA
      contestó mal no corta los siguientes; un pedido en cola detrás de otra
      corrida no toma su resultado; Admin → AFIP muestra una corrida cortada.
- [ ] Avisar por notificación a owner y admin cuando ARCA rechaza la clave
      (hoy lo muestran la bandeja y Admin → AFIP).
- [x] Lector validado con una consulta real de Recibidos (A con otros
      tributos, C y NC C que traen solo el total, todo en pesos) y con los
      encabezados del Excel que exporta la página.
- [ ] Sin ver todavía: el CSV que arma el servidor (`descargarComprobantes.do`),
      una B y un comprobante en dólares. El dueño dice que las compras son
      todas en pesos.
- [ ] FCE MiPyME y tipo M quedan en «No soportados»: se cargan a mano.
