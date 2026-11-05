import type { GuidePage } from "../types";

// Platform chapter: entering the app and moving around it, the dashboard,
// Tareas, Archivos, the team chat, the profile and the notifications bell.

export const platformPage: GuidePage = {
  file: "plataforma.html",
  title: "Plataforma",
  lead: "Lo que usa todo el equipo todos los días: entrar al sistema, el dashboard, las tareas, los archivos, el chat, tu perfil y las notificaciones.",
  sections: [
    {
      id: "entrar-y-moverse",
      title: "Entrar y moverse por el sistema",
      routes: [],
      permission: null,
      intro: [
        "El sistema se abre en `/auth/login` y, una vez que entraste, en el dashboard. A la izquierda está la barra lateral con los módulos; arriba, el encabezado con la ruta de la pantalla, el botón **?** de ayuda y la campanita de notificaciones.",
      ],
      concepts: [
        {
          title: "La barra lateral",
          body: [
            "Arriba de todo está el botón {{Asistente}} (ver [[/ai]]). Debajo, las secciones: {{Plataforma}}, {{Inteligencia}}, {{Ventas}}, {{Otras ventas}}, {{Compras}}, {{Otras compras}}, {{Tesorería}}, {{Contabilidad}}, {{Flota}}, {{Depósito}}, {{Personal}} y {{Admin}}. Cada sección se abre y se cierra con un clic en su nombre; la sección de la pantalla actual aparece abierta.",
            "Solo ves los módulos que tu usuario puede leer: si falta uno, es porque tu rol no lo trae o el owner te lo quitó (ver [[#roles-y-permisos]]).",
            "{{Ventas}} y {{Otras ventas}} (y lo mismo {{Compras}} y {{Otras compras}}) abren las mismas pantallas, una del lado fiscal y otra del interno: ver [[#canales-fiscal-interno]].",
            "El ítem {{Chat}} muestra un número con los mensajes sin leer.",
            "Debajo de las secciones, el bloque {{Guía}} resume la pantalla en la que estás, con el link {{Ver los pasos en la guía}}, y muestra la lista {{Puesta en marcha}} cuando hay pasos de arranque. Se abre y se cierra con un clic y el sistema recuerda cómo lo dejaste.",
            "En el pie: {{Guía de uso}} (esta guía), {{Tema}} y tu usuario, con {{Perfil}} y {{Cerrar sesión}}.",
          ],
        },
        {
          title: "El encabezado",
          body: [
            "Muestra la sección y la pantalla donde estás (en el celular, solo la pantalla). El botón del extremo izquierdo esconde o muestra la barra lateral.",
            "A la derecha, el botón **?** ({{Ayuda de esta pantalla}}) abre la sección de esta guía que explica la pantalla, y la campanita abre tus notificaciones (ver [[#notificaciones]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "iniciar-sesion",
          title: "Entrar al sistema",
          permission: null,
          prerequisites: [
            "Un usuario invitado por el owner o un admin en [[/admin/users]], con la cuenta activada desde el mail de invitación.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "/auth/login",
              title: "Logística y Transporte Jouve",
              description: "Ingresá para continuar",
              fields: [
                {
                  label: "Email",
                  kind: "input",
                  value: "ana@jouve.com.ar",
                  marker: 1,
                },
                { label: "Contraseña", kind: "input", marker: 2 },
              ],
              footer: [{ label: "Ingresar", variant: "primary", marker: 3 }],
            },
          ],
          steps: [
            "Abrí el sistema: si no tenés sesión te lleva a la pantalla de ingreso. En {{Email}}, escribí tu email.",
            "En {{Contraseña}}, escribí tu contraseña.",
            "Hacé clic en {{Ingresar}}.",
          ],
          after: [
            "Entrás al dashboard. Si llegaste desde un link a otra pantalla, el sistema te lleva a esa pantalla.",
          ],
          errors: [
            {
              message: "Credenciales inválidas.",
              fix: "Revisá el email y la contraseña. Si no la recordás, avisale a un owner o admin: la pantalla de ingreso no tiene opción para recuperarla.",
            },
            {
              message: "Email o contraseña inválidos.",
              fix: "El email no tiene un formato válido o falta la contraseña: completalos y volvé a probar.",
            },
          ],
          related: ["cerrar-sesion"],
          keywords: ["login", "ingresar", "contraseña", "acceso"],
        },
        {
          id: "cerrar-sesion",
          title: "Salir del sistema",
          permission: null,
          screens: [
            {
              kind: "menu",
              caption: "Pie de la barra lateral",
              trigger: "~Ana López",
              items: [
                { label: "Perfil" },
                { label: "Cerrar sesión", marker: 2 },
              ],
            },
          ],
          steps: [
            "En el pie de la barra lateral, hacé clic en tu nombre.",
            "Elegí {{Cerrar sesión}}.",
          ],
          after: ["Volvés a la pantalla de ingreso."],
          keywords: ["logout", "salir", "desconectar"],
        },
        {
          id: "cambiar-tema",
          title: "Cambiar el tema (claro u oscuro)",
          permission: null,
          screens: [
            {
              kind: "menu",
              trigger: "Tema",
              items: [
                { label: "Claro", marker: 2 },
                { label: "Oscuro", marker: 2 },
                { label: "Sistema", marker: 2 },
              ],
            },
          ],
          steps: [
            "En el pie de la barra lateral, hacé clic en {{Tema}}.",
            {
              text: "Elegí una opción:",
              substeps: [
                "{{Claro}}: fondo claro.",
                "{{Oscuro}}: fondo oscuro.",
                "{{Sistema}}: sigue la configuración de tu computadora o celular.",
              ],
            },
          ],
          after: ["El cambio se aplica al instante y queda en ese navegador."],
          keywords: ["modo oscuro", "dark", "colores"],
        },
        {
          id: "usar-en-el-celular",
          title: "Usar el sistema desde el celular",
          permission: null,
          steps: [
            "En el celular, abajo de la pantalla aparece una barra con los accesos de tu rol. Por ejemplo, Finanzas, Admin y Owner ven {{Inicio}}, {{Caja}}, {{Recibos}} e {{IA}}; Operaciones ve {{Inicio}}, {{Viajes}}, {{Cargas}} y {{Chat}}; Depósito ve {{Inicio}}, {{Pallets}}, {{Depósitos}} y {{Chat}}; el contador externo ve {{Inicio}}, {{Ventas}} y {{Compras}}.",
            "Para el resto de los módulos, tocá {{Más}}: se abre la barra lateral completa.",
          ],
          after: [
            "Cada acceso de la barra aparece solo si tu usuario tiene el permiso de ese módulo.",
          ],
          keywords: ["celular", "móvil", "teléfono", "menú"],
        },
      ],
    },
    {
      id: "notificaciones",
      title: "Notificaciones",
      routes: [],
      permission: null,
      intro: [
        "La campanita del encabezado junta los avisos para vos: mensajes de chat, respuestas, menciones, tareas que vencen y tareas de IA terminadas. El número sobre la campanita son las que no leíste.",
      ],
      concepts: [
        {
          title: "Qué te avisa el sistema",
          body: [
            "**Chat**: un mensaje nuevo, una respuesta a un mensaje tuyo o una mención con @. Las podés apagar por tipo en tu perfil ([[#preferencias-notificaciones]]) y por conversación con {{Silenciar}} ([[#silenciar-chat]]).",
            "**Tareas**: el día que vence una tarea tuya («tarea que vence hoy») y una vez en la semana siguiente si sigue abierta («tarea vencida»). Ver [[#tareas]].",
            "**Tareas de IA**: cuando una tarea programada del asistente termina («tarea de IA lista»). Ver [[/ai/tasks]].",
            "**Documentos por vencer** de la flota o del personal.",
          ],
        },
        {
          title: "Avisos del navegador",
          body: [
            "La primera vez que abrís la campanita, el navegador te pregunta si permitís notificaciones. Si aceptás, cuando llega un aviso con el sistema abierto pero su pestaña no está a la vista, aparece un aviso del sistema operativo; al hacer clic en uno de chat se abre esa conversación.",
            "Para recibir los avisos de chat aun con el sistema cerrado, activá el push en tu perfil ([[#activar-push]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "ver-notificaciones",
          title: "Ver y marcar las notificaciones",
          permission: null,
          steps: [
            "En el encabezado, hacé clic en la campanita ({{Notificaciones}}).",
            "Hacé clic en una notificación: queda leída y te lleva a lo que avisa (la conversación, la tarea o la tarea de IA).",
            "Para marcar todas como leídas, hacé clic en {{Marcar todas}}.",
          ],
          after: [
            "Las no leídas se ven resaltadas y con un punto a la derecha. La lista se actualiza sola cuando llega una nueva.",
          ],
          keywords: ["campanita", "avisos", "alertas", "no leídas"],
        },
      ],
    },
    {
      id: "dashboard",
      title: "Dashboard",
      menuPath: "Plataforma › Dashboard",
      routes: ["/dashboard"],
      permission: null,
      intro: [
        "La pantalla de inicio. Arriba, los accesos rápidos de tu rol ({{Facturar}}, {{Cobrar}}, {{Pagar}}, {{Escanear documento}}, {{Viajes}}, {{Pallets}}, {{Asistente IA}}: cada uno aparece solo si tenés su permiso).",
        "Debajo, el bloque {{Hoy y esta semana}}, fijo: {{Vencimientos}} (las tareas abiertas del equipo vencidas o que vencen en los próximos 7 días; un clic abre la tarea), {{Viajes de hoy}} y {{Papeles por vencer}} (documentos de camiones, choferes y empleados vencidos o que vencen en 30 días). Cada recuadro aparece si podés ver su módulo.",
        "Después, las tarjetas (widgets) que cada usuario elige y ordena: {{Indicadores financieros}} ({{Caja ARS}}, {{Caja USD}}, {{Por cobrar}}, {{Por pagar}}), {{Operaciones}} (viajes en curso, cargas pendientes, pallets en depósito), {{Flujo de caja}}, {{Insights IA}}, {{Próximos vencimientos}} (cobros, pagos y documentos de los próximos 14 días) y {{Top deudores}}. Solo aparecen las tarjetas cuyos datos podés ver.",
        "Si no tenés ninguna tarjeta disponible, el dashboard muestra los accesos rápidos y te indica usar el menú lateral.",
      ],
      concepts: [
        {
          title: "El dashboard de cada rol",
          body: [
            "Hasta que lo personalizás, el dashboard usa la plantilla de tu rol principal: Owner, Admin y Finanzas ven primero los indicadores financieros y el flujo de caja; Operaciones, la operación, los vencimientos y los insights; Depósito, la operación y los vencimientos; Chofer, la operación. El contador externo no tiene tarjetas.",
            "Lo que personalizás es solo tuyo: no cambia el dashboard de nadie más.",
          ],
        },
        {
          title: "Insights IA",
          body: [
            "La tarjeta {{Insights IA}} muestra el resumen semanal del asistente (los lunes) y las alertas que el analista encontró en los datos (caja, cobranzas, documentos, flota…), primero las más graves. Cada alerta trae {{Resolver con IA}}; algunas traen además un botón con una acción lista, y owner y admin ven también {{Visto}} e {{Ignorar}}.",
          ],
        },
      ],
      tasks: [
        {
          id: "personalizar-dashboard",
          title: "Personalizar el dashboard",
          summary:
            "Agregar, quitar, ordenar y cambiar el tamaño de las tarjetas.",
          permission: null,
          screens: [
            {
              kind: "page",
              caption: "Dashboard en modo edición",
              title: "Dashboard",
              actions: [
                { label: "Restablecer", variant: "ghost" },
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/dashboard]], hacé clic en el lápiz de la derecha ({{Personalizar}}).",
            {
              text: "Cambiá lo que quieras:",
              substeps: [
                "Para agregar una tarjeta que no está, hacé clic en su nombre en el recuadro {{Agregar:}}.",
                "Para reordenar, arrastrá la tarjeta desde su manija. En el celular, usá las flechas de subir y bajar.",
                "Para cambiar el tamaño (media fila o fila completa), usá el botón de tamaño de la tarjeta (en pantallas grandes).",
                "Para quitar una tarjeta, hacé clic en la X de la tarjeta.",
              ],
            },
            "Si te arrepentís, {{Cancelar}} vuelve a como estaba.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "Aparece «Dashboard guardado.» y el dashboard queda así cada vez que entrás, en cualquier dispositivo.",
          ],
          errors: [
            {
              message: "No se pudo guardar el layout.",
              fix: "Volvé a hacer clic en Guardar; si sigue, recargá la página y probá de nuevo.",
            },
          ],
          related: ["restablecer-dashboard"],
          keywords: ["widgets", "tarjetas", "inicio", "ordenar", "configurar"],
        },
        {
          id: "restablecer-dashboard",
          title: "Volver al dashboard de tu rol",
          permission: null,
          steps: [
            "En [[/dashboard]], hacé clic en el lápiz ({{Personalizar}}).",
            "Hacé clic en {{Restablecer}}.",
          ],
          after: [
            "Aparece «Dashboard restablecido al layout de tu rol.»: se borra tu personalización y vuelve la plantilla de tu rol.",
          ],
          errors: [
            {
              message: "No se pudo restablecer el layout.",
              fix: "Probá de nuevo en unos segundos.",
            },
          ],
          related: ["personalizar-dashboard"],
          keywords: ["resetear", "por defecto", "original"],
        },
        {
          id: "resolver-insight-con-ia",
          title: "Resolver una alerta con el asistente",
          permission: "ai:chat",
          prerequisites: [
            "La tarjeta {{Insights IA}} en tu dashboard (necesita el permiso `ai:read`).",
          ],
          steps: [
            "En la tarjeta {{Insights IA}}, buscá la alerta.",
            "Hacé clic en {{Resolver con IA}}.",
          ],
          after: [
            "Se abre el asistente ([[/ai]]) con una conversación nueva que ya pregunta por esa alerta.",
          ],
          related: ["preguntar-al-asistente"],
          keywords: ["insight", "alerta", "analista"],
        },
        {
          id: "aceptar-propuesta-de-insight",
          title: "Aceptar la acción que propone una alerta",
          summary:
            "Algunas alertas traen un botón con una acción lista (por ejemplo {{Generar ND por mora}}).",
          permission: "ai:read",
          prerequisites: [
            "Además, el permiso de la acción que se propone (por ejemplo, emitir comprobantes para una nota de débito).",
          ],
          steps: [
            "En la alerta, hacé clic en el botón de la acción (debajo del texto de la alerta).",
            "Revisá los datos de la propuesta en el diálogo.",
            "Hacé clic en {{Aceptar}} para registrarla, o en {{Descartar}} si no la querés.",
          ],
          after: [
            "Al aceptar, el sistema hace la operación como si la cargaras a mano, con las mismas validaciones, y aparece «Listo, quedó registrado.». La propuesta queda marcada como {{Aceptada}} o {{Descartada}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para esta acción.",
              fix: "Tu usuario no puede hacer esa operación: pedíselo a alguien con el rol que corresponda.",
            },
            {
              message: "La propuesta tiene datos inválidos.",
              fix: "Los datos cambiaron desde que se armó la propuesta: descartala y hacé la operación desde su pantalla.",
            },
          ],
          keywords: ["propuesta", "insight", "aceptar"],
        },
        {
          id: "marcar-insight-visto",
          title: "Marcar una alerta como vista",
          permission: "ai:admin",
          steps: ["En la alerta, hacé clic en {{Visto}}."],
          after: [
            "La alerta queda atenuada en la lista y el botón {{Visto}} desaparece.",
          ],
          errors: [
            {
              message: "No tenés permiso para gestionar insights.",
              fix: "Solo owner y admin marcan o ignoran alertas.",
            },
            {
              message: "Esta tarjeta se recalculó. Recargá los insights.",
              fix: "Recargá la página: la alerta cambió desde que la abriste.",
            },
          ],
          related: ["ignorar-insight"],
          keywords: ["insight", "alerta", "visto"],
        },
        {
          id: "ignorar-insight",
          title: "Ignorar una alerta",
          permission: "ai:admin",
          screens: [
            {
              kind: "dialog",
              title: "Ignorar insight",
              fields: [
                {
                  label: "Motivo",
                  kind: "textarea",
                  value: "Es una factura repetida a propósito (dos entregas).",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Ignorar", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la alerta, hacé clic en {{Ignorar}}.",
            "En {{Motivo}}, contá por qué la ignorás (entre 3 y 500 caracteres).",
            "Hacé clic en {{Ignorar}}.",
          ],
          after: [
            "Aparece «Insight ignorado.»: el analista no vuelve a mostrar ese mismo hallazgo.",
          ],
          errors: [
            {
              message: "Contá en pocas palabras por qué lo ignorás.",
              fix: "Escribí un motivo de al menos 3 caracteres.",
            },
            {
              message: "No tenés permiso para gestionar insights.",
              fix: "Solo owner y admin ignoran alertas.",
            },
          ],
          related: ["marcar-insight-visto"],
          keywords: ["insight", "alerta", "descartar", "ocultar"],
        },
      ],
    },
    {
      id: "tareas",
      title: "Tareas",
      menuPath: "Plataforma › Tareas",
      routes: ["/tasks"],
      permission: "tasks:read",
      intro: [
        "Los pendientes del equipo: los que crean ustedes, los que se repiten cada mes y los que el sistema saca de los documentos por pagar, cobrar o renovar.",
        "Arriba, dos filtros: de quién ({{Mías}} / {{Todas}}) y el estado ({{Abiertas}} / {{Vencidas}} / {{Hechas}}). La lista muestra {{Tarea}} (con su tipo debajo), {{Vence}} (con un aviso si ya venció), {{Responsables}} y, en las abiertas, el botón {{Hecha}}. Al hacer clic en una fila se abre su detalle.",
      ],
      screens: [
        {
          kind: "page",
          title: "Tareas",
          actions: [
            { label: "Recurrentes", variant: "outline" },
            { label: "Nueva tarea", variant: "primary" },
          ],
          tabs: { labels: ["Mías", "Todas"], active: 0 },
          table: {
            columns: ["Tarea", "Vence", "Responsables", ""],
            rows: [
              [
                "~Pagar a YPF · Pago a proveedor",
                "~10/11/2026",
                "~Ana López",
                "~Hecha",
              ],
              [
                "~Cierre de mes · Recurrente",
                "~01/12/2026",
                "~Ana López y 2 más",
                "~Hecha",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Los tres tipos de tarea",
          body: [
            "**{{Manual}}**: la crea alguien con {{Nueva tarea}}.",
            "**{{Recurrente}}**: se crea sola una semana antes de su día, todos los meses, a partir de una tarea recurrente.",
            "**{{Automática}}**: el sistema la crea cada mañana a partir de un documento: {{Pago a proveedor}}, {{Cobranza vencida}}, {{Cuota de préstamo}}, {{Cheque propio}}, {{Documento de flota}}, {{Documento de empleado}}, {{Km mensual}} e {{Impuesto}}. Se asigna sola a quienes pueden resolver ese documento y se cierra sola cuando el documento ya no tiene nada pendiente. Desde su detalle, {{Ir al documento}} te lleva a la pantalla donde se resuelve.",
          ],
        },
        {
          title: "Tareas de módulos que no ves",
          body: [
            "Si una tarea automática sale de un módulo que tu usuario no puede leer, la ves con un candado y el título «Tarea de un módulo sin acceso»: no se muestra su detalle y no la podés cambiar.",
            "Solo se puede asignar una tarea a usuarios con acceso a Tareas.",
          ],
        },
        {
          title: "Avisos",
          body: [
            "Cada responsable recibe una notificación el día que vence la tarea y otra, una sola vez, en la semana siguiente si sigue abierta (ver [[#notificaciones]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "crear-tarea",
          title: "Crear una tarea",
          permission: "tasks:write",
          screens: [
            {
              kind: "dialog",
              title: "Nueva tarea",
              description:
                "Una tarea para vos o para otros. Si se repite, se crea sola todos los meses.",
              fields: [
                {
                  label: "Título",
                  kind: "input",
                  value: "Llamar al cliente por la factura vencida",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Detalle (opcional)",
                  kind: "textarea",
                  marker: 3,
                  wide: true,
                },
                {
                  label: "Se repite todos los meses",
                  kind: "switch",
                  wide: true,
                },
                {
                  label: "Vencimiento (opcional)",
                  kind: "date",
                  value: "15/11/2026",
                  marker: 4,
                },
                {
                  label: "Responsables",
                  kind: "picker",
                  value: "Ana López",
                  marker: 5,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear", variant: "primary", marker: 6 },
              ],
            },
          ],
          steps: [
            "En [[/tasks]], hacé clic en {{Nueva tarea}}.",
            "En {{Título}}, escribí qué hay que hacer (hasta 200 caracteres).",
            "Si hace falta, en {{Detalle (opcional)}} agregá más información (hasta 2000 caracteres).",
            "En {{Vencimiento (opcional)}}, elegí la fecha límite, o dejalo vacío.",
            "En {{Responsables}}, marcá a las personas que se encargan (hasta 20). Podés dejarla sin responsables.",
            "Hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece «Tarea creada.» y la tarea queda {{Abierta}} en la lista de cada responsable.",
            "Los responsables reciben la notificación el día que vence.",
          ],
          errors: [
            {
              message: "El título es obligatorio.",
              fix: "Escribí un título.",
            },
            {
              message: "Algún responsable no tiene acceso a Tareas.",
              fix: "Sacá de la lista a quien no puede ver Tareas, o pedile al owner que le dé el acceso.",
            },
            {
              message: "No tenés permiso para crear tareas.",
              fix: "Pedile la tarea a alguien con permiso para crear tareas.",
            },
          ],
          related: ["crear-tarea-recurrente", "marcar-tarea-hecha"],
          keywords: ["pendiente", "recordatorio", "to do", "asignar"],
        },
        {
          id: "crear-tarea-recurrente",
          title: "Crear una tarea que se repite todos los meses",
          permission: "tasks:write",
          steps: [
            "En [[/tasks]], hacé clic en {{Nueva tarea}}.",
            "Completá {{Título}} y, si querés, {{Detalle (opcional)}}.",
            "Activá {{Se repite todos los meses}}.",
            "En {{Día del mes}}, escribí el día en que vence cada mes (1 a 31). Si un mes es más corto, vence el último día.",
            "Elegí los {{Responsables}} y hacé clic en {{Crear}}.",
          ],
          after: [
            "Aparece «Tarea recurrente creada.». Cada mes, una semana antes del día elegido, se crea sola una tarea {{Recurrente}} con esos responsables; si el día ya cae dentro de esa semana, la de este mes se crea en el momento.",
            "Las recurrentes se ven y se editan en {{Recurrentes}} ([[#editar-tarea-recurrente]]).",
          ],
          errors: [
            {
              message: "Día entre 1 y 31.",
              fix: "Escribí un día del 1 al 31.",
            },
            {
              message: "Algún responsable no tiene acceso a Tareas.",
              fix: "Sacá de la lista a quien no puede ver Tareas.",
            },
            {
              message: "No se pudo crear la tarea recurrente.",
              fix: "No se guardó nada: probá de nuevo.",
            },
          ],
          related: ["editar-tarea-recurrente"],
          keywords: ["recurrente", "mensual", "repetir", "todos los meses"],
        },
        {
          id: "editar-tarea-recurrente",
          title: "Editar, pausar o reactivar una tarea recurrente",
          permission: "tasks:write",
          screens: [
            {
              kind: "dialog",
              title: "Tareas recurrentes",
              description:
                "Se crean solas una semana antes de su día de cada mes.",
              table: {
                columns: ["~Tarea", "~Activa", "~"],
                rows: [["~Cierre de mes · Día 1 · Ana López", "~Sí", "~✎"]],
              },
              footer: [],
            },
          ],
          steps: [
            "En [[/tasks]], hacé clic en {{Recurrentes}}.",
            {
              text: "En la fila de la tarea:",
              substeps: [
                "Con el interruptor la pausás o la reactivás: una pausada no crea más tareas.",
                "Con el lápiz ({{Editar}}) se abre {{Editar tarea recurrente}}: cambiá {{Título}}, {{Detalle (opcional)}}, {{Día del mes}} o {{Responsables}} y hacé clic en {{Guardar}}.",
              ],
            },
          ],
          after: [
            "Aparece «Tarea recurrente guardada.». Los cambios aplican a las próximas ocurrencias; las tareas ya creadas no cambian.",
          ],
          errors: [
            {
              message:
                "Se guardó la tarea pero no sus responsables. Reintentá.",
              fix: "Volvé a abrir {{Editar}}, elegí los responsables y guardá.",
            },
            {
              message: "La tarea recurrente no existe.",
              fix: "Otro usuario la borró: cerrá el diálogo y volvé a abrirlo.",
            },
            {
              message: "No tenés permiso para editar tareas.",
              fix: "Pedile el cambio a alguien con permiso para editar tareas.",
            },
          ],
          related: ["crear-tarea-recurrente"],
          keywords: ["recurrente", "pausar", "desactivar"],
        },
        {
          id: "marcar-tarea-hecha",
          title: "Marcar una tarea como hecha",
          permission: "tasks:write",
          steps: [
            "En [[/tasks]], en la fila de la tarea, hacé clic en {{Hecha}}. También podés abrir la tarea y hacer clic en {{Marcar como hecha}}.",
          ],
          after: [
            "Aparece «Tarea hecha.»: la tarea pasa a {{Hechas}}, tachada, con quién y cuándo la cerró.",
            "Una tarea automática se cierra sola cuando su documento ya no tiene nada pendiente; su detalle dice «Se cerró sola: el documento ya no tiene nada pendiente.».",
          ],
          errors: [
            {
              message: "La tarea ya estaba hecha.",
              fix: "Otro usuario la cerró antes: no hace falta hacer nada.",
            },
            {
              message: "No tenés acceso al módulo de esta tarea.",
              fix: "La tarea sale de un módulo que no podés ver: pedile a alguien con ese acceso que la cierre.",
            },
          ],
          related: ["reabrir-tarea"],
          keywords: ["completar", "terminar", "cerrar tarea", "listo"],
        },
        {
          id: "reabrir-tarea",
          title: "Reabrir una tarea hecha",
          permission: "tasks:write",
          steps: [
            "En [[/tasks]], elegí {{Hechas}} y hacé clic en la tarea.",
            "En el detalle, hacé clic en {{Reabrir}}.",
          ],
          after: ["Aparece «Tarea reabierta.» y vuelve a {{Abiertas}}."],
          errors: [
            {
              message: "La tarea ya estaba abierta.",
              fix: "Otro usuario la reabrió antes: no hace falta hacer nada.",
            },
          ],
          related: ["marcar-tarea-hecha"],
          keywords: ["reabrir", "deshacer"],
        },
        {
          id: "cambiar-tarea",
          title: "Cambiar el vencimiento o los responsables de una tarea",
          permission: "tasks:write",
          steps: [
            "En [[/tasks]], hacé clic en la tarea.",
            "En {{Vencimiento}}, elegí otra fecha (o borrala).",
            "En {{Responsables}}, marcá o desmarcá personas.",
          ],
          after: [
            "Cada cambio se guarda al instante y queda en el {{Historial}} de la tarea con quién lo hizo.",
            "Si reasignás a mano una tarea automática, el sistema ya no la reasigna solo.",
          ],
          errors: [
            {
              message: "Algún responsable no tiene acceso a Tareas.",
              fix: "Elegí solo usuarios con acceso a Tareas.",
            },
            {
              message: "No tenés permiso para reasignar tareas.",
              fix: "Pedile el cambio a alguien con permiso para editar tareas.",
            },
          ],
          keywords: ["reasignar", "posponer", "mover fecha", "vencimiento"],
        },
        {
          id: "comentar-tarea",
          title: "Comentar una tarea",
          permission: "tasks:write",
          steps: [
            "En [[/tasks]], hacé clic en la tarea.",
            "En {{Comentarios}}, escribí el comentario (hasta 2000 caracteres).",
            "Hacé clic en {{Comentar}}.",
          ],
          after: [
            "El comentario queda con tu nombre y la hora, visible para todos los que ven la tarea.",
          ],
          keywords: ["nota", "comentario", "seguimiento"],
        },
      ],
    },
    {
      id: "archivos",
      title: "Archivos",
      menuPath: "Plataforma › Archivos",
      routes: ["/files"],
      permission: "files:read",
      intro: [
        "Todos los archivos que podés ver en un solo lugar: adjuntos de comprobantes, compras, recibos, órdenes de pago, clientes, proveedores, combustible e impuestos, documentos escaneados, documentos de empleados y de flota, y adjuntos de tus chats con la IA.",
        "La lista muestra {{Archivo}} (nombre y tamaño), {{Origen}} (a qué registro pertenece, con link), {{Subido por}} y {{Fecha}}, los más nuevos primero. Se carga más al bajar.",
      ],
      screens: [
        {
          kind: "page",
          title: "Archivos",
          toolbar: [
            { label: "Buscar por nombre", kind: "input" },
            { label: "Todos los orígenes", kind: "select" },
            { label: "Cualquier tipo", kind: "select" },
            { label: "Cualquier persona", kind: "select" },
            { label: "Desde", kind: "date" },
            { label: "Hasta", kind: "date" },
          ],
          table: {
            columns: ["Archivo", "Origen", "Subido por", "Fecha", ""],
            rows: [
              [
                "~factura-ypf.pdf",
                "~Factura de compra",
                "~Ana López",
                "~04/11/2026 10:12",
              ],
              [
                "~cheque.jpg",
                "~Cheque de tercero",
                "~Juan Pérez",
                "~03/11/2026 16:40",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Qué archivos ves",
          body: [
            "Un archivo se ve solo a través de un registro que podés leer: por ejemplo, sin acceso a Compras no aparecen las facturas de compra. Los documentos escaneados y los adjuntos del chat con la IA los ve solo quien los subió, además de owner y admin.",
            "Los archivos se suben desde la pantalla de cada registro ([[#adjuntar-archivo]]), no desde acá.",
          ],
        },
      ],
      tasks: [
        {
          id: "buscar-archivos",
          title: "Buscar un archivo",
          permission: "files:read",
          steps: [
            {
              text: "En [[/files]], usá los filtros de arriba (se pueden combinar):",
              substeps: [
                "{{Buscar por nombre}}: parte del nombre del archivo.",
                "{{Origen}}: el tipo de registro ({{Factura de compra}}, {{Comprobante emitido}}, {{Recibo}}, {{Documento escaneado}}, {{Chat con IA}}…).",
                "{{Tipo de archivo}}: {{PDF}}, {{Imagen}} o {{Planilla}}.",
                "{{Subido por}}: la persona que lo subió.",
                "{{Desde}} y {{Hasta}}: el rango de fechas de subida.",
              ],
            },
          ],
          after: [
            "Los filtros quedan en la dirección de la página: podés copiarla y compartir la búsqueda.",
          ],
          keywords: ["adjuntos", "buscar archivo", "pdf", "documentos"],
        },
        {
          id: "ver-descargar-archivo",
          title: "Ver o descargar un archivo",
          permission: "files:read",
          steps: [
            "En [[/files]], hacé clic en el nombre del archivo o en el ojo ({{Ver}}) para verlo sin salir de la pantalla.",
            "Para bajarlo, hacé clic en {{Descargar}}.",
            "Para ir al registro al que pertenece, hacé clic en su {{Origen}}.",
          ],
          errors: [
            {
              message: "Archivo no encontrado.",
              fix: "El archivo se borró o ya no tenés acceso a su módulo: actualizá la lista.",
            },
          ],
          keywords: ["abrir", "bajar", "previsualizar"],
        },
        {
          id: "adjuntar-archivo",
          title: "Adjuntar un archivo a un registro",
          summary:
            "En la ficha de un comprobante, compra, recibo, orden de pago, cliente o proveedor, o en una carga de combustible o un impuesto, la sección de adjuntos. Los cheques y los movimientos de caja no tienen zona para subir archivos.",
          permission: "files:write",
          prerequisites: [
            "Además, el permiso de escritura del registro (por ejemplo `purchase_invoices:write` para una compra): sin él, la subida se rechaza. En clientes y proveedores, sin ese permiso no aparece la zona para subir; en una compra anulada tampoco.",
          ],
          steps: [
            "Abrí el registro y bajá hasta sus adjuntos.",
            "Si el registro admite varios tipos de adjunto, elegí el tipo en {{Tipo:}} (por ejemplo {{Comprobante}}, {{Remito}}, {{Comprobante de pago}}, {{Otro}}).",
            "Arrastrá el archivo al recuadro, o hacé clic en {{Elegir archivo}}. En el celular también podés usar {{Tomar foto}}.",
          ],
          after: [
            "Aparece «… adjuntado.» y el archivo queda en la lista del registro y en [[/files]]. El alta queda en la auditoría del registro.",
            "Se aceptan PDF, imágenes PNG, JPG y WebP, y planillas CSV y Excel, de hasta 10 MB.",
          ],
          errors: [
            {
              message: "El archivo supera 10 MB.",
              fix: "Achicá el archivo (por ejemplo, escaneá en menor resolución) y volvé a subirlo.",
            },
            {
              message: "Tipo no permitido (…).",
              fix: "Convertí el archivo a PDF, imagen o planilla.",
            },
            {
              message: "El archivo está vacío.",
              fix: "Revisá el archivo: no tiene contenido.",
            },
            {
              message: "Sin permiso para atachar a esa entidad.",
              fix: "No podés editar ese registro: pedile a alguien con acceso que suba el archivo.",
            },
            {
              message: "Sin permiso para subir archivos.",
              fix: "Tu rol no sube archivos: pedíselo a alguien de Finanzas, Operaciones, Depósito, Admin u Owner.",
            },
          ],
          related: ["borrar-adjunto"],
          keywords: ["subir", "adjuntar", "archivo", "pdf", "foto"],
        },
        {
          id: "borrar-adjunto",
          title: "Borrar un adjunto",
          permission: "files:write",
          prerequisites: [
            "Además, el permiso de escritura del registro (como para adjuntar), y haber adjuntado vos ese archivo, salvo que seas owner o admin.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Borrar este adjunto",
              description:
                "Vas a eliminar factura.pdf de este registro. No se puede deshacer.",
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Borrar", variant: "destructive", marker: 2 },
              ],
            },
          ],
          steps: [
            "En los adjuntos del registro, hacé clic en el tacho ({{Borrar adjunto}}) del archivo.",
            "Confirmá con {{Borrar}}.",
          ],
          after: [
            "Aparece «Adjunto eliminado.»: el archivo deja de estar asociado al registro y la baja queda en su auditoría.",
            "La baja es inmediata: si ningún otro registro usa el archivo, se borra también en ese momento.",
          ],
          errors: [
            {
              message: "No tenés permiso para modificar archivos.",
              fix: "Pedile la baja a alguien con permiso para subir archivos.",
            },
            {
              message: "Adjunto no encontrado.",
              fix: "Otro usuario ya lo borró: actualizá la pantalla.",
            },
            {
              message: "Solo quien lo adjuntó o un admin lo quita.",
              fix: "Pedile la baja a quien lo adjuntó o a un owner o admin.",
            },
          ],
          related: ["adjuntar-archivo"],
          keywords: ["eliminar adjunto", "quitar archivo"],
        },
      ],
    },
    {
      id: "chat",
      title: "Chat",
      menuPath: "Plataforma › Chat",
      routes: ["/chat", "/chat/[channelId]"],
      permission: null,
      intro: [
        "Mensajes entre las personas del equipo. A la izquierda, la lista de chats en tres grupos: {{Mis notas}} (un chat solo tuyo, para notas y links), {{Mensajes directos}} y {{Grupos}}, con el último mensaje y los no leídos. A la derecha, la conversación elegida. Si todavía no tenés otros chats, se abre directo {{Mis notas}}.",
        "En el celular se ve una cosa por vez: la lista o la conversación (la flecha de arriba vuelve a la lista).",
      ],
      concepts: [
        {
          title: "Lo que se puede escribir",
          body: [
            "Cada mensaje tiene hasta 4000 caracteres. **Enter** envía y **Shift + Enter** hace un salto de línea. Los links se vuelven clickeables.",
            "El chat del equipo es solo texto: para trabajar con archivos, adjuntalos en el chat del asistente ([[#adjuntar-archivo-al-asistente]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "abrir-mensaje-directo",
          title: "Escribirle a una persona",
          permission: null,
          screens: [
            {
              kind: "dialog",
              title: "Nuevo chat",
              description:
                "Mensaje directo o grupo. Los grupos pueden tener varios miembros.",
              fields: [
                {
                  label: "Buscar por nombre o email…",
                  kind: "input",
                  value: "ana",
                  marker: 2,
                  wide: true,
                },
              ],
              footer: [],
            },
          ],
          steps: [
            "En [[/chat]], hacé clic en {{Nuevo}}.",
            "En la pestaña {{Persona}}, buscá por nombre o email.",
            "Hacé clic en la persona.",
          ],
          after: [
            "Se abre la conversación con esa persona (si ya existía, la misma de antes).",
          ],
          errors: [
            {
              message: "Error al abrir DM.",
              fix: "Probá de nuevo; si sigue, recargá la página.",
            },
          ],
          related: ["enviar-mensaje-chat"],
          keywords: ["mensaje directo", "DM", "privado"],
        },
        {
          id: "crear-grupo-chat",
          title: "Crear un grupo",
          permission: null,
          steps: [
            "En [[/chat]], hacé clic en {{Nuevo}} y elegí la pestaña {{Grupo}}.",
            "Escribí el nombre del grupo (obligatorio, hasta 60 caracteres) y, si querés, una descripción (hasta 280).",
            "En {{Miembros}}, buscá y marcá a las personas (al menos una, hasta 50).",
            "Hacé clic en {{Crear grupo}}.",
          ],
          after: [
            "Se abre el grupo. Quien lo crea queda como administrador del grupo.",
          ],
          errors: [
            {
              message: "Agregá al menos un miembro.",
              fix: "Marcá al menos una persona en la lista.",
            },
            {
              message: "Máx 50 miembros.",
              fix: "Dejá como mucho 50 personas.",
            },
          ],
          related: ["configurar-grupo-chat"],
          keywords: ["grupo", "canal", "equipo"],
        },
        {
          id: "enviar-mensaje-chat",
          title: "Enviar, responder y mencionar",
          permission: null,
          steps: [
            "Abrí la conversación en la lista de la izquierda.",
            "Escribí en {{Escribí un mensaje…}} y apretá Enter (o el botón de enviar).",
            "Para mencionar a alguien, escribí `@` y el comienzo de su nombre, y elegí a la persona en la lista (con las flechas y Enter, o con un clic).",
            "Para responder un mensaje puntual, pasá el mouse sobre él y hacé clic en la flecha ({{Responder}}): arriba del cuadro aparece «Respondiendo a …». Escribí y enviá.",
          ],
          after: [
            "Los demás lo ven al instante. Cada miembro recibe una notificación de mensaje; quien es mencionado recibe la de mención en su lugar, y el autor del mensaje respondido recibe además la de respuesta (salvo que las tengan apagadas o el chat silenciado).",
          ],
          errors: [
            {
              message: "Máx 4000 caracteres.",
              fix: "Dividí el texto en dos mensajes.",
            },
          ],
          related: ["editar-borrar-mensaje-chat", "reaccionar-mensaje-chat"],
          keywords: ["mensaje", "mencionar", "arroba", "responder", "reply"],
        },
        {
          id: "editar-borrar-mensaje-chat",
          title: "Editar o borrar un mensaje tuyo",
          permission: null,
          screens: [
            {
              kind: "menu",
              trigger: "⋯",
              items: [
                { label: "Editar", marker: 2 },
                { label: "Eliminar", marker: 3, destructive: true },
              ],
            },
          ],
          steps: [
            "Pasá el mouse sobre tu mensaje y hacé clic en {{Más}} (⋯).",
            "Para corregirlo, elegí {{Editar}}, cambiá el texto y hacé clic en {{Guardar}} (o Enter; Escape cancela).",
            "Para borrarlo, elegí {{Eliminar}} y confirmá.",
          ],
          after: [
            "Un mensaje editado muestra «(editado)». Uno borrado se ve como «Mensaje eliminado» para todos y no se puede recuperar.",
          ],
          keywords: ["corregir", "borrar mensaje", "eliminar mensaje"],
        },
        {
          id: "reaccionar-mensaje-chat",
          title: "Reaccionar a un mensaje",
          permission: null,
          steps: [
            "Pasá el mouse sobre el mensaje y hacé clic en {{Reaccionar}}.",
            "Elegí el emoji.",
          ],
          after: [
            "La reacción aparece debajo del mensaje con la cantidad de personas. Volvé a hacer clic en ella para sacarla.",
          ],
          keywords: ["emoji", "reacción", "like"],
        },
        {
          id: "buscar-en-chat",
          title: "Buscar en los chats",
          permission: null,
          steps: [
            "En [[/chat]], hacé clic en la lupa ({{Buscar (⌘K)}}) o apretá Ctrl+K (⌘K en Mac).",
            "Escribí una palabra, frase o nombre.",
            "Hacé clic en un resultado para abrir esa conversación.",
          ],
          after: [
            "Busca en los mensajes de todas tus conversaciones y marca la palabra encontrada.",
          ],
          keywords: ["buscar mensaje", "encontrar"],
        },
        {
          id: "silenciar-chat",
          title: "Silenciar una conversación",
          permission: null,
          screens: [
            {
              kind: "menu",
              trigger: "Opciones del chat",
              items: [
                { label: "Silenciar", marker: 2 },
                { label: "Configurar grupo" },
              ],
            },
          ],
          steps: [
            "En la conversación, hacé clic en el engranaje de arriba a la derecha ({{Opciones del chat}}).",
            "Elegí {{Silenciar}}. Para volver a recibir avisos, elegí {{Activar notificaciones}}.",
          ],
          after: [
            "Aparece «Notificaciones silenciadas.»: esa conversación deja de mandarte notificaciones, pero los mensajes siguen llegando.",
          ],
          keywords: ["mute", "silenciar", "no molestar"],
        },
        {
          id: "configurar-grupo-chat",
          title: "Renombrar un grupo, sumar o quitar miembros",
          permission: null,
          prerequisites: [
            "Ser administrador del grupo (quien lo creó). Los demás miembros ven el diálogo pero no pueden cambiar nada.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Configurar grupo",
              description:
                "Renombrá, sumá miembros o sacá a quien ya no participa.",
              fields: [
                {
                  label: "Nombre",
                  kind: "input",
                  value: "Cobranzas",
                  marker: 2,
                },
                { label: "Descripción", kind: "textarea" },
              ],
              footer: [
                { label: "Salir del grupo", variant: "ghost" },
                { label: "Cerrar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 2 },
              ],
            },
          ],
          steps: [
            "En el grupo, abrí {{Opciones del chat}} y elegí {{Configurar grupo}}.",
            "Para renombrarlo, cambiá {{Nombre}} o {{Descripción}} y hacé clic en {{Guardar}}.",
            "Para sumar personas, en {{Agregar miembros}} marcalas y hacé clic en el botón **Agregar N**.",
            "Para sacar a alguien, hacé clic en el tacho ({{Quitar}}) de su fila y confirmá.",
          ],
          after: [
            "Aparece «Grupo actualizado.», «Miembros agregados.» o «Miembro removido.». Quien sale del grupo deja de ver los mensajes nuevos.",
          ],
          related: ["salir-de-grupo-chat"],
          keywords: ["grupo", "miembros", "renombrar", "agregar persona"],
        },
        {
          id: "salir-de-grupo-chat",
          title: "Salir de un grupo o cerrar un chat directo",
          permission: null,
          steps: [
            "En un grupo: abrí {{Opciones del chat}}, elegí {{Configurar grupo}}, hacé clic en {{Salir del grupo}} y confirmá con {{Salir}}.",
            "En un mensaje directo: abrí {{Opciones del chat}}, elegí {{Cerrar chat}} y confirmá con {{Cerrar}}.",
          ],
          after: [
            "Del grupo: aparece «Saliste del grupo.» y dejás de ver los mensajes nuevos; para volver, alguien tiene que agregarte. Si eras el único administrador, pasa a serlo el miembro más antiguo.",
            "El chat directo desaparece de tu lista; se vuelve a abrir si le escribís de nuevo a esa persona.",
          ],
          keywords: ["abandonar", "salir", "cerrar conversación"],
        },
      ],
    },
    {
      id: "perfil",
      title: "Mi perfil",
      menuPath: "Perfil",
      routes: ["/profile"],
      permission: null,
      intro: [
        "Cómo te ven los demás en el chat, la auditoría y los listados (foto, nombre, color), y qué notificaciones recibís. Se abre desde tu nombre en el pie de la barra lateral › {{Perfil}}.",
      ],
      tasks: [
        {
          id: "editar-perfil",
          title: "Cambiar tu nombre o el color del avatar",
          permission: null,
          screens: [
            {
              kind: "dialog",
              caption: "Perfil",
              title: "Mi perfil",
              fields: [
                { label: "Nombre", kind: "input", value: "Ana", marker: 1 },
                { label: "Apellido", kind: "input", value: "López", marker: 1 },
                { label: "Color del avatar", kind: "select", marker: 2 },
              ],
              footer: [
                { label: "Guardar cambios", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En [[/profile]], completá {{Nombre}} y {{Apellido}} (hasta 80 caracteres cada uno).",
            "En {{Color del avatar}}, hacé clic en uno de los círculos de color: es el fondo de tus iniciales cuando no tenés foto.",
            "Hacé clic en {{Guardar cambios}} (se habilita cuando cambiaste algo).",
          ],
          after: [
            "Aparece «Perfil actualizado.» y tu nombre nuevo se ve en el chat, las tareas, la auditoría y la barra lateral.",
          ],
          errors: [
            {
              message: "Ingresá tu nombre.",
              fix: "El nombre no puede quedar vacío.",
            },
            {
              message: "Ingresá tu apellido.",
              fix: "El apellido no puede quedar vacío.",
            },
          ],
          related: ["cambiar-foto-perfil"],
          keywords: ["nombre", "avatar", "perfil", "color"],
        },
        {
          id: "cambiar-foto-perfil",
          title: "Cambiar o quitar tu foto",
          permission: null,
          steps: [
            "En [[/profile]], hacé clic en {{Cambiar foto}} y elegí una imagen PNG, JPG o WebP de hasta 1 MB.",
            "Para sacarla, hacé clic en {{Quitar}}.",
          ],
          after: [
            "Aparece «Foto actualizada.» (o «Foto eliminada.»). Sin foto se muestran tus iniciales con el color elegido.",
          ],
          errors: [
            {
              message: "Solo PNG, JPG o WebP.",
              fix: "Guardá la imagen en uno de esos formatos.",
            },
            {
              message: "Máx 1 MB.",
              fix: "Usá una imagen más chica o recortala.",
            },
          ],
          related: ["editar-perfil"],
          keywords: ["foto", "avatar", "imagen de perfil"],
        },
        {
          id: "preferencias-notificaciones",
          title: "Elegir qué notificaciones de chat recibís",
          permission: null,
          steps: [
            {
              text: "En [[/profile]], en {{Notificaciones}}, activá o apagá cada tipo:",
              substeps: [
                "{{Menciones}}: cuando te mencionan con @.",
                "{{Respuestas}}: cuando alguien responde un mensaje tuyo.",
                "{{Mensajes de chat}}: cualquier mensaje en tus conversaciones.",
              ],
            },
          ],
          after: [
            "Se guarda al instante. Vale para la campanita y para los avisos del navegador; los avisos de tareas y de tareas de IA no se apagan desde acá.",
          ],
          related: ["silenciar-chat", "activar-push"],
          keywords: ["notificaciones", "avisos", "apagar", "campanita"],
        },
        {
          id: "activar-push",
          title: "Recibir notificaciones con el sistema cerrado (push)",
          permission: null,
          steps: [
            "En [[/profile]], en {{Push en este dispositivo}}, hacé clic en {{Activar push en este dispositivo}}.",
            "Aceptá el permiso que pide el navegador.",
            "Para dejar de recibirlas en ese dispositivo, hacé clic en {{Desactivar push en este dispositivo}}.",
          ],
          after: [
            "Aparece «Push activado en este dispositivo.». Se activa por dispositivo y navegador: repetilo en cada uno donde quieras recibirlas.",
            "Por push llegan los avisos de chat (mensajes, respuestas y menciones).",
            "Funciona en Chrome, Firefox y Edge. En el iPhone (Safari), primero agregá el sistema a la pantalla de inicio. Si el botón no aparece, el navegador no lo soporta, bloqueaste las notificaciones o el push no está configurado en esta instalación: la pantalla lo indica.",
          ],
          errors: [
            {
              message:
                "Permiso denegado. Activalo desde la configuración del browser.",
              fix: "En la configuración del sitio del navegador, permití las notificaciones y volvé a intentar.",
            },
          ],
          related: ["preferencias-notificaciones"],
          keywords: ["push", "notificaciones en el celular", "avisos"],
        },
      ],
    },
  ],
};
