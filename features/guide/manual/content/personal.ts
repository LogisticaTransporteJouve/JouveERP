import type { GuidePage } from "../types";

// Personal (RRHH y sueldos): employees and their file (cuenta corriente,
// embargos, vacaciones, documentos, liquidación final), the monthly and SAC
// planillas with their payments, vacations, attendance and document expiries.

export const hrPage: GuidePage = {
  file: "personal.html",
  title: "Personal",
  lead: "Empleados y su legajo, la planilla de sueldos de cada mes y del SAC con sus pagos, la cuenta corriente de cada empleado, vacaciones según la LCT, asistencia y vencimientos de documentos.",
  sections: [
    // ── Empleados ────────────────────────────────────────────────────────
    {
      id: "empleados",
      title: "Empleados",
      menuPath: "Personal › Empleados",
      routes: ["/employees"],
      permission: "hr:read",
      intro: [
        "El padrón del personal de Jouve. La liquidación formal la sigue haciendo el liquidador externo: acá se llevan la identidad, el sueldo pactado, los datos del recibo y los pagos.",
        "La tabla muestra {{Apellido y nombre}} (con la marca {{Monotributo}} si factura como monotributista), {{Posición}}, {{Frecuencia}}, {{Sueldo base}}, {{Viático}}, {{Estado}} ({{Activo}} o {{Inactivo}} con la fecha de baja), {{Ingreso}} y {{Acciones}}. Los inactivos se ven atenuados. La lista carga 50 empleados y sigue cargando al bajar.",
        "Hacé clic en el nombre para abrir la ficha del empleado ([[#ficha-empleado]]).",
      ],
      screens: [
        {
          kind: "page",
          title: "Empleados",
          subtitle:
            "Personal de Jouve. La liquidación detallada va por el liquidador externo; acá manejamos identidad, sueldos cargados a mano y pagos.",
          actions: [
            { label: "Exportar", variant: "outline" },
            { label: "Aumento", variant: "outline" },
            { label: "Nuevo empleado", variant: "primary" },
          ],
          toolbar: [
            { label: "Buscar por apellido y nombre o CUIL", kind: "input" },
            { label: "Solo activos", kind: "checkbox", value: "sí" },
          ],
          table: {
            columns: [
              "Apellido y nombre",
              "Posición",
              "Frecuencia",
              "Sueldo base",
              "Viático",
              "Estado",
              "Ingreso",
              "Acciones",
            ],
            rows: [
              [
                "~Pérez, Juan",
                "~Chofer / Acompañante",
                "~Mensual",
                "~$ 950.000",
                "~$ 20.000",
                "~Activo",
                "~03/02/2021",
                "~Editar",
              ],
              [
                "~Gómez, Ana",
                "~Administrativo",
                "~Mensual",
                "~$ 820.000",
                "~$ 20.000",
                "~Activo",
                "~15/08/2024",
                "~Editar",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "buscar-empleados",
          title: "Buscar empleados y ver los dados de baja",
          permission: "hr:read",
          steps: [
            "En [[/employees]], escribí en {{Buscar por apellido y nombre o CUIL}}: la lista se filtra mientras escribís.",
            "Para ver también a los dados de baja, destildá {{Solo activos}}.",
            "Para volver a la vista inicial, hacé clic en {{Limpiar}} (aparece mientras hay un filtro).",
          ],
          after: [
            "La búsqueda y el filtro quedan en la dirección de la página: si la compartís o la recargás, se mantienen.",
          ],
          keywords: ["buscar empleado", "inactivos", "dados de baja", "CUIL"],
        },
        {
          id: "crear-empleado",
          title: "Dar de alta un empleado",
          summary:
            "Carga los datos personales, de pago y del recibo formal. Si es chofer, también crea su ficha en Flota.",
          permission: "hr:write",
          prerequisites: [
            "Los campos de {{Vacaciones}} del alta solo aparecen para owner y admin.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Nuevo empleado",
              description:
                "Datos personales + de pago. La liquidación detallada la sigue haciendo el liquidador externo.",
              fields: [
                {
                  label: "Apellido y nombre",
                  kind: "input",
                  value: "Pérez, Juan",
                  wide: true,
                  marker: 2,
                },
                {
                  label: "Posición",
                  kind: "select",
                  value: "Chofer / Acompañante",
                  marker: 2,
                },
                {
                  label: "Frecuencia de pago",
                  kind: "select",
                  value: "Mensual",
                },
                {
                  label: "Modalidad",
                  kind: "select",
                  value: "Sueldo acordado",
                },
                { label: "CUIL", kind: "input", value: "20123456784" },
                { label: "CBU", kind: "input" },
                {
                  label: "Sueldo base mensual",
                  kind: "money",
                  value: "950.000",
                  marker: 3,
                },
                { label: "Viático mensual", kind: "money", value: "20.000" },
                {
                  label: "Fecha de ingreso",
                  kind: "date",
                  value: "03/02/2021",
                },
                { label: "Monotributista", kind: "checkbox" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Crear empleado", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/employees]], hacé clic en {{Nuevo empleado}}.",
            {
              text: "Completá los datos principales:",
              substeps: [
                "{{Apellido y nombre}}: obligatorio, al menos 2 letras (por ejemplo «Pérez, Juan»).",
                "{{Posición}}: elegí una de la lista ({{Chofer / Acompañante}}, {{Administrativo}}, {{Mecánico}}, {{Depósito}}, {{Socio / Dirección}}, {{Otro}}).",
                "{{Frecuencia de pago}}: {{Semanal}}, {{Mensual}} o {{Mixto}}.",
                "{{Modalidad}}: {{Por recibo}} (el sueldo sale del recibo del liquidador: al cargar el recibo en la planilla queda como sueldo, las vacaciones van dentro del recibo y los aumentos por % no lo tocan) o {{Sueldo acordado}} (se carga a mano y se aumenta por %). Viene en {{Sueldo acordado}}.",
                "{{CUIL}}: 11 dígitos, opcional (se aceptan guiones y espacios).",
                "{{CBU}}: 22 dígitos, opcional, pero hace falta para pagarle por transferencia.",
              ],
            },
            {
              text: "Completá el sueldo:",
              substeps: [
                "{{Sueldo base mensual}}: el sueldo pactado. Un chofer mensual lleva su sueldo acá; vacío solo para quien cobra semanal.",
                "{{Viático mensual}}: viene en $20.000; no puede ser negativo.",
                "{{Fecha de ingreso}}: obligatoria. Define la antigüedad para las vacaciones.",
                "{{Monotributista}}: tildalo si factura como monotributista (su factura se carga en Compras).",
              ],
            },
            "Si elegiste {{Chofer / Acompañante}}, aparece el bloque {{Datos de chofer}}: completá {{N.º de licencia}}, {{Categoría}} (por ejemplo `E1`) y {{Teléfono}}.",
            "En {{Datos formales}} podés cargar lo que figura en el recibo del liquidador: {{Convenio}}, {{Categoría}}, {{Obra social}}, {{ART}} y {{Retribución formal}} (el bruto del recibo, solo informativo). Todo es opcional.",
            "Si sos owner o admin, en {{Vacaciones}} podés cargar los {{Días del período en curso}} (el texto de ayuda dice cuántos le corresponden por antigüedad) y los {{Días pendientes de años anteriores}}. Si los dejás vacíos, el período se otorga solo el 1 de octubre.",
            "Opcional: escribí {{Notas}} y hacé clic en {{Crear empleado}}.",
          ],
          after: [
            "El empleado aparece en la lista como {{Activo}} y entra en las planillas de sueldo que se generen desde ahora (en una planilla ya generada, usá [[#agregar-empleados-faltantes]]).",
            "Con la posición {{Chofer / Acompañante}} se crea su ficha de chofer, que aparece en Flota → Choferes para asignarle viajes.",
            "Si cargaste días de vacaciones, quedan como saldo del período en curso y de años anteriores (ver [[#vacaciones]]).",
          ],
          errors: [
            {
              message: "Apellido y nombre requerido.",
              fix: "Escribí el apellido y nombre completo.",
            },
            {
              message: "El CUIL debe tener 11 dígitos.",
              fix: "Revisá el CUIL o dejalo vacío.",
            },
            {
              message: "El CBU debe tener 22 dígitos.",
              fix: "Revisá el CBU o dejalo vacío.",
            },
            {
              message: "El viático no puede ser negativo.",
              fix: "Cargá 0 o un importe positivo.",
            },
            {
              message: "Fecha de ingreso requerida.",
              fix: "Elegí la fecha de ingreso.",
            },
            {
              message: "Tiene que ser un número entero de días.",
              fix: "En los días de vacaciones, cargá un número sin decimales.",
            },
            {
              message: "Demasiados días.",
              fix: "Los días de vacaciones van de 0 a 365.",
            },
            {
              message: "No tenés permiso para crear empleados.",
              fix: "Pedile el alta a alguien con permiso de escritura en Personal (ver [[#roles-y-permisos]]).",
            },
            {
              message: "No se pudo crear el empleado.",
              fix: "No se guardó nada (ni el empleado, ni su ficha de chofer, ni las vacaciones): probá de nuevo; si sigue fallando, avisá al administrador.",
            },
          ],
          related: ["editar-empleado", "cargar-saldo-vacaciones"],
          keywords: [
            "alta de empleado",
            "nuevo empleado",
            "contratar",
            "legajo",
            "chofer nuevo",
          ],
        },
        {
          id: "editar-empleado",
          title: "Editar los datos de un empleado",
          permission: "hr:write",
          steps: [
            "En [[/employees]], en la fila del empleado, hacé clic en {{Editar}} (columna {{Acciones}}). También está en la ficha del empleado, arriba a la derecha.",
            "Cambiá lo que necesites: son los mismos campos del alta (ver [[#crear-empleado]]), sin el bloque de vacaciones.",
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "Un cambio de {{Sueldo base mensual}} queda en el {{Historial de sueldo}} de la ficha como «edición manual», desde el mes en curso. Las planillas ya generadas no cambian: corregí el sueldo en la planilla del mes si hace falta.",
            "Pasar a la posición {{Chofer / Acompañante}} crea o reactiva su ficha de chofer; pasar de chofer a otra posición la desactiva (los viajes conservan su historia).",
          ],
          errors: [
            {
              message: "No tenés permiso para editar empleados.",
              fix: "Pedile el cambio a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo actualizar el empleado.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["crear-empleado", "aplicar-aumento-sueldo"],
          keywords: ["modificar empleado", "cambiar sueldo", "CBU", "posición"],
        },
        {
          id: "aplicar-aumento-sueldo",
          title: "Aplicar un aumento de sueldo en %",
          summary:
            "Sube el sueldo base de varios empleados activos a la vez, desde un mes (por ejemplo, una paritaria).",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Aumento de sueldo",
              description:
                "Sube el sueldo base de los empleados elegidos desde un mes. Las planillas en borrador desde ese mes que tienen el sueldo anterior se actualizan; las cerradas no cambian. Queda en el historial de cada empleado.",
              fields: [
                {
                  label: "A quiénes",
                  kind: "select",
                  value: "Por convenio",
                  marker: 2,
                },
                {
                  label: "Convenio",
                  kind: "select",
                  value: "CCT 40/89",
                  marker: 2,
                },
                {
                  label: "Aumento (%)",
                  kind: "input",
                  value: "8,5",
                  marker: 3,
                },
                {
                  label: "Desde el mes",
                  kind: "input",
                  value: "noviembre de 2026",
                  marker: 3,
                },
                {
                  label: "Motivo (opcional)",
                  kind: "input",
                  value: "paritaria camioneros",
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Aplicar aumento", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/employees]], hacé clic en {{Aumento}}.",
            {
              text: "En {{A quiénes}}, elegí el grupo:",
              substeps: [
                "{{Todos los empleados}}: todos los activos con sueldo base.",
                "{{Por puesto}}: elegí el {{Puesto}} en el campo que aparece.",
                "{{Por convenio}}: elegí el {{Convenio}} (el que cargaste en los datos formales).",
              ],
            },
            "Cargá el {{Aumento (%)}} (mayor a 0 y hasta 100; acepta coma decimal) y elegí {{Desde el mes}}. Opcional: {{Motivo (opcional)}}.",
            "Revisá la lista de abajo: para cada empleado del grupo muestra el sueldo actual → el nuevo, con una casilla tildada. Destildá a los que no reciben el aumento (la casilla de arriba tilda o destilda a todos); arriba dice cuántos quedan elegidos. Solo entran los activos con sueldo base cargado y con modalidad {{Sueldo acordado}}: los empleados {{Por recibo}} no entran, su sueldo sale del recibo. {{Aplicar aumento}} se habilita cuando el porcentaje es válido y hay al menos un empleado tildado.",
            "Hacé clic en {{Aplicar aumento}}.",
          ],
          after: [
            "El sueldo base de cada empleado sube y se redondea a centavos. El aviso dice a cuántos se aplicó.",
            "En las planillas mensuales en borrador desde ese mes, la columna {{Sueldo}} se actualiza para los empleados mensuales y mixtos cuyo sueldo cargado era el anterior; si lo habías cambiado a mano, se respeta. Las planillas cerradas no cambian.",
            "Cada empleado suma una línea en su {{Historial de sueldo}} con el porcentaje y el motivo.",
          ],
          errors: [
            {
              message: "Sin permiso para aplicar aumentos.",
              fix: "Pedile el aumento a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo aplicar el aumento.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["editar-empleado", "editar-planilla"],
          keywords: [
            "aumento",
            "paritaria",
            "subir sueldos",
            "ajuste salarial",
            "porcentaje",
          ],
        },
        {
          id: "exportar-empleados",
          title: "Exportar el padrón de empleados",
          permission: "hr:read",
          steps: [
            "En [[/employees]], hacé clic en {{Exportar}}.",
            "Elegí el formato: {{PDF}} o {{Excel}}.",
            "Para todo el padrón, hacé clic en {{Todo el historial}}. Para acotar, elegí {{Desde}} y {{Hasta}} y hacé clic en {{Descargar período}}: el rango filtra por la fecha en que el empleado se cargó en el sistema.",
          ],
          after: [
            "El PDF se abre en otra pestaña; el Excel se descarga. Trae apellido y nombre, CUIL, puesto, estado e ingreso de todos los empleados (activos e inactivos).",
          ],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo o descargá el PDF.",
            },
          ],
          keywords: ["exportar", "excel", "pdf", "listado de personal"],
        },
      ],
    },

    // ── Ficha del empleado ───────────────────────────────────────────────
    {
      id: "ficha-empleado",
      title: "Ficha del empleado",
      menuPath: "Personal › Empleados",
      routes: ["/employees/[id]"],
      permission: "hr:read",
      intro: [
        "La ficha reúne todo lo del empleado. Arriba, el nombre, la posición, la frecuencia de pago y las marcas {{Monotributo}} e {{Inactivo}} (con la fecha de baja), y los botones {{Editar}} y {{Dar de baja}} (o {{Reactivar}}). Si el empleado es chofer, {{Ver viajes y km}} abre su página de Flota ([[#flota-km-mensual]]) con sus viajes y los km de cada día.",
        "Debajo, en orden: {{Datos}} (CUIL, CBU, ingreso y egreso), {{Sueldo}} ({{Sueldo base}} y {{Viático mensual}}), {{Datos formales}}, {{Notas}}, {{Vacaciones y licencias}}, {{Cuenta corriente}}, {{Embargos}}, {{Historial de sueldo}}, {{Extras por viajes}}, {{Liquidación final}} (solo de un empleado dado de baja) y {{Documentos}}.",
        "Sin permiso de escritura en Personal la ficha se ve sin botones para cambiar nada y sin la tarjeta de liquidación final.",
      ],
      concepts: [
        {
          title: "La cuenta corriente del empleado",
          body: [
            "Lleva lo que el empleado le debe a la empresa (o a un socio), por moneda: adelantos, compras a su cargo y deudas. No es costo: se devuelve con descuentos de planilla o con pagos.",
            "Arriba muestra el saldo de cada moneda: {{Debe}} si el empleado debe, o {{A favor del empleado}} si pagó de más; y, si corresponde, cuánto de eso es con socios.",
            "Cada movimiento tiene un tipo ({{Adelanto}}, {{Cargo}}, {{Descuento de planilla}}, {{Pago}}, {{Condonación}}) y un origen ({{Caja}}, {{Tarjeta}}, {{Compra}}, {{Planilla}}, {{Rendición}}, {{Plan}}, {{Manual}}). Adelantos y cargos van al {{Debe}}; lo demás, al {{Haber}}. Un adelanto que se devuelve en cuotas se muestra como {{Préstamo}}, y su plan lleva la misma marca.",
            "Solo se borran desde acá los movimientos de origen {{Manual}} o {{Caja}}. Los demás se manejan desde lo que los generó: una compra «a cargo de empleado», un resumen de tarjeta ({{Deshacer pago}} en [[/card-statements]]), el cierre de la planilla o el plan condonado.",
            "Un **plan** dice cómo se devuelve una deuda: un total y una cuota mensual desde un mes. La cuota de cada plan activo en pesos es lo que la planilla descuenta por defecto en la columna {{Deudas}}; los planes en dólares no se descuentan en la planilla y se saldan con pagos. Un plan ya pagado se ve como {{Saldado}}.",
            "Se muestran los 500 movimientos más recientes; el saldo siempre incluye todos.",
          ],
        },
        {
          title: "Historial de sueldo",
          body: [
            "Cada cambio del sueldo base queda como una línea «Desde MM/AAAA» con el sueldo anterior → el nuevo, marcada como aumento con su porcentaje (si vino de [[#aplicar-aumento-sueldo]]) o como edición manual. Es solo de lectura.",
          ],
        },
        {
          title: "Estados de un documento",
          body: [
            "{{Vigente}}: vence en más de 30 días. {{Por vencer}}: vence en 30 días o menos. {{Vencido}}: ya pasó la fecha de vencimiento.",
          ],
        },
      ],
      tasks: [
        {
          id: "dar-de-baja-empleado",
          title: "Dar de baja a un empleado",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "~Dar de baja a Pérez, Juan",
              description:
                "Se marca como inactivo. La info histórica queda intacta.",
              fields: [
                {
                  label: "Fecha de egreso",
                  kind: "date",
                  value: "31/10/2026",
                  marker: 2,
                },
                { label: "Motivo / notas", kind: "textarea", marker: 2 },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Dar de baja", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, hacé clic en {{Dar de baja}}.",
            "Elegí la {{Fecha de egreso}} (viene la de hoy) y, si querés, escribí el {{Motivo / notas}}.",
            "Hacé clic en {{Dar de baja}}.",
          ],
          after: [
            "El empleado queda {{Inactivo}} con su fecha de egreso. No entra en las planillas que se generen después ni en la grilla de asistencia; su historia (planillas, pagos, cuenta corriente) queda igual.",
            "Si escribiste un motivo, se agrega al final de las {{Notas}} del empleado; las que tenía se conservan.",
            "Su ficha de chofer se desactiva: deja de aparecer para asignarle viajes.",
            "Aparece la tarjeta {{Liquidación final}} en la ficha: ver [[#cargar-liquidacion-final]].",
          ],
          errors: [
            {
              message: "Fecha inválida.",
              fix: "Elegí la fecha de egreso.",
            },
            {
              message: "No tenés permiso para dar de baja empleados.",
              fix: "Pedile la baja a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo dar de baja al empleado.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-liquidacion-final", "reactivar-empleado"],
          keywords: ["baja", "despido", "renuncia", "egreso", "desvincular"],
        },
        {
          id: "reactivar-empleado",
          title: "Reactivar a un empleado dado de baja",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado inactivo, hacé clic en {{Reactivar}}.",
            "En {{Reactivar empleado}}, confirmá con {{Reactivar}}.",
          ],
          after: [
            "Vuelve a estar {{Activo}} y se borra su fecha de egreso.",
            "Si es chofer, su ficha de chofer no se reactiva sola: se activa de nuevo la próxima vez que guardes un cambio del empleado con la posición {{Chofer / Acompañante}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para reactivar empleados.",
              fix: "Pedile la reactivación a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo reactivar al empleado.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["dar-de-baja-empleado"],
          keywords: ["reincorporar", "volver a activar", "reingreso"],
        },
        {
          id: "registrar-adelanto-empleado",
          title: "Registrar un adelanto o un préstamo a un empleado",
          summary:
            "Sale plata de una caja o banco y queda como deuda del empleado. Un adelanto se descuenta entero en la planilla del mes; un préstamo, en cuotas mensuales.",
          permission: ["hr:write", "transactions:write"],
          prerequisites: [
            "Una caja o banco activo (no una cartera de cheques).",
            "Mueve plata de Tesorería: además de escribir en Personal, hace falta permiso para cargar movimientos de caja y poder ver las cuentas para elegir una.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Préstamo a empleado — Pérez, Juan",
              description:
                "Sale de la cuenta elegida y va a la cuenta corriente del empleado (no es un gasto). Se descuenta en la planilla en cuotas mensuales, desde el mes de la fecha.",
              fields: [
                {
                  label: "Cuenta",
                  kind: "select",
                  value: "Caja (ARS)",
                  marker: 2,
                },
                { label: "Canal", kind: "select", value: "Jouve", marker: 2 },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                {
                  label: "Importe",
                  kind: "money",
                  value: "300.000",
                  marker: 2,
                },
                {
                  label: "Descripción (opcional)",
                  kind: "input",
                  value: "préstamo personal",
                  wide: true,
                },
                {
                  label: "Cuota mensual",
                  kind: "money",
                  value: "100.000",
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Registrar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}}, hacé clic en {{Adelanto}} (se descuenta entero en la planilla del mes) o en {{Préstamo}} (se descuenta en cuotas). También se cargan desde Tesorería con {{Adelanto a empleado}} o {{Préstamo a empleado}}, eligiendo primero el {{Empleado}}.",
            "Elegí la {{Cuenta}} de donde sale la plata (la moneda es la de la cuenta), el {{Canal}}, la {{Fecha}} y el {{Importe}}. Opcional: una {{Descripción (opcional)}}; si no, queda «Adelanto a» o «Préstamo a» y el nombre.",
            "En un préstamo, cargá la {{Cuota mensual}}: tiene que ser menor que el importe, y abajo dice en cuántas cuotas queda.",
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "Se crea un egreso en la cuenta elegida y su asiento contra **Anticipos al personal** (un activo, no un gasto).",
            "En la cuenta corriente aparece el movimiento ({{Adelanto}} o {{Préstamo}}) con origen {{Caja}} y un plan con el total, la cuota (en un adelanto, el total) y primer mes el de la fecha.",
            "Las planillas mensuales en borrador recalculan la columna {{Deudas}} del empleado con la cuota (solo planes en pesos).",
          ],
          errors: [
            {
              message: "Importe inválido.",
              fix: "Cargá un importe mayor a cero.",
            },
            {
              message:
                "La cuota tiene que ser menor que el préstamo: si se descuenta entero en un mes, es un adelanto.",
              fix: "Bajá la cuota, o cargalo como {{Adelanto}}.",
            },
            {
              message:
                "Los movimientos en cuentas de cheques se manejan desde Cheques (cargar, depositar, endosar)",
              fix: "Elegí una caja o un banco.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "La fecha cae en un mes contable cerrado: usá otra fecha o pedí reabrir el período (ver [[#periodos-cerrados]]).",
            },
            {
              message:
                "Sin permiso para registrar adelantos o pagos de empleados.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja: pedíselo al owner.",
            },
            {
              message: "No se pudo registrar el adelanto.",
              fix: "Probá de nuevo.",
            },
          ],
          related: [
            "registrar-pago-empleado-caja",
            "cargar-plan-deuda",
            "editar-planilla",
          ],
          keywords: [
            "adelanto",
            "anticipo",
            "vale",
            "préstamo al empleado",
            "adelanto de sueldo",
          ],
        },
        {
          id: "registrar-pago-empleado-caja",
          title: "Registrar un pago del empleado en caja",
          summary:
            "El empleado devuelve plata en efectivo o por transferencia: entra en una caja o banco y baja su deuda.",
          permission: ["hr:write", "transactions:write"],
          prerequisites: [
            "Una caja o banco activo. Mueve plata de Tesorería: hace falta también permiso para cargar movimientos de caja y poder ver las cuentas para elegir una.",
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}}, hacé clic en {{Pago en caja}}.",
            "Elegí la {{Cuenta}} donde entra la plata, el {{Canal}}, la {{Fecha}}, el {{Importe}} y, opcional, una {{Descripción (opcional)}}.",
            "Si el empleado tiene planes con saldo en esa moneda, podés elegir uno en {{Imputar a un plan (opcional)}}; si no, dejá {{Sin plan}}.",
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "Se crea un ingreso en la cuenta elegida, con su asiento contra Anticipos al personal, y un {{Pago}} en la cuenta corriente que baja el saldo.",
            "Si lo imputaste a un plan, baja lo que resta de ese plan; la cuota que descuenta la planilla nunca supera lo que resta.",
          ],
          errors: [
            {
              message: "Importe inválido.",
              fix: "Cargá un importe mayor a cero.",
            },
            {
              message:
                "El plan no existe o es de otro empleado o de otra moneda que la cuenta",
              fix: "Elegí un plan de la misma moneda que la cuenta, o {{Sin plan}}.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "Usá otra fecha o pedí reabrir el período contable (ver [[#periodos-cerrados]]).",
            },
            {
              message:
                "Sin permiso para registrar adelantos o pagos de empleados.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja.",
            },
            {
              message: "No se pudo registrar el pago.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["registrar-adelanto-empleado", "cargar-movimiento-manual"],
          keywords: ["devolución", "pago del empleado", "cancelar deuda"],
        },
        {
          id: "cargar-movimiento-manual",
          title: "Cargar una deuda o un pago sin pasar por caja",
          summary:
            "Para un préstamo de un socio, un saldo inicial o un pago recibido afuera: no mueve ninguna cuenta de Tesorería.",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Movimiento manual",
              description:
                "Una deuda o un pago que no pasa por la caja: un préstamo de un socio, un saldo inicial, un pago recibido afuera. Para un adelanto o un pago en efectivo o transferencia usá los botones de caja.",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Cargo (el empleado debe)",
                  marker: 2,
                },
                {
                  label: "Acreedor",
                  kind: "select",
                  value: "Socio",
                  marker: 2,
                },
                { label: "Moneda", kind: "select", value: "USD" },
                { label: "Importe", kind: "money", value: "1.500" },
                { label: "Fecha", kind: "date", value: "05/11/2026" },
                { label: "Plan (opcional)", kind: "select", value: "Sin plan" },
                {
                  label: "Descripción",
                  kind: "input",
                  value: "préstamo para la moto",
                  wide: true,
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}}, hacé clic en {{Movimiento}}.",
            {
              text: "Elegí:",
              substeps: [
                "{{Tipo}}: {{Cargo (el empleado debe)}} o {{Pago (baja la deuda)}}.",
                "{{Acreedor}}: {{Empresa}} o {{Socio}}.",
                "{{Moneda}}: `ARS` o `USD`.",
                "{{Plan (opcional)}}: un plan de esa moneda para imputarlo, o {{Sin plan}}.",
              ],
            },
            "Cargá {{Importe}}, {{Fecha}} y una {{Descripción}} (obligatoria, hasta 200 caracteres).",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "El movimiento aparece con origen {{Manual}} y cambia el saldo de esa moneda. No genera movimiento de caja ni asiento.",
          ],
          errors: [
            {
              message: "Describí el movimiento.",
              fix: "Escribí una descripción.",
            },
            {
              message: "Máximo 200 caracteres.",
              fix: "Acortá la descripción.",
            },
            {
              message: "El importe tiene que ser mayor a 0.",
              fix: "Cargá un importe positivo.",
            },
            {
              message:
                "El plan es de otro empleado o de otra moneda que el movimiento",
              fix: "Elegí un plan de la misma moneda o {{Sin plan}}.",
            },
            {
              message: "Sin permiso para cargar movimientos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo cargar el movimiento.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["borrar-movimiento-cuenta-empleado", "cargar-plan-deuda"],
          keywords: [
            "saldo inicial",
            "deuda con socio",
            "cargo al empleado",
            "cuenta corriente",
          ],
        },
        {
          id: "borrar-movimiento-cuenta-empleado",
          title: "Borrar un movimiento de la cuenta corriente",
          permission: "hr:write",
          prerequisites: [
            "Solo los movimientos de origen {{Manual}} o {{Caja}} tienen el botón de borrar.",
            "Borrar uno de origen {{Caja}} borra también su movimiento de caja: hace falta además permiso para cargar movimientos de caja (sin él, el botón aparece apagado y explica por qué).",
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}} › {{Movimientos}}, hacé clic en el ícono de papelera de la fila ({{Borrar movimiento}}). Se borra en el momento, sin pedir confirmación.",
          ],
          after: [
            "El saldo se recalcula. Si era de {{Caja}}, se borra también el movimiento de la cuenta de Tesorería y su asiento.",
            "Si era un adelanto con plan y el plan no tenía descuentos ni pagos, el plan se borra con él.",
          ],
          errors: [
            {
              message:
                "El plan de este adelanto ya tiene descuentos o pagos: cancelá el plan en vez de borrar el adelanto",
              fix: "Cambiá el estado del plan a {{Cancelado}} (ver [[#cambiar-estado-plan]]).",
            },
            {
              message:
                "El descuento de planilla lo escribe el cierre del período: reabrilo para cambiarlo",
              fix: "Reabrí la planilla del mes ([[#reabrir-planilla]]) y corregí la columna {{Deudas}}.",
            },
            {
              message: "Sin permiso para borrar este movimiento. …",
              fix: "Pedile al owner permiso para cargar movimientos de caja, o pedile el borrado a alguien que lo tenga.",
            },
            {
              message:
                "El período contable … está cerrado y no admite movimientos",
              fix: "El movimiento de caja es de un mes contable cerrado: pedí reabrirlo (ver [[#periodos-cerrados]]).",
            },
            {
              message: "No se pudo borrar el movimiento.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["registrar-adelanto-empleado", "cargar-movimiento-manual"],
          keywords: ["eliminar adelanto", "anular movimiento"],
        },
        {
          id: "cargar-plan-deuda",
          title: "Cargar o editar un plan de devolución",
          summary:
            "Define cuánto se descuenta por mes de una deuda del empleado, desde qué mes y a quién se le debe.",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo plan",
              description:
                "La cuota es lo que la planilla descuenta por defecto cada mes desde el mes de inicio (solo planes en pesos), hasta completar el total. En la planilla se puede cambiar el descuento de un mes.",
              fields: [
                {
                  label: "Descripción",
                  kind: "input",
                  value: "préstamo para la moto",
                  wide: true,
                  marker: 2,
                },
                { label: "Moneda", kind: "select", value: "ARS", marker: 2 },
                {
                  label: "Primer mes",
                  kind: "input",
                  value: "diciembre de 2026",
                  marker: 2,
                },
                { label: "Total", kind: "money", value: "600.000", marker: 2 },
                {
                  label: "Cuota mensual",
                  kind: "money",
                  value: "100.000",
                  marker: 2,
                },
                { label: "Acreedor", kind: "select", value: "Empresa" },
                { label: "Notas", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}}, hacé clic en {{Plan}}. Para editar uno existente, hacé clic en el lápiz de su fila ({{Editar plan}}).",
            {
              text: "Completá:",
              substeps: [
                "{{Descripción}}: obligatoria (por ejemplo «adelanto de marzo»).",
                "{{Moneda}}: `ARS` o `USD`. No se cambia al editar.",
                "{{Primer mes}}: desde cuándo lo descuenta la planilla.",
                "{{Total}} y {{Cuota mensual}}: la cuota no puede superar el total.",
                "{{Acreedor}}: {{Empresa}} o {{Socio}}; con socio, escribí su nombre en {{Socio}}.",
                "{{Notas}}: opcional.",
              ],
            },
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "El plan aparece en {{Planes}} con la cuota, lo pagado y lo que resta.",
            "Si está {{Activo}} y es en pesos, las planillas mensuales en borrador desde su primer mes recalculan la columna {{Deudas}} del empleado (salvo las filas donde cargaste el descuento a mano).",
          ],
          errors: [
            {
              message: "Describí la deuda.",
              fix: "Escribí una descripción.",
            },
            {
              message: "La cuota no puede superar el total.",
              fix: "Bajá la cuota o subí el total.",
            },
            {
              message:
                "El total del plan no puede ser menor a lo que ya se pagó",
              fix: "Cargá un total igual o mayor a lo pagado.",
            },
            {
              message: "El importe tiene que ser mayor a 0.",
              fix: "Cargá un total y una cuota positivos.",
            },
            {
              message: "Sin permiso para cargar planes.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo cargar el plan.",
              fix: "Probá de nuevo.",
            },
          ],
          related: [
            "cambiar-estado-plan",
            "borrar-plan-deuda",
            "editar-planilla",
          ],
          keywords: ["plan de pagos", "cuotas", "descuento mensual", "deuda"],
        },
        {
          id: "cambiar-estado-plan",
          title: "Pausar, cancelar o condonar un plan",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}} › {{Planes}}, abrí el selector de estado de la fila ({{Estado del plan}}).",
            {
              text: "Elegí el estado:",
              substeps: [
                "{{Activo}}: la planilla descuenta la cuota.",
                "{{Pausado}}: la planilla deja de descontarla hasta que lo vuelvas a activar.",
                "{{Cancelado}}: el plan deja de descontarse; la deuda sigue en la cuenta corriente.",
                "{{Condonado}}: se perdona lo que resta. Pide confirmación ({{Condonar plan}} → {{Condonar}}) y no se puede deshacer.",
              ],
            },
          ],
          after: [
            "Las planillas mensuales en borrador recalculan la columna {{Deudas}} del empleado.",
            "Al condonar, se escribe una {{Condonación}} por lo que restaba, que baja la cuenta corriente. Un plan condonado ya no muestra controles.",
          ],
          errors: [
            {
              message: "Un plan condonado no cambia de estado",
              fix: "La condonación es definitiva: si hace falta, cargá un cargo manual nuevo.",
            },
            {
              message: "Sin permiso para cambiar planes.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo cambiar el estado del plan.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-plan-deuda", "borrar-plan-deuda"],
          keywords: ["condonar", "perdonar deuda", "pausar descuento"],
        },
        {
          id: "borrar-plan-deuda",
          title: "Borrar un plan",
          permission: "hr:write",
          prerequisites: [
            "Solo un plan sin nada pagado tiene el botón de borrar. Uno con descuentos o pagos se cancela (ver [[#cambiar-estado-plan]]).",
          ],
          steps: [
            "En la ficha del empleado, en {{Cuenta corriente}} › {{Planes}}, hacé clic en la papelera de la fila ({{Borrar plan}}). Se borra sin pedir confirmación.",
          ],
          after: [
            "Las planillas en borrador recalculan la columna {{Deudas}}. La deuda en sí (el adelanto o el cargo) sigue en la cuenta corriente.",
          ],
          errors: [
            {
              message:
                "El plan ya tiene descuentos, pagos o una condonación: cancelalo en vez de borrarlo",
              fix: "Cambiá su estado a {{Cancelado}}.",
            },
            {
              message: "No se pudo borrar el plan.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cambiar-estado-plan"],
        },
        {
          id: "cargar-embargo",
          title: "Cargar o editar un embargo",
          summary:
            "Un embargo judicial se descuenta solo en cada planilla en borrador mientras esté vigente.",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo embargo",
              description:
                "El porcentaje se calcula sobre el neto del recibo (o sobre el sueldo pactado mientras no haya recibo). Cambiarlo recalcula las planillas en borrador; las cerradas no cambian.",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Porcentaje del recibo",
                  marker: 2,
                },
                { label: "Porcentaje", kind: "input", value: "10", marker: 2 },
                {
                  label: "Vigente desde",
                  kind: "date",
                  value: "01/11/2026",
                  marker: 3,
                },
                { label: "Hasta (opcional)", kind: "date", marker: 3 },
                {
                  label: "Beneficiario",
                  kind: "input",
                  value: "cuota alimentaria",
                  wide: true,
                },
                { label: "Juzgado / oficio", kind: "textarea", wide: true },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Embargos}}, hacé clic en {{Nuevo embargo}}. Para editar uno, hacé clic en el lápiz de su fila ({{Editar embargo}}).",
            "En {{Tipo}}, elegí {{Porcentaje del recibo}} y cargá el {{Porcentaje}} (hasta 100), o {{Monto fijo}} y cargá el {{Monto mensual}}. Al cambiar el tipo, el valor se borra.",
            "Elegí {{Vigente desde}} y, si tiene fin, {{Hasta (opcional)}}.",
            "Opcional: {{Beneficiario}} y {{Juzgado / oficio}}. Hacé clic en {{Guardar}}.",
          ],
          after: [
            "En cada planilla en borrador cuyo mes cae dentro de la vigencia, la columna {{Embargo}} del empleado se recalcula (suma todos sus embargos vigentes) y baja la transferencia sugerida. Las planillas cerradas no cambian.",
            "En una fila de planilla podés cambiar el embargo a mano; ver [[#volver-valor-calculado-planilla]].",
          ],
          errors: [
            {
              message: "El valor tiene que ser mayor a 0.",
              fix: "Cargá un porcentaje o monto positivo.",
            },
            {
              message: "El porcentaje no puede superar 100.",
              fix: "Revisá el porcentaje.",
            },
            {
              message: "La fecha de fin es anterior al inicio.",
              fix: "Corregí las fechas de vigencia.",
            },
            {
              message: "Sin permiso para cargar embargos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo cargar el embargo.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["borrar-embargo", "editar-planilla"],
          keywords: [
            "embargo",
            "cuota alimentaria",
            "oficio judicial",
            "retención judicial",
          ],
        },
        {
          id: "borrar-embargo",
          title: "Borrar un embargo",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Embargos}}, hacé clic en la papelera de la fila ({{Borrar embargo}}). Se borra sin pedir confirmación.",
          ],
          after: [
            "Las planillas en borrador recalculan la columna {{Embargo}} del empleado; las cerradas no cambian. Para terminar un embargo sin perder su historia, editalo y cargá {{Hasta (opcional)}}.",
          ],
          errors: [
            {
              message: "Sin permiso para borrar embargos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo borrar el embargo.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-embargo"],
        },
        {
          id: "editar-tarifas-viajes",
          title: "Cargar las tarifas de extras por viajes de un chofer",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Extras por viajes}}, hacé clic en {{Editar}}.",
            "Cargá {{Por jornada}} (día con al menos un viaje completado), {{Por km}} y {{Por descarga}} (carga entregada). Un campo vacío no sugiere ese concepto.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "La planilla del mes sugiere los extras de este chofer con estas tarifas: ver [[#agregar-extras-viajes]].",
          ],
          errors: [
            {
              message: "No se pudieron guardar las tarifas.",
              fix: "Probá de nuevo.",
            },
            {
              message: "Sin permiso para editar empleados.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["agregar-extras-viajes"],
          keywords: ["tarifa por km", "jornada", "descarga", "extras chofer"],
        },
        {
          id: "cargar-liquidacion-final",
          title: "Cargar la liquidación final de un empleado dado de baja",
          summary:
            "El sistema sugiere el sueldo proporcional, las vacaciones no gozadas y el SAC proporcional; se revisan y se cargan en la planilla del mes de la baja.",
          permission: "hr:write",
          prerequisites: [
            "El empleado tiene que estar dado de baja con fecha de egreso ([[#dar-de-baja-empleado]]).",
            "La planilla del mes de la baja no puede estar cerrada.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Ficha del empleado › Liquidación final",
              title: "Liquidación final",
              fields: [
                {
                  label: "~Sueldo por 31 días trabajados",
                  kind: "money",
                  value: "950.000",
                  marker: 2,
                },
                {
                  label: "Días de vacaciones no gozadas",
                  kind: "input",
                  value: "12,5",
                  marker: 2,
                },
                {
                  label: "Vacaciones no gozadas ($)",
                  kind: "money",
                  value: "475.000",
                  marker: 2,
                },
                {
                  label: "~SAC proporcional (SAC 2.º semestre 2026)",
                  kind: "money",
                  value: "316.667",
                  marker: 2,
                },
              ],
              footer: [
                {
                  label: "Cargar en la planilla",
                  variant: "primary",
                  marker: 3,
                },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, bajá hasta {{Liquidación final}}. El texto dice la fecha de baja, el sueldo de base y en qué planilla se va a cargar (con un enlace).",
            "Revisá y corregí los cuatro montos sugeridos: sueldo por los días trabajados, días y monto de vacaciones no gozadas, y SAC proporcional.",
            "Si el empleado es {{Por recibo}}, la tarjeta no muestra los montos de vacaciones ni de SAC: «Por recibo: las vacaciones no gozadas y el SAC proporcional van dentro del recibo final; cargalo en la planilla.» Se carga el sueldo proporcional como referencia y, al cargar el recibo final en la planilla, el recibo pasa a ser el sueldo.",
            "Hacé clic en {{Cargar en la planilla}}.",
          ],
          after: [
            "Si la planilla del mes de la baja no existía, se genera. En la fila del empleado, {{Sueldo}} queda con el sueldo proporcional y se agregan los extras «Liquidación final: Vacaciones no gozadas» y «Liquidación final: SAC proporcional (…)» si cada monto es mayor a cero.",
            "Volver a cargarla reemplaza el sueldo y los extras de la liquidación anteriores.",
            "En un empleado {{Por recibo}} no se agregan vacaciones ni SAC, y si el recibo final ya estaba cargado queda como sueldo.",
            "Los pagos se registran después en la planilla como cualquier otro ([[#registrar-pago-sueldo]]).",
          ],
          errors: [
            {
              message: "Revisá los montos: tienen que ser números.",
              fix: "Corregí el monto o los días que no son un número.",
            },
            {
              message:
                "La planilla de … está cerrada: reabrila para cargar la liquidación final.",
              fix: "Pedile a un owner o admin que reabra la planilla ([[#reabrir-planilla]]).",
            },
            {
              message: "El empleado no tiene fecha de baja.",
              fix: "Dale de baja con su fecha de egreso.",
            },
            {
              message: "Sin permiso para editar la planilla.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo cargar la liquidación final.",
              fix: "No se cargó ningún monto: volvé a hacer clic en {{Cargar en la planilla}}.",
            },
          ],
          related: ["dar-de-baja-empleado", "editar-planilla"],
          keywords: [
            "liquidación final",
            "despido",
            "vacaciones no gozadas",
            "SAC proporcional",
            "indemnización",
          ],
        },
        {
          id: "cargar-documento-empleado",
          title: "Cargar un documento con vencimiento",
          summary:
            "Carnet, LNH, libreta sanitaria, cursos, aptitudes: el sistema avisa cuando están por vencer.",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Nuevo documento",
              description:
                "Cargá un papel vencible (carnet, libreta, curso, etc.).",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Licencia de conducir",
                  marker: 2,
                },
                {
                  label: "Número (opcional)",
                  kind: "input",
                  value: "12345678",
                },
                { label: "Emisión (opcional)", kind: "date" },
                {
                  label: "Vencimiento",
                  kind: "date",
                  value: "10/03/2028",
                  marker: 2,
                },
                { label: "Autoridad emisora (opcional)", kind: "input" },
                { label: "Notas (opcional)", kind: "textarea" },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Crear", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Documentos}}, hacé clic en {{Nuevo documento}}.",
            "Elegí el {{Tipo}} ({{Licencia de conducir}}, {{Libreta sanitaria}}, {{Aptitud psicofísica}}, {{ARN (CNRT)}}, {{Otro}}, entre otros) y la fecha de {{Vencimiento}} (obligatoria). Opcional: {{Número (opcional)}}, {{Emisión (opcional)}}, {{Autoridad emisora (opcional)}} y {{Notas (opcional)}}.",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "El documento aparece en la tabla con su estado ({{Vigente}}, {{Por vencer}} o {{Vencido}}). Mientras vence entre hoy y los próximos 30 días, figura en [[/hr/document-expirations]] y en el aviso diario.",
          ],
          errors: [
            {
              message: "Fecha de vencimiento requerida.",
              fix: "Elegí la fecha de vencimiento.",
            },
            {
              message: "Vencimiento debe ser posterior a la emisión.",
              fix: "Corregí las fechas.",
            },
            {
              message: "Sin permiso para cargar documentos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: [
            "editar-documento-empleado",
            "borrar-documento-empleado",
            "vencimientos-personal",
          ],
          keywords: [
            "carnet",
            "licencia de conducir",
            "libreta sanitaria",
            "psicofísico",
            "LNH",
            "vencimiento",
          ],
        },
        {
          id: "editar-documento-empleado",
          title: "Editar o renovar un documento",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Documentos}}, hacé clic en el lápiz de la fila ({{Editar}}).",
            "En {{Editar documento}}, cambiá los datos (por ejemplo, la nueva fecha de {{Vencimiento}} de un carnet renovado).",
            "Hacé clic en {{Guardar}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "El estado se recalcula con la nueva fecha; un documento renovado sale de los vencimientos.",
          ],
          errors: [
            {
              message: "Vencimiento debe ser posterior a la emisión.",
              fix: "Corregí las fechas.",
            },
            {
              message: "Sin permiso para editar documentos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message: "No se pudo actualizar el documento.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["cargar-documento-empleado"],
          keywords: ["renovar carnet", "actualizar vencimiento"],
        },
        {
          id: "borrar-documento-empleado",
          title: "Borrar un documento",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Documentos}}, hacé clic en la papelera de la fila ({{Borrar}}).",
            "Confirmá en {{¿Borrar documento?}} con {{Borrar}}.",
          ],
          after: [
            "El documento desaparece de la ficha y de los vencimientos. No se puede deshacer.",
          ],
          related: ["cargar-documento-empleado"],
        },
      ],
    },

    // ── Sueldos: lista de planillas ──────────────────────────────────────
    {
      id: "sueldos",
      title: "Sueldos",
      menuPath: "Personal › Sueldos",
      routes: ["/hr/payroll"],
      permission: "hr:read",
      intro: [
        "Una planilla editable por mes, y una por semestre para el SAC (aguinaldo). La tabla lista las planillas generadas con {{Período}} (por ejemplo «Octubre 2026» o «SAC 2.º semestre 2026»), {{Estado}} ({{Borrador}} o {{Cerrado}}), {{Creado}}, {{Cerrado}} y el enlace {{Abrir →}}.",
      ],
      screens: [
        {
          kind: "page",
          title: "Sueldos",
          subtitle:
            "Una planilla editable por mes, y una por semestre para el SAC.",
          actions: [
            { label: "Nuevo SAC", variant: "outline" },
            { label: "Nuevo período", variant: "primary" },
          ],
          table: {
            columns: ["Período", "Estado", "Creado", "Cerrado", "Acciones"],
            rows: [
              ["~Noviembre 2026", "~Borrador", "~01/11/2026", "—", "~Abrir →"],
              [
                "~Octubre 2026",
                "~Cerrado",
                "~01/10/2026",
                "~04/11/2026",
                "~Abrir →",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "generar-periodo-sueldos",
          title: "Generar la planilla de sueldos de un mes",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Generar período",
              description:
                "Crea (si no existe) el período + entries draft para todos los empleados activos con sus defaults.",
              fields: [
                { label: "Mes", kind: "select", value: "Noviembre", marker: 2 },
                { label: "Año", kind: "select", value: "2026", marker: 2 },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Generar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/hr/payroll]], hacé clic en {{Nuevo período}}.",
            "Elegí {{Mes}} y {{Año}}.",
            "Hacé clic en {{Generar}}.",
          ],
          after: [
            "Se crea la planilla en {{Borrador}} con una fila por empleado activo y se abre. Si ya existía, se abre la existente sin cambiarla.",
            "Cada fila arranca con {{Sueldo}} = el sueldo base vigente ese mes según el historial (empleados mensuales y mixtos; 0 para los semanales), {{Viáticos}} = el viático mensual del empleado, {{Deudas}} = la cuota de sus planes activos en pesos ([[#cargar-plan-deuda]]) y {{Embargo}} = lo que suman sus embargos vigentes ese mes ([[#cargar-embargo]]).",
          ],
          errors: [
            {
              message: "Sin permisos para crear períodos de liquidación.",
              fix: "Generar planillas es para owner, admin y finanzas.",
            },
            {
              message: "Sin permiso para crear períodos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["planilla-sueldos", "generar-sac"],
          keywords: [
            "nueva planilla",
            "liquidar sueldos",
            "abrir mes",
            "período de sueldos",
          ],
        },
        {
          id: "generar-sac",
          title: "Generar la planilla del SAC (aguinaldo)",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "Generar SAC (aguinaldo)",
              description:
                "Crea (si no existe) la planilla del semestre con el SAC sugerido para cada empleado activo: 50% de la mejor remuneración mensual del semestre (sueldo + extras), proporcional a los días trabajados. Los montos se pueden editar.",
              fields: [
                {
                  label: "Semestre",
                  kind: "select",
                  value: "2.º semestre (diciembre)",
                  marker: 2,
                },
                { label: "Año", kind: "select", value: "2026", marker: 2 },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Generar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/hr/payroll]], hacé clic en {{Nuevo SAC}}.",
            "Elegí el {{Semestre}} ({{1.er semestre (junio)}} o {{2.º semestre (diciembre)}}) y el {{Año}}.",
            "Hacé clic en {{Generar}}.",
          ],
          after: [
            "Se crea y se abre la planilla «SAC 1.er semestre …» o «SAC 2.º semestre …» en {{Borrador}}, con una fila por empleado activo que ya había ingresado al terminar el semestre. La columna {{SAC}} trae el monto sugerido; {{Viáticos}} arranca en 0.",
            "Se edita, se paga y se cierra igual que una planilla mensual ([[#planilla-sueldos]]).",
          ],
          errors: [
            {
              message: "Sin permisos para crear períodos de liquidación.",
              fix: "Generar planillas es para owner, admin y finanzas.",
            },
            {
              message: "Sin permiso para crear períodos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["generar-periodo-sueldos", "planilla-sueldos"],
          keywords: ["aguinaldo", "SAC", "medio aguinaldo"],
        },
      ],
    },

    // ── Planilla de un mes o del SAC ─────────────────────────────────────
    {
      id: "planilla-sueldos",
      title: "Planilla de sueldos (mes y SAC)",
      menuPath: "Personal › Sueldos",
      routes: ["/hr/payroll/[year]/[month]", "/hr/payroll/sac/[year]/[half]"],
      permission: "hr:read",
      intro: [
        "La planilla de un mes («Planilla Noviembre 2026») o de un semestre del SAC. Arriba muestra el estado y la cantidad de empleados; los botones según el estado y tus permisos: {{Pago masivo}}, {{Extras de viajes}} (solo planilla mensual), {{Agregar faltantes}}, {{Cerrar período}} y, si está cerrada, {{Reabrir}}.",
        "Una fila por empleado (los dados de baja se ven atenuados) y una fila de {{Totales}} abajo. Las celdas con montos se editan en el lugar mientras la planilla está en borrador.",
      ],
      screens: [
        {
          kind: "page",
          title: "~Planilla Noviembre 2026",
          subtitle: "~Borrador · 12 empleados",
          actions: [
            { label: "Pago masivo", variant: "outline" },
            { label: "Extras de viajes", variant: "outline" },
            { label: "Agregar faltantes", variant: "outline" },
            { label: "Cerrar período", variant: "outline" },
          ],
          table: {
            columns: [
              "Empleado",
              "Sueldo",
              "Recibo",
              "Otros",
              "Extras",
              "Viáticos",
              "Deudas",
              "Teléfono",
              "Embargo",
              "Total",
              "Transf. / Efectivo",
              "Pagado",
              "Saldo",
            ],
            rows: [
              [
                "~Pérez, Juan",
                "~950.000",
                "~700.000",
                "~250.000",
                "~$ 60.000",
                "~20.000",
                "~100.000",
                "~0",
                "~70.000",
                "~$ 860.000",
                "~530.000 / 330.000",
                "~$ 0",
                "~$ 860.000",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Las columnas",
          body: [
            "{{Sueldo}} (en el SAC, {{SAC}}): el sueldo pactado del mes. {{Recibo}}: el neto del recibo del liquidador; vacío = sin recibo cargado. {{Otros}}: sueldo pactado − neto del recibo.",
            "Un empleado {{Por recibo}} lleva la marca «recibo» junto al nombre: con el recibo cargado, su {{Sueldo}} es el recibo y no se edita («Sale del recibo»).",
            "{{Extras}}: la suma de las líneas de extras ([[#cargar-extras-planilla]]). {{Viáticos}} y {{Teléfono}}: montos del mes. La planilla no tiene columna de vacaciones: las vacaciones van dentro del sueldo o del recibo (y las no gozadas de una liquidación final, como extra).",
            "{{Deudas}}: la cuota de los planes activos en pesos de la cuenta corriente del empleado. Editable por mes; al cerrar el período pasa a su cuenta corriente.",
            "{{Embargo}}: lo que suman los embargos vigentes del empleado ese mes (un porcentaje se calcula sobre el {{Recibo}}, o sobre el {{Sueldo}} mientras no haya recibo).",
            "{{Total}} = Sueldo + Extras + Viáticos − Deudas − Teléfono − Embargo. {{Pagado}}: la suma de los pagos registrados. {{Saldo}} = Total − Pagado; hacé clic en el saldo para ver y cargar los pagos.",
            "{{Transf. / Efectivo}}: cómo se sugiere pagar el total. Transferencia = recibo − embargo − descuentos (deudas y teléfono), sin pasar el total; efectivo = el resto del total. Sin recibo cargado muestra «—».",
          ],
        },
        {
          title: "A qué canal va cada pago",
          body: [
            "El canal de cada pago lo asigna el sistema, sea transferencia o efectivo: a libros (canal fiscal, cuenta Sueldos y jornales) va el neto del recibo menos el embargo, sin pasar el {{Total}}; el resto (otros, extras, viáticos) va a gestión (canal interno, sin asiento). Sin recibo cargado, todo va a gestión hasta que lo cargues.",
            "Los pagos llenan la parte de libros por orden de fecha. El pago que la cruza queda partido en dos: una parte a libros y otra a gestión. En la lista de pagos se ve como un solo pago, con «Libros $ · Gestión $» debajo. Si después cambian el recibo, el embargo, los descuentos o los extras, los pagos se reparten de nuevo solos.",
            "Pasando el mouse por {{Pagado}} se ve cuánto fue a libros y cuánto a gestión.",
            "Si las deudas y el teléfono superan a los extras y los viáticos, lo pagado a libros queda por debajo del recibo. Al cerrar la planilla, la diferencia se asienta como sueldo contra la deuda del empleado (Debe Sueldos y jornales / Haber Anticipos al personal), con origen «Planilla de sueldos»; al reabrirla, ese asiento se anula. Gestión no lo vuelve a contar: ya cuenta el descuento de la planilla.",
            "Las planillas cerradas antes de este reparto conservan el canal que se eligió en cada pago.",
          ],
        },
        {
          title: "Valores calculados y valores a mano",
          body: [
            "{{Deudas}} y {{Embargo}} se calculan solos: cambian cuando cambian los planes o los embargos del empleado y cuando cambiás el {{Sueldo}} o el {{Recibo}}. Si escribís un valor a mano, queda fijo para esa fila y aparece un botón para volver al calculado ([[#volver-valor-calculado-planilla]]).",
          ],
        },
        {
          title: "Borrador y cerrado",
          body: [
            "**Borrador**: todo se edita. **Cerrado**: los montos, los extras y las filas quedan bloqueados; los pagos se siguen pudiendo registrar, editar y borrar (la idea es cerrar los montos y pagar en cuotas).",
            "Al cerrar, las {{Deudas}} de cada fila pasan a la cuenta corriente del empleado como {{Descuento de planilla}}: a cada plan activo en pesos hasta su cuota (o hasta lo que resta del plan si la cifra se cargó a mano), y el sobrante sin plan. Al reabrir, esos descuentos se borran.",
            "Cerrar una planilla de sueldos no es lo mismo que cerrar un período contable ([[#periodos-cerrados]]): un pago de sueldo con fecha en un mes contable cerrado se rechaza aunque la planilla esté abierta.",
          ],
        },
        {
          title: "Los pagos y la contabilidad",
          body: [
            "Cada pago de sueldo crea un egreso en pesos en la caja o banco elegido, con la descripción «Sueldo Apellido, Nombre (MM/AAAA)» (o «SAC … (… semestre AAAA)») y el mes de la planilla como mes de devengo. La parte que va a libros asienta un débito a **Sueldos y jornales**; la que va a gestión no lleva asiento (ver «A qué canal va cada pago»). Un pago partido en dos tiene dos movimientos, uno por canal. Editar el pago actualiza sus movimientos; borrarlo los borra.",
          ],
        },
      ],
      tasks: [
        {
          id: "editar-planilla",
          title: "Cargar o corregir los montos de la planilla",
          permission: "hr:write",
          prerequisites: ["La planilla tiene que estar en {{Borrador}}."],
          steps: [
            "En la planilla del mes, hacé clic en la celda que querés cambiar: {{Sueldo}} (o {{SAC}}), {{Recibo}}, {{Viáticos}}, {{Deudas}}, {{Teléfono}} o {{Embargo}}.",
            "Escribí el monto (formato argentino, por ejemplo `950.000,50`). En {{Recibo}} podés dejarlo vacío para quitar el recibo.",
            "Apretá Enter o salí de la celda para guardar; Escape descarta el cambio.",
          ],
          after: [
            "La fila recalcula {{Otros}}, {{Total}}, {{Transf. / Efectivo}} y {{Saldo}}, y la fila de {{Totales}}.",
            "En un empleado {{Por recibo}}, cargar el {{Recibo}} fija su {{Sueldo}} y, en una planilla mensual no anterior a su último cambio de sueldo, también su sueldo base (queda en el historial como «Recibo MM/AAAA»). En un SAC fija el SAC de la fila, no el sueldo base.",
            "Si ya tiene pagos, cambiar el {{Recibo}}, el {{Embargo}}, las {{Deudas}}, el {{Teléfono}} o los extras los reparte de nuevo entre libros y gestión ([[#registrar-pago-sueldo]]).",
            "Cambiar {{Sueldo}} o {{Recibo}} recalcula el {{Embargo}} si es un porcentaje. Escribir a mano {{Deudas}} o {{Embargo}} deja ese valor fijo para la fila.",
          ],
          errors: [
            {
              message:
                "Período cerrado: no se pueden modificar entries (period_id=…)",
              fix: "La planilla se cerró mientras la tenías abierta: actualizá la pantalla; para cambiarla hay que reabrirla ([[#reabrir-planilla]]).",
            },
            {
              message:
                "El período contable de este sueldo está cerrado: reabrilo para cargar el recibo",
              fix: "El cambio movería pagos ya hechos a libros o fuera de ellos en un mes contable cerrado. Reabrí el período en Contabilidad, cargá el cambio y volvé a cerrarlo.",
            },
            {
              message: "Sin permiso para editar la planilla.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: [
            "volver-valor-calculado-planilla",
            "cargar-extras-planilla",
            "cerrar-planilla",
          ],
          keywords: [
            "recibo",
            "neto del recibo",
            "viáticos",
            "teléfono",
            "editar sueldo del mes",
          ],
        },
        {
          id: "volver-valor-calculado-planilla",
          title: "Volver a las deudas o al embargo calculados",
          permission: "hr:write",
          prerequisites: [
            "La planilla en {{Borrador}} y una fila donde cargaste {{Deudas}} o {{Embargo}} a mano.",
          ],
          steps: [
            "En la celda {{Deudas}} o {{Embargo}} de la fila, hacé clic en la flecha circular de al lado del monto ({{Volver a la cuota de los planes}} o {{Volver al embargo vigente del empleado}}).",
          ],
          after: [
            "La celda vuelve a la cuota de los planes activos o al embargo vigente, y se sigue recalculando sola.",
          ],
          errors: [
            {
              message: "La fila ya no existe.",
              fix: "Actualizá la pantalla.",
            },
          ],
          related: ["editar-planilla", "cargar-plan-deuda", "cargar-embargo"],
        },
        {
          id: "cargar-extras-planilla",
          title: "Agregar o quitar extras de un empleado",
          summary:
            "Horas extra, premios u otros conceptos que suman al total del mes.",
          permission: "hr:write",
          prerequisites: ["La planilla tiene que estar en {{Borrador}}."],
          screens: [
            {
              kind: "dialog",
              title: "~Extras — Pérez, Juan",
              description: "Cada línea suma al campo Extras del mes.",
              table: {
                columns: ["~Descripción", "~Monto"],
                rows: [["~Premio por presentismo", "~$ 60.000,00"]],
              },
              fields: [
                {
                  label: "Descripción",
                  kind: "input",
                  value: "Horas extra",
                  marker: 2,
                },
                { label: "Monto", kind: "money", value: "45.000", marker: 2 },
              ],
              footer: [{ label: "Agregar", variant: "primary", marker: 3 }],
            },
          ],
          steps: [
            "En la fila del empleado, hacé clic en el monto de la columna {{Extras}} (o en «—» si no tiene).",
            "Escribí la {{Descripción}} y el {{Monto}}.",
            "Hacé clic en el botón {{Agregar}} (el +).",
            "Para quitar una línea, hacé clic en su papelera ({{Borrar}}).",
          ],
          after: [
            "La columna {{Extras}} y el {{Total}} de la fila se actualizan. Con la planilla cerrada, el diálogo solo muestra las líneas.",
          ],
          errors: [
            {
              message: "Monto inválido.",
              fix: "Cargá un monto mayor a cero.",
            },
            {
              message: "Descripción requerida.",
              fix: "Escribí qué es el extra.",
            },
            {
              message:
                "Período cerrado: no se pueden modificar extras (entry_id=…)",
              fix: "La planilla está cerrada: hay que reabrirla para cambiar extras.",
            },
            {
              message: "No se pudo eliminar el extra.",
              fix: "Actualizá la pantalla y probá de nuevo.",
            },
          ],
          related: ["agregar-extras-viajes", "editar-planilla"],
          keywords: ["horas extra", "premio", "bono", "presentismo"],
        },
        {
          id: "agregar-extras-viajes",
          title: "Agregar los extras sugeridos por viajes",
          summary:
            "Para los choferes: jornadas, km y descargas de los viajes completados del mes, por las tarifas de su ficha.",
          permission: "hr:write",
          prerequisites: [
            "Planilla mensual en {{Borrador}}.",
            "El empleado vinculado a un chofer (posición {{Chofer / Acompañante}}), con viajes completados en el mes y tarifas cargadas ([[#editar-tarifas-viajes]]).",
          ],
          steps: [
            "En la planilla del mes, hacé clic en {{Extras de viajes}}.",
            "Para cada chofer se ven los viajes, jornadas, km y descargas del mes y una línea sugerida por concepto. Con {{Ver viajes}} se despliega el detalle.",
            "Revisá el importe de cada línea, cambialo si hace falta y hacé clic en {{Agregar}}.",
          ],
          after: [
            "Cada línea agregada es un extra común de la fila, editable como cualquier otro; en el diálogo queda marcada {{Ya agregado}}.",
          ],
          errors: [
            {
              message: "Importe inválido.",
              fix: "Cargá un importe mayor a cero.",
            },
            {
              message: "No se pudieron leer los viajes del mes.",
              fix: "Cerrá y volvé a abrir el diálogo.",
            },
          ],
          related: ["editar-tarifas-viajes", "cargar-extras-planilla"],
          keywords: ["viajes", "km", "jornadas", "descargas", "extras chofer"],
        },
        {
          id: "agregar-empleados-faltantes",
          title: "Sumar a la planilla a los empleados que faltan",
          summary: "Para altas posteriores a generar la planilla.",
          permission: "hr:write",
          prerequisites: ["La planilla tiene que estar en {{Borrador}}."],
          steps: ["En la planilla, hacé clic en {{Agregar faltantes}}."],
          after: [
            "Se agrega una fila por cada empleado activo que no figuraba, con los mismos valores iniciales que al generar la planilla. El aviso dice cuántos se agregaron, o «No faltan empleados.».",
          ],
          errors: [
            {
              message:
                "El período está cerrado: reabrilo para agregar empleados.",
              fix: "Pedile a un owner o admin que reabra la planilla.",
            },
            {
              message: "Sin permisos para modificar liquidaciones.",
              fix: "Es para owner, admin y finanzas.",
            },
          ],
          related: ["generar-periodo-sueldos"],
          keywords: ["empleado nuevo en planilla", "falta un empleado"],
        },
        {
          id: "cerrar-planilla",
          title: "Cerrar la planilla",
          permission: "hr:write",
          steps: [
            "Revisá los montos y hacé clic en {{Cerrar período}}. Se cierra en el momento, sin pedir confirmación.",
          ],
          after: [
            "La planilla queda {{Cerrado}}: no se pueden cambiar montos, extras ni filas. Los pagos se siguen pudiendo registrar.",
            "Las {{Deudas}} de cada fila pasan a la cuenta corriente de cada empleado como {{Descuento de planilla}} y bajan lo que resta de sus planes.",
            "Si en una fila lo que se puede pagar a libros queda por debajo del recibo (las deudas y el teléfono superan a los extras y los viáticos), la diferencia se asienta como sueldo contra la deuda del empleado (Debe Sueldos y jornales / Haber Anticipos al personal), con origen «Planilla de sueldos».",
            "Solo un owner o un admin la puede reabrir.",
          ],
          errors: [
            {
              message: "El período ya estaba cerrado o no existe.",
              fix: "Actualizá la pantalla.",
            },
            {
              message:
                "El período contable de … está cerrado: reabrilo para cerrar la planilla",
              fix: "Hay que asentar la parte del recibo que salda deuda en un mes contable cerrado: reabrí el período en Contabilidad, cerrá la planilla y volvé a cerrarlo.",
            },
            {
              message: "Sin permiso para cerrar períodos.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["reabrir-planilla", "registrar-pago-sueldo"],
          keywords: ["cerrar sueldos", "cerrar mes", "bloquear planilla"],
        },
        {
          id: "reabrir-planilla",
          title: "Reabrir una planilla cerrada",
          permission: "hr:admin",
          prerequisites: ["Ser owner o admin."],
          steps: ["En la planilla cerrada, hacé clic en {{Reabrir}}."],
          after: [
            "Vuelve a {{Borrador}} y se puede editar. Los {{Descuento de planilla}} que el cierre había escrito en las cuentas corrientes se borran; se vuelven a escribir al cerrarla de nuevo. Los asientos de la parte del recibo que salda deuda se anulan.",
          ],
          errors: [
            {
              message:
                "Solo un owner o un admin pueden reabrir una liquidación cerrada.",
              fix: "Pedile la reapertura a un owner o admin.",
            },
            {
              message:
                "El período contable de … está cerrado: reabrilo para reabrir la planilla",
              fix: "Anularía asientos de un mes contable cerrado: reabrí primero el período en Contabilidad.",
            },
            {
              message: "El período ya estaba en borrador o no existe.",
              fix: "Actualizá la pantalla.",
            },
            {
              message: "Sin permiso para reabrir períodos.",
              fix: "Pedile la reapertura a un owner o admin.",
            },
          ],
          related: ["cerrar-planilla"],
          keywords: ["reabrir sueldos", "desbloquear planilla"],
        },
        {
          id: "registrar-pago-sueldo",
          title: "Registrar un pago de sueldo a un empleado",
          summary:
            "Se puede pagar en partes (transferencia y efectivo), con la planilla abierta o cerrada.",
          permission: ["hr:write", "transactions:write"],
          prerequisites: [
            "Una caja o banco activo en pesos.",
            "Mueve plata de Tesorería: hace falta además permiso para cargar movimientos de caja, y poder ver las cuentas para elegir una. Sin el permiso de caja, el diálogo solo muestra los pagos hechos y explica por qué.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Pagos — Pérez, Juan",
              description:
                "~Total $ 860.000,00 · Pagado $ 0,00 · Saldo $ 860.000,00",
              fields: [
                {
                  label: "Cuenta",
                  kind: "select",
                  value: "Banco Galicia",
                  marker: 2,
                },
                {
                  label: "Método",
                  kind: "select",
                  value: "Transferencia",
                  marker: 2,
                },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
                { label: "Monto", kind: "money", value: "530.000", marker: 2 },
                { label: "Notas", kind: "input" },
              ],
              footer: [
                { label: "Registrar pago", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En la fila del empleado, hacé clic en el monto de la columna {{Saldo}}. Se abre la lista de pagos ya hechos y el formulario.",
            "Elegí {{Cuenta}} (solo cajas y bancos activos en pesos), {{Método}} ({{Transferencia}} o {{Efectivo}}) y {{Fecha}}. El {{Monto}} viene con el saldo pendiente: cambialo si pagás una parte. Opcional: {{Notas}}. El canal no se elige: el neto del recibo (menos embargo) va a libros y el resto a gestión ([[#planilla-sueldos]]).",
            "Si el monto supera el saldo, aparece {{Pagar más que el saldo}}: tildalo solo si es un adelanto o un pago a cuenta del mes siguiente.",
            "Hacé clic en {{Registrar pago}}.",
          ],
          after: [
            "El pago queda en la lista y la fila actualiza {{Pagado}} y {{Saldo}}. Debajo dice si fue a {{Libros}}, a {{Gestión}} o, si cruzó la parte del recibo, cuánto a cada uno.",
            "Se crea un egreso en pesos en la cuenta elegida; la parte de libros, con su asiento en Sueldos y jornales (ver «Los pagos y la contabilidad» arriba).",
          ],
          errors: [
            {
              message:
                'El pago supera el saldo pendiente (…). Si es correcto, marcá "Pagar más que el saldo".',
              fix: "Bajá el monto o tildá {{Pagar más que el saldo}}.",
            },
            {
              message:
                "Los sueldos se pagan desde una cuenta en pesos (la cuenta elegida es en …).",
              fix: "Elegí una caja o banco en pesos.",
            },
            {
              message: "La cuenta elegida está inactiva.",
              fix: "Elegí otra cuenta o activala en Tesorería.",
            },
            {
              message: "Los sueldos no se pagan desde una cartera de cheques.",
              fix: "Elegí una caja o un banco.",
            },
            {
              message:
                "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.",
              fix: "Usá una fecha de un mes contable abierto o pedí reabrir el período (ver [[#periodos-cerrados]]).",
            },
            {
              message: "Monto inválido.",
              fix: "Cargá un monto mayor a cero.",
            },
            {
              message: "Falta la cuenta.",
              fix: "Elegí la cuenta.",
            },
            {
              message:
                "El período contable de este sueldo está cerrado: reabrilo para cargar el recibo",
              fix: "El pago iría a libros en un mes contable cerrado. Reabrí el período en Contabilidad o cargá el pago después de reabrirlo.",
            },
            {
              message:
                "La cuenta del pago está inactiva: activala para que el sistema reparta el pago entre libros y gestión",
              fix: "Activá la cuenta en Tesorería o borrá el pago y cargalo desde otra cuenta.",
            },
            {
              message: "Sin permiso para registrar pagos.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja.",
            },
          ],
          related: [
            "editar-pago-sueldo",
            "borrar-pago-sueldo",
            "pago-masivo-sueldos",
          ],
          keywords: [
            "pagar sueldo",
            "transferencia de sueldo",
            "efectivo",
            "pago parcial",
          ],
        },
        {
          id: "editar-pago-sueldo",
          title: "Corregir un pago de sueldo",
          permission: ["hr:write", "transactions:write"],
          steps: [
            "En la fila del empleado, hacé clic en el {{Saldo}}.",
            "En la lista de pagos, hacé clic en el lápiz del pago ({{Editar pago}}): el formulario se carga con sus datos.",
            "Cambiá lo que necesites y hacé clic en {{Guardar cambios}} (o {{Cancelar}} para dejarlo como estaba). Un pago partido en libros y gestión se edita entero: el {{Monto}} es la suma de las dos partes.",
            "Si el pago está conciliado con el extracto, el {{Monto}} no se puede cambiar («Conciliado: desconciliá para cambiar el monto»); las notas y el método sí.",
          ],
          after: [
            "Los movimientos de caja del pago se actualizan (cuenta, monto y fecha) con sus asientos, y el sistema vuelve a repartirlo entre libros y gestión.",
          ],
          errors: [
            {
              message:
                'El pago supera el saldo pendiente (…). Si es correcto, marcá "Pagar más que el saldo".',
              fix: "Bajá el monto o tildá {{Pagar más que el saldo}}.",
            },
            {
              message: "El pago ya no existe.",
              fix: "Actualizá la pantalla.",
            },
            {
              message: "Editá el pago completo, no su parte interna.",
              fix: "Abrí el pago desde la lista: se edita entero.",
            },
            {
              message:
                "El pago está conciliado: desconciliá su línea en la pestaña «Extracto» de su cuenta para cambiar el monto",
              fix: "Desconciliá la línea en la pestaña {{Extracto}} de la cuenta ([[/accounts]]), corregí el monto y volvé a conciliar.",
            },
            {
              message:
                "El pago de sueldo está conciliado de una forma que el reparto automático no puede mantener: desconciliá su línea en la pestaña «Extracto» de su cuenta, cargá el cambio y volvé a conciliar",
              fix: "El pago está conciliado con varias líneas del extracto o solo una de sus partes lo está. Desconciliá, cargá el cambio y volvé a conciliar.",
            },
            {
              message:
                "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.",
              fix: "El pago o la fecha nueva caen en un mes contable cerrado: pedí reabrirlo.",
            },
            {
              message: "Sin permiso para editar pagos.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja.",
            },
          ],
          related: ["registrar-pago-sueldo", "borrar-pago-sueldo"],
        },
        {
          id: "borrar-pago-sueldo",
          title: "Borrar un pago de sueldo",
          permission: ["hr:write", "transactions:write"],
          steps: [
            "En la fila del empleado, hacé clic en el {{Saldo}}.",
            "Hacé clic en la papelera del pago ({{Borrar pago}}). Se borra sin pedir confirmación.",
          ],
          after: [
            "Se borran también sus movimientos de caja (los dos, si estaba partido en libros y gestión) y su asiento; el {{Saldo}} de la fila vuelve a subir y los demás pagos se reparten de nuevo.",
          ],
          errors: [
            {
              message:
                "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.",
              fix: "El pago es de un mes contable cerrado: pedí reabrirlo.",
            },
            {
              message: "Sin permiso para borrar pagos.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja.",
            },
            {
              message: "No se pudo borrar el pago.",
              fix: "Actualizá la pantalla y probá de nuevo.",
            },
          ],
          related: ["registrar-pago-sueldo"],
        },
        {
          id: "pago-masivo-sueldos",
          title: "Pagar los sueldos de varios empleados a la vez",
          summary:
            "Un pago por empleado, cada uno con su monto, desde una misma cuenta y con el mismo método.",
          permission: ["hr:write", "transactions:write"],
          prerequisites: [
            "Una caja o banco activo en pesos; permiso para cargar movimientos de caja y para ver las cuentas.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Pago masivo de sueldos",
              description:
                "Un pago por empleado, cada uno con su monto. Con el neto del recibo cargado se sugiere la transferencia (recibo − embargo − descuentos) o el efectivo (el resto); sin recibo, el saldo. Canal automático: el neto del recibo (menos embargo) va a libros; el resto, a gestión.",
              fields: [
                {
                  label: "Método",
                  kind: "select",
                  value: "Transferencia",
                  marker: 2,
                },
                {
                  label: "Fecha",
                  kind: "date",
                  value: "05/11/2026",
                  marker: 2,
                },
              ],
              table: {
                columns: ["Empleados", "Saldo", "~Monto"],
                rows: [
                  ["~☑ Pérez, Juan", "~$ 860.000", "~530.000"],
                  ["~☑ Gómez, Ana", "~$ 800.000", "~800.000"],
                ],
                marker: 3,
              },
              footer: [
                { label: "Cancelar" },
                { label: "~Registrar 2 pagos", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En la planilla, hacé clic en {{Pago masivo}}.",
            "Elegí el {{Método}} y la {{Fecha}}. Al cambiar el método se vuelven a sugerir los montos: con transferencia, la parte de transferencia pendiente de cada uno; con efectivo, la de efectivo; sin recibo, el saldo.",
            "En la lista de {{Empleados}}, tildá o destildá a cada uno (la casilla de arriba elige a todos) y corregí el monto si hace falta.",
            "Elegí la {{Cuenta en pesos}} y, opcional, {{Notas (opcional)}}. El canal lo asigna el sistema a cada pago. Abajo se ven la cantidad de empleados y el total. Si alguno quedaría con saldo negativo, aparece {{Pagar más que el saldo}} para confirmarlo.",
            "Hacé clic en **Registrar N pagos**. Se habilita con al menos un empleado tildado y un monto mayor a cero en cada uno (abajo dice cuántos quedan «sin monto válido»).",
          ],
          after: [
            "Se registra un pago por empleado, cada uno con su movimiento de caja y su asiento. Si uno falla, no se registra ninguno.",
          ],
          errors: [
            {
              message:
                '… empleado(s) quedarían con saldo negativo. Bajá el monto, sacalos de la selección o marcá "Pagar más que el saldo".',
              fix: "Bajá los montos, destildá a esos empleados o tildá {{Pagar más que el saldo}}.",
            },
            {
              message:
                "El período contable de esa fecha está cerrado. Reabrilo en Contabilidad o usá otra fecha.",
              fix: "Usá una fecha de un mes contable abierto.",
            },
            {
              message: "Sin permiso para registrar pagos.",
              fix: "Hace falta permiso de escritura en Personal y en movimientos de caja.",
            },
            {
              message: "No se pudo registrar el pago masivo.",
              fix: "No se registró ningún pago: probá de nuevo.",
            },
          ],
          related: ["registrar-pago-sueldo"],
          keywords: [
            "pago masivo",
            "pagar a todos",
            "transferencias de sueldos",
            "lote de pagos",
          ],
        },
      ],
    },

    // ── Vacaciones ───────────────────────────────────────────────────────
    {
      id: "vacaciones",
      title: "Vacaciones",
      menuPath: "Personal › Vacaciones",
      routes: ["/hr/vacations"],
      permission: "hr:read",
      intro: [
        "Los días de vacaciones de cada empleado activo para el período en curso y lo que le queda de años anteriores. Columnas: {{Empleado}}, {{Ingreso}}, {{Período en curso}}, {{Arrastre}}, {{Años anteriores}}, {{Tomados}}, {{Disponibles}} y {{Vence}}. Con {{Buscar empleado}} se filtra por nombre.",
        "Las vacaciones tomadas se registran como licencia desde la ficha del empleado ([[#registrar-licencia]]). En la ficha, {{Vacaciones y licencias}} muestra también cada saldo por período: {{Otorgados}}, {{Bonus}}, {{Arrastre}}, {{Usados}}, {{Saldo}}, {{Expira}} y {{Estado}}.",
      ],
      concepts: [
        {
          title: "El período de vacaciones (LCT)",
          body: [
            "Cada período se otorga solo el 1 de octubre y se toma del 1/10 al 30/4 del año siguiente. Los días dependen de la antigüedad al 31 de diciembre: menos de 5 años, 14 días; menos de 10, 21; menos de 20, 28; 20 o más, 35 (LCT art. 150).",
            "Si el empleado trabajó menos de la mitad de los días hábiles del año, le corresponde un día cada 20 trabajados (art. 153). Solo las ausencias injustificadas de [[#asistencia]] cuentan como no trabajadas.",
            "Si el sistema tiene habilitado el arrastre, el período nuevo suma hasta un tercio de los días que quedaban del anterior (art. 164) y el anterior se cierra.",
            "Estados de un saldo: {{Activo}}; {{Extendido}} (días de años anteriores que siguen disponibles después del 30/4); {{Expirado}}.",
            "Una licencia de tipo {{Vacaciones}} descuenta primero de los períodos más viejos. Si toma más días de los disponibles, el exceso queda en el período más nuevo con saldo negativo.",
            "{{Período en curso}} vacío: todavía no se otorgó o hay que cargarlo a mano ([[#cargar-saldo-vacaciones]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "cargar-saldo-vacaciones",
          title: "Cargar a mano los días de vacaciones de un empleado",
          summary:
            "Para cargar los días de antes de usar el sistema, o corregir los del período en curso.",
          permission: "hr:admin",
          prerequisites: ["Ser owner o admin."],
          screens: [
            {
              kind: "dialog",
              title: "~Vacaciones — Pérez, Juan",
              description:
                "Los días ya tomados y cargados como licencia se descuentan solos.",
              fields: [
                {
                  label: "~Días del período en curso (2026-2027)",
                  kind: "input",
                  value: "21",
                  marker: 2,
                },
                {
                  label: "Días pendientes de años anteriores",
                  kind: "input",
                  value: "4",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Guardar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/hr/vacations]], hacé clic en {{Cargar}} en la fila del empleado. (En la ficha del empleado es {{Cargar saldo}}, en {{Vacaciones y licencias}}.)",
            "Revisá los {{Días del período en curso}} (vienen los cargados o, si no hay, los que le corresponden por antigüedad) y los {{Días pendientes de años anteriores}}. Son números enteros de 0 a 365.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "El período en curso queda con esos días; los días ya tomados con licencias se siguen descontando.",
            "Los días de años anteriores quedan en el período anterior como {{Extendido}}, disponibles después del 30/4, y se usan primero. Si cargás 0, ese período queda sin días pendientes (si estaba {{Extendido}}, pasa a {{Expirado}}).",
          ],
          errors: [
            {
              message: "Ingresá cantidades de días enteras, de 0 a 365.",
              fix: "Cargá números enteros sin decimales.",
            },
            {
              message:
                "El período … ya tiene más días tomados o asignados que los que querés cargar.",
              fix: "Cargá al menos los días ya tomados de ese período.",
            },
            {
              message:
                "Solo el dueño o un administrador pueden cargar saldos de vacaciones.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message: "No se pudo guardar el saldo de vacaciones.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["registrar-licencia", "crear-empleado"],
          keywords: [
            "saldo de vacaciones",
            "días de vacaciones",
            "cargar vacaciones",
            "vacaciones pendientes",
          ],
        },
        {
          id: "registrar-licencia",
          title: "Registrar una licencia o vacaciones tomadas",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              caption: "Ficha del empleado › Vacaciones y licencias",
              title: "Nueva licencia",
              description:
                "Días corridos (incluye fines de semana). Si es de tipo vacaciones, descuenta del saldo activo (FIFO).",
              fields: [
                {
                  label: "Desde",
                  kind: "date",
                  value: "05/01/2027",
                  marker: 2,
                },
                {
                  label: "Hasta",
                  kind: "date",
                  value: "18/01/2027",
                  marker: 2,
                },
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Vacaciones",
                  marker: 2,
                },
                { label: "Notas", kind: "textarea" },
              ],
              footer: [{ label: "Registrar", variant: "primary", marker: 3 }],
            },
          ],
          steps: [
            "En la ficha del empleado, en {{Vacaciones y licencias}}, bajá hasta {{Nueva licencia}}.",
            "Elegí {{Desde}} y {{Hasta}} (días corridos, incluye fines de semana) y el {{Tipo}}: {{Vacaciones}}, {{Enfermedad}}, {{Franco}}, {{Maternidad}}, {{Paternidad}} u {{Otro}}. Opcional: {{Notas}}.",
            "Si es de tipo {{Vacaciones}}, revisá los avisos que aparecen arriba de {{Registrar}}: si no empieza un lunes (o el día hábil siguiente cuando el lunes es feriado, LCT art. 151) o si los días superan los pendientes del empleado. Son avisos: se puede registrar igual.",
            "Hacé clic en {{Registrar}}.",
          ],
          after: [
            "La licencia aparece en {{Licencias}} con sus días.",
            "Si es de tipo {{Vacaciones}}, descuenta del saldo empezando por el período más viejo.",
            "En [[#asistencia]] cada día queda marcado como {{Licencia}} (salvo los días que ya tenían otra marca).",
          ],
          errors: [
            {
              message: "La fecha de fin no puede ser anterior al inicio.",
              fix: "Corregí las fechas.",
            },
            {
              message: "Sin permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["borrar-licencia", "cargar-saldo-vacaciones"],
          keywords: [
            "licencia",
            "vacaciones",
            "enfermedad",
            "franco",
            "maternidad",
            "paternidad",
          ],
        },
        {
          id: "borrar-licencia",
          title: "Borrar una licencia",
          permission: "hr:write",
          steps: [
            "En la ficha del empleado, en {{Licencias}}, hacé clic en la papelera de la fila ({{Borrar}}). Se borra sin pedir confirmación.",
          ],
          after: [
            "Si era de vacaciones, los días vuelven al saldo. Las marcas {{Licencia}} que había puesto en asistencia se borran.",
          ],
          errors: [
            {
              message: "Sin permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
          ],
          related: ["registrar-licencia"],
        },
      ],
    },

    // ── Asistencia ───────────────────────────────────────────────────────
    {
      id: "asistencia",
      title: "Asistencia",
      menuPath: "Personal › Asistencia",
      routes: ["/hr/attendance", "/hr/attendance/[year]/[month]"],
      permission: "hr:read",
      intro: [
        "Una grilla por mes: una fila por empleado activo y una columna por día. Al entrar desde el menú abre el mes actual; las flechas de arriba a la derecha pasan al mes anterior o al siguiente.",
        "Celdas vacías = trabajó. Los fines de semana y feriados se ven sombreados, y los feriados del mes se listan arriba. Cada excepción muestra un código: `AJ` {{Ausente (justif.)}}, `AI` {{Ausente (injustif.)}}, `Ta` {{Tarde}}, `ET` {{Salida temprana}}, `Ef` {{Enfermedad}}, `Li` {{Licencia}}, `Fe` {{Feriado}}. Pasá el mouse por una celda para ver el detalle.",
        "Las licencias cargadas en la ficha del empleado marcan sus días solas; esas celdas no se editan desde acá.",
      ],
      tasks: [
        {
          id: "registrar-excepcion-asistencia",
          title: "Registrar una ausencia, tardanza o salida temprana",
          permission: "hr:write",
          screens: [
            {
              kind: "dialog",
              title: "~Pérez, Juan",
              description: "~2026-11-04",
              fields: [
                {
                  label: "Tipo",
                  kind: "select",
                  value: "Ausente (injustif.)",
                  marker: 2,
                },
                {
                  label: "Horas perdidas (opcional)",
                  kind: "input",
                  value: "8",
                  marker: 2,
                },
                { label: "Notas", kind: "textarea" },
              ],
              footer: [
                { label: "Cancelar" },
                { label: "Registrar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/hr/attendance]], hacé clic en la celda del empleado y el día.",
            "Elegí el {{Tipo}}: {{Ausente (justif.)}}, {{Ausente (injustif.)}}, {{Tarde}}, {{Salida temprana}} o {{Enfermedad}} ({{Licencia}} y {{Feriado}} no se eligen a mano). Opcional: {{Horas perdidas (opcional)}} (hasta 24, acepta decimales) y {{Notas}}.",
            "Hacé clic en {{Registrar}} (o {{Guardar}} si la celda ya tenía una excepción).",
          ],
          after: [
            "La celda muestra el código del tipo. Un día tiene una sola marca: guardar sobre una cargada a mano la reemplaza; un día que viene de una licencia o un feriado no se reemplaza desde acá.",
            "Las ausencias injustificadas cuentan como días no trabajados para calcular las vacaciones (ver [[#vacaciones]]).",
          ],
          errors: [
            {
              message: "Sin permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message:
                "Ese día lo carga una licencia o un feriado: cambialo desde su origen, no desde la asistencia.",
              fix: "Cambiá o borrá la licencia ([[#borrar-licencia]]) y después cargá la excepción.",
            },
          ],
          related: ["borrar-excepcion-asistencia", "registrar-licencia"],
          keywords: [
            "ausencia",
            "falta",
            "llegada tarde",
            "presentismo",
            "parte de enfermo",
          ],
        },
        {
          id: "borrar-excepcion-asistencia",
          title: "Borrar una excepción de asistencia",
          permission: "hr:write",
          prerequisites: [
            "Solo las excepciones cargadas a mano. Las que vienen de una licencia («auto desde licencia») o de un feriado se cambian desde su origen.",
          ],
          steps: [
            "En [[/hr/attendance]], hacé clic en la celda con la excepción.",
            "Hacé clic en {{Borrar}}.",
          ],
          after: ["La celda vuelve a quedar vacía (trabajó)."],
          errors: [
            {
              message: "Sin permiso.",
              fix: "Pedíselo a alguien con permiso de escritura en Personal.",
            },
            {
              message:
                "No se borró: el día ya no está o lo carga una licencia o un feriado.",
              fix: "Recargá la página: si el día viene de una licencia, borrala desde la licencia ([[#borrar-licencia]]).",
            },
          ],
          related: ["registrar-excepcion-asistencia", "borrar-licencia"],
        },
      ],
    },

    // ── Vencimientos de documentos ───────────────────────────────────────
    {
      id: "vencimientos-personal",
      title: "Vencimientos de documentos del personal",
      menuPath: "Personal › Vencimientos",
      routes: ["/hr/document-expirations"],
      permission: "hr:read",
      intro: [
        "Los documentos de empleados activos que vencen entre hoy y los próximos 30 días. Columnas: {{Empleado}}, {{Documento}}, {{Número}}, {{Vencimiento}}, {{Días restantes}} ({{Vence hoy}} o los días que faltan) y un enlace a la ficha del empleado.",
        "Un documento que ya venció sale de esta lista: se ve como {{Vencido}} en la ficha del empleado.",
        "Cada mañana a las 8 el sistema manda un aviso dentro de la app a los usuarios con acceso a Personal por cada documento en esta lista; un mismo documento se vuelve a avisar recién a los 7 días.",
        "Los documentos se cargan y renuevan desde la ficha del empleado ([[#cargar-documento-empleado]]).",
      ],
      tasks: [
        {
          id: "filtrar-vencimientos-personal",
          title: "Buscar vencimientos por empleado o tipo de documento",
          permission: "hr:read",
          steps: [
            "En [[/hr/document-expirations]], escribí en {{Buscar empleado…}} para filtrar por nombre.",
            "En el selector de tipo, elegí un documento (por ejemplo {{Licencia de conducir}}) o {{Todos los tipos}}.",
            "A la derecha se ve cuántos quedan de cuántos. Para renovar uno, abrí la ficha con el ícono de la fila ({{Ver empleado}}) y seguí [[#editar-documento-empleado]].",
          ],
          keywords: [
            "vencimientos",
            "carnet vencido",
            "documentos por vencer",
            "alertas",
          ],
          related: ["editar-documento-empleado"],
        },
      ],
    },
  ],
};
