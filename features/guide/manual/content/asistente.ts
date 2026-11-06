import type { GuidePage } from "../types";

// Assistant chapter: the AI chat (sessions, proposals, question cards,
// artifacts and attachments), pinned artifacts, scheduled AI tasks and
// Document Intelligence (/documentos).

export const assistantPage: GuidePage = {
  file: "asistente.html",
  title: "Asistente (IA)",
  lead: "El asistente responde preguntas sobre los datos del sistema con los permisos de tu usuario, arma propuestas que vos confirmás, corre tareas programadas y lee documentos escaneados para cargarlos.",
  sections: [
    {
      id: "asistente",
      title: "Asistente",
      menuPath: "Asistente",
      routes: ["/ai"],
      permission: "ai:chat",
      intro: [
        "El chat con el asistente. Le preguntás en tus palabras («¿cómo viene la caja?», «¿quién me debe más?») y responde con los datos que tu usuario puede ver en la app, con tablas y gráficos cuando ayudan. También le podés preguntar cómo se hace algo en el sistema.",
        "A la izquierda, el historial de conversaciones ({{Nuevo chat}}, agrupadas en {{Hoy}}, {{Ayer}} y {{Anteriores}}); en el celular se abre con el botón de la izquierda del título. Arriba a la derecha, {{Fijados}} y el consumo de IA del día. Sobre el chat, las alertas del analista (Insights).",
      ],
      concepts: [
        {
          title: "Qué puede y qué no puede hacer",
          body: [
            "Cada consulta corre con tus permisos: nunca ve datos que vos no podrías ver en la app. Si algo no está entre sus consultas, te lo dice.",
            "Nunca registra nada por su cuenta. Cuando le pedís cargar algo, arma una **propuesta** en una tarjeta y vos la confirmás, la modificás o la descartás ([[#confirmar-propuesta-ia]]).",
            "Las cifras salen siempre de una consulta al sistema; si no tiene el dato, lo dice.",
          ],
        },
        {
          title: "Qué puede proponer",
          body: [
            "{{Crear tarea}}, {{Programar tarea de IA}}, {{Mandar a Documentos}} (un archivo adjunto al chat), {{Registrar licencia}}, {{Cargar asiento manual}}, {{Cargar cotización USD}}, {{Cargar tarifa del cliente}}, {{Conciliar extracto}}, {{Generar ND por mora}} y {{Recategorizar gasto}}.",
            "Flota y operaciones: {{Crear viaje}}, {{Crear carga}}, {{Cambiar estado de la carga}}, {{Registrar carga de combustible}}, {{Registrar mantenimiento}}, {{Cargar km del vehículo}}, {{Armar liquidación de fletes}} (queda en borrador) y {{Confirmar liquidación de fletes}} (emite el Remito R al total que muestra la tarjeta; si un flete o una tarifa cambia antes de aceptar, no se confirma).",
            "Ventas: {{Dar de alta cliente}}, {{Editar cliente}}, {{Emitir comprobante}} (factura con CAE o remito interno), {{Emitir nota de crédito o débito}} y {{Enviar comprobante por email}}. Una factura o nota se emite al aceptar, igual que desde Comprobantes: el sistema calcula la letra, el IVA y el total.",
            "Tesorería: {{Registrar cobro}} (con sus retenciones), {{Enviar recibo por email}}, {{Crear orden de pago}} (desde una cuenta, con cheques en cartera o con cheques propios), {{Registrar movimiento de caja}}, {{Registrar transferencia entre cuentas}}, {{Cargar cheque recibido}}, {{Depositar cheque}} y {{Emitir cheque propio}}. Rendiciones: {{Armar rendición de chofer}} (si no le dijiste cuánto entregó o en qué cuenta, te pregunta), {{Confirmar rendición de chofer}} y {{Resolver diferencia de rendición}} (te pregunta si queda a cargo del chofer o del cliente).",
            "Depósito: {{Facturar almacenaje}} de un cliente y período, con los importes que calcula Facturación de almacenaje; si cambian antes de aceptar, no se emite.",
            "Compras e impuestos: {{Cargar factura de compra}}, {{Cargar comprobante de ARCA}} (si los importes de ARCA no suman el total, te pregunta a dónde va la diferencia), {{Dar de alta proveedor}}, {{Editar proveedor}}, {{Cargar impuesto}} y {{Pagar impuesto}}.",
            "Personal: {{Dar de alta un empleado}}, {{Editar empleado}}, {{Pagar sueldos}}, {{Movimiento de caja del empleado}} (adelanto o pago), {{Movimiento en la cuenta del empleado}}, {{Cargar asistencia}} y {{Pagar cuota de préstamo}}. En {{Registrar licencia}} de vacaciones, la tarjeta avisa (sin impedir confirmar) si no empieza un lunes (o el día hábil siguiente si el lunes es feriado, LCT art. 151) o si los días superan los pendientes del empleado.",
            "Para confirmar cada una necesitás el mismo permiso que para hacerla a mano.",
          ],
        },
        {
          title: "Límite diario",
          body: [
            "El consumo de IA tiene un tope por día para todo el equipo (lo que usa uno descuenta del total). El medidor de arriba a la derecha muestra lo usado hoy; al llegar al tope, el cuadro de texto dice {{Límite diario alcanzado}} hasta el día siguiente.",
          ],
        },
      ],
      tasks: [
        {
          id: "preguntar-al-asistente",
          title: "Hacerle una pregunta al asistente",
          permission: "ai:chat",
          screens: [
            {
              kind: "page",
              title: "Asistente IA",
              actions: [{ label: "Fijados", variant: "ghost" }],
              toolbar: [
                {
                  label: "Escribí tu pregunta o adjuntá un archivo…",
                  kind: "input",
                  value: "¿Quién me debe más?",
                  marker: 2,
                },
              ],
            },
          ],
          steps: [
            "Abrí [[/ai]] (el botón {{Asistente}} arriba de la barra lateral). Para una conversación nueva, hacé clic en {{Nuevo chat}}.",
            "Escribí la pregunta en {{Escribí tu pregunta o adjuntá un archivo…}} y apretá Enter. En una conversación nueva también podés hacer clic en una sugerencia ({{¿Cómo viene la caja?}}, {{¿Quién me debe más?}}…).",
            "Mientras trabaja, el asistente muestra «Pensando…» y las consultas que va haciendo. Después responde con texto, tablas o gráficos.",
          ],
          after: [
            "La conversación queda guardada en el historial con un título, para retomarla después.",
          ],
          errors: [
            {
              message:
                "Se alcanzó el límite diario de IA. Probá de nuevo mañana.",
              fix: "Se usó todo el consumo de IA del día: volvé a preguntar mañana.",
            },
            {
              message:
                "Alcanzaste el límite de consultas de IA. Probá más tarde.",
              fix: "Hiciste muchas consultas (hay un tope por hora y otro por día por usuario): esperá un rato.",
            },
            {
              message: "No se pudo enviar el mensaje. Probá de nuevo.",
              fix: "Falló la conexión: volvé a enviar el mensaje.",
            },
            {
              message: "Sin permiso para usar el chat de IA.",
              fix: "Tu usuario no tiene acceso al asistente: pedíselo al owner.",
            },
          ],
          related: ["preguntar-como-hacer", "fijar-resultado-ia"],
          keywords: [
            "IA",
            "inteligencia artificial",
            "preguntar",
            "consultar",
            "chat IA",
          ],
        },
        {
          id: "preguntar-como-hacer",
          title: "Preguntarle cómo se hace algo en el sistema",
          summary:
            "El asistente busca en esta guía y responde con los pasos y el link a la sección.",
          permission: "ai:chat",
          steps: [
            "En [[/ai]], preguntá en tus palabras, por ejemplo «¿cómo hago una nota de crédito?» o «¿dónde cargo un cheque rechazado?».",
            "Seguí los pasos que responde: los nombres entre « » son los textos exactos de los botones. El link abre la sección de la guía.",
          ],
          after: [
            "Si la tarea pide un permiso que tu usuario no tiene, te dice qué roles pueden hacerla. Si la guía no tiene la tarea, te lo dice en vez de inventar pasos.",
          ],
          related: ["usar-la-guia"],
          keywords: ["ayuda", "cómo hago", "guía", "manual", "instrucciones"],
        },
        {
          id: "adjuntar-archivo-al-asistente",
          title: "Mandarle un archivo al asistente",
          summary:
            "Un PDF, una foto o una planilla para que la lea, la resuma o la compare con los datos.",
          permission: ["ai:chat", "files:write"],
          steps: [
            "En [[/ai]], hacé clic en el clip ({{Adjuntar PDF, imagen o planilla}}), o en la cámara ({{Sacar una foto}}) desde el celular. También podés arrastrar el archivo al chat o pegarlo.",
            "Esperá a que el archivo termine de subir (aparece sobre el cuadro de texto).",
            "Escribí qué querés hacer con él y apretá Enter.",
          ],
          after: [
            "El archivo queda en el mensaje (se puede abrir desde ahí) y en [[/files]] como {{Chat con IA}}, visible para vos (y para owner y admin).",
            "Si es un comprobante, el asistente puede proponerte {{Mandar a Documentos}} para cargarlo ([[#documentos]]).",
            "Acepta PDF (hasta 20 páginas), PNG, JPG, WebP, CSV y XLSX, de hasta 4 MB (imágenes hasta 3,7 MB) y hasta 5 archivos por mensaje.",
          ],
          errors: [
            {
              message:
                "El archivo supera 4 MB, el máximo para el chat. Probá con una versión más liviana.",
              fix: "Achicá el archivo o mandá solo las páginas que importan.",
            },
            {
              message:
                "La imagen supera 3,7 MB. Probá con una foto de menor resolución.",
              fix: "Sacá la foto en menor resolución o recortala.",
            },
            {
              message: "El PDF tiene … páginas; el máximo para el chat es ….",
              fix: "Separá el PDF y mandá solo las páginas necesarias.",
            },
            {
              message: "Podés adjuntar hasta … archivos por mensaje.",
              fix: "Mandá el resto en otro mensaje.",
            },
            {
              message: "El contenido del archivo no coincide con su tipo.",
              fix: "El archivo está dañado o tiene una extensión equivocada: exportalo de nuevo.",
            },
            {
              message:
                "Alcanzaste el límite de adjuntos por hora. Probá más tarde.",
              fix: "Esperá un rato antes de subir más archivos.",
            },
          ],
          related: ["escanear-documento"],
          keywords: [
            "adjuntar",
            "subir archivo",
            "pdf",
            "foto",
            "planilla",
            "excel",
          ],
        },
        {
          id: "responder-preguntas-ia",
          title: "Responder las preguntas del asistente",
          summary:
            "Cuando le falta un dato o tiene que elegir entre varias opciones, el asistente pregunta con una tarjeta.",
          permission: "ai:chat",
          steps: [
            "En la tarjeta {{Preguntas del asistente}}, contestá cada pregunta: elegí una opción, marcá las que correspondan o escribí la respuesta. Si hay {{Otro…}}, podés escribir otra respuesta.",
            "Hacé clic en {{Enviar respuestas}}. Si preferís no contestar, hacé clic en {{Omitir}}.",
          ],
          after: [
            "El asistente sigue con tus respuestas. Mientras la tarjeta espera, el cuadro de texto queda bloqueado («Respondé las preguntas de arriba para seguir.»).",
          ],
          keywords: ["preguntas", "elegir", "opciones"],
        },
        {
          id: "confirmar-propuesta-ia",
          title: "Confirmar, modificar o descartar una propuesta",
          summary:
            "Lo que el asistente quiere registrar aparece en una tarjeta con los datos; nada se guarda hasta que lo confirmás.",
          permission: "ai:chat",
          prerequisites: [
            "Además, el permiso de la operación (por ejemplo `tasks:write` para {{Crear tarea}}): el mismo que pide hacerla a mano.",
          ],
          screens: [
            {
              kind: "dialog",
              caption: "Tarjeta de propuesta en el chat",
              title: "Crear tarea",
              table: {
                columns: ["~Dato", "~Valor"],
                rows: [
                  ["~Título", "~Llamar a Transportes Sur"],
                  ["~Vence", "~15/11/2026"],
                ],
              },
              footer: [
                { label: "Descartar", variant: "ghost", marker: 3 },
                { label: "Modificar", variant: "outline", marker: 2 },
                { label: "Crear tarea", variant: "primary", marker: 1 },
              ],
            },
          ],
          steps: [
            "Revisá los datos de la tarjeta y hacé clic en el botón principal (su texto dice qué hace: {{Crear tarea}}, {{Programar tarea}}, {{Mandar a Documentos}}, {{Cargar asiento}}, {{Emitir ND}}…).",
            "Para corregir algo antes, hacé clic en {{Modificar}}: en {{Modificar propuesta}} cambiá los campos y hacé clic en {{Guardar cambios}}. La tarjeta pasa a {{Editada · pendiente}}. También podés pedirle los cambios al asistente por chat.",
            "Si no la querés, hacé clic en {{Descartar}}.",
          ],
          after: [
            "Al confirmar, el sistema hace la operación con las mismas validaciones que el formulario manual, aparece «Listo, quedó registrado.» y la tarjeta queda {{Confirmada}}. Si falla, queda {{No se pudo completar}} con el motivo.",
            "Una propuesta descartada queda {{Descartada}}; una que el asistente rehízo queda {{Reemplazada}} por la nueva.",
          ],
          errors: [
            {
              message: "Esta propuesta ya no está pendiente.",
              fix: "Ya se confirmó, descartó o reemplazó (quizás en otra pestaña): mirá su estado en la tarjeta.",
            },
            {
              message: "No tenés permiso para esta acción.",
              fix: "Tu usuario no puede hacer esa operación: pedísela a alguien con el rol que corresponda.",
            },
            {
              message: "La propuesta tiene datos inválidos.",
              fix: "Modificá la propuesta o pedile al asistente que la corrija.",
            },
          ],
          keywords: [
            "propuesta",
            "confirmar",
            "aprobar",
            "registrar",
            "tarjeta",
          ],
        },
        {
          id: "fijar-resultado-ia",
          title: "Fijar o exportar una tabla o un gráfico",
          permission: "ai:chat",
          steps: [
            "En una tabla o un gráfico de la respuesta, usá los botones de su encabezado:",
            {
              text: "Elegí qué hacer:",
              substeps: [
                "{{Fijar}}: lo guarda en [[/ai/pinned]] para volver a verlo con los datos al día.",
                "{{CSV}} o {{Excel}}: descarga los datos.",
                "En un gráfico, {{Tabla}} muestra los mismos datos como tabla ({{Gráfico}} vuelve).",
              ],
            },
            "Si le pedís quién se toma vacaciones o licencia en un mes («haceme un calendario de las vacaciones de diciembre»), arma un calendario: una fila por empleado, una columna por día y cada día marcado con la letra del tipo (V vacaciones, E enfermedad, F franco…), con la referencia abajo y los fines de semana sombreados. Se exporta a CSV o Excel; no se puede fijar.",
          ],
          after: ["Al fijar aparece «Fijado. Lo ves en Fijados de IA.»."],
          errors: [
            {
              message: "No se pudo generar el Excel.",
              fix: "Probá de nuevo o descargá el CSV.",
            },
          ],
          related: ["quitar-fijado-ia"],
          keywords: [
            "fijar",
            "exportar",
            "excel",
            "csv",
            "gráfico",
            "tabla",
            "calendario",
          ],
        },
        {
          id: "borrar-conversacion-ia",
          title: "Retomar o borrar una conversación",
          permission: "ai:chat",
          steps: [
            "En el historial de [[/ai]], hacé clic en una conversación para retomarla.",
            "Para borrarla, pasá el mouse sobre ella, hacé clic en el tacho ({{Borrar conversación}}) y confirmá con {{Borrar}}.",
          ],
          after: [
            "Se eliminan la conversación y todos sus mensajes; no se puede deshacer.",
          ],
          keywords: ["historial", "conversación", "borrar chat"],
        },
        {
          id: "recalcular-insights",
          title: "Recalcular las alertas del analista",
          permission: "ai:admin",
          steps: [
            "En [[/ai]], sobre el chat, en {{Insights}}, hacé clic en {{Recalcular}}.",
          ],
          after: [
            "El analista revisa los datos de nuevo y aparece «… insights recalculados.». Las alertas también se ven en el dashboard ([[#dashboard]]).",
          ],
          errors: [
            {
              message: "No tenés permiso para recalcular insights.",
              fix: "Solo owner y admin recalculan las alertas.",
            },
          ],
          related: ["ignorar-insight"],
          keywords: ["insights", "alertas", "analista", "actualizar"],
        },
      ],
    },
    {
      id: "fijados-ia",
      title: "Fijados de IA",
      menuPath: "Asistente › Fijados",
      routes: ["/ai/pinned"],
      permission: "ai:chat",
      intro: [
        "Los gráficos y tablas que fijaste desde el asistente. Se recalculan cada vez que los abrís, con los datos y los permisos de ese momento. Se abre desde {{Fijados}} en [[/ai]]; {{Volver al asistente}} vuelve al chat.",
        "Si perdiste el permiso para ver los datos de uno, la tarjeta lo dice («Ya no tenés permiso para ver estos datos.») en vez de mostrarlos.",
      ],
      tasks: [
        {
          id: "quitar-fijado-ia",
          title: "Actualizar o quitar un fijado",
          permission: "ai:chat",
          steps: [
            "En [[/ai/pinned]], hacé clic en el botón de recarga ({{Recalcular}}) de la tarjeta para traer los datos de nuevo.",
            "Para sacarla, hacé clic en {{Quitar}}.",
          ],
          errors: [
            {
              message: "No se pudo quitar.",
              fix: "Probá de nuevo en unos segundos.",
            },
          ],
          related: ["fijar-resultado-ia"],
          keywords: ["desfijar", "quitar", "fijados"],
        },
      ],
    },
    {
      id: "tareas-ia",
      title: "Tareas IA",
      menuPath: "Inteligencia › Tareas IA",
      routes: ["/ai/tasks"],
      permission: "ai:chat",
      intro: [
        "Pedidos que el asistente corre solo, todos los días, semanas o meses, con tus permisos de solo lectura, y que recuerda lo que encontró la vez anterior (por ejemplo, «todos los lunes resumime las cobranzas vencidas»). Cada tarjeta muestra la frecuencia, la próxima corrida y el pedido; {{Corridas}} muestra el historial con su resultado.",
        "Son tuyas: cada usuario ve solo las suyas. Se pueden crear acá o pedírselas al asistente en el chat (propuesta {{Programar tarea de IA}}).",
      ],
      concepts: [
        {
          title: "Estado de cada corrida",
          body: [
            "{{En cola}}, {{Corriendo}}, {{Lista}} (hacé clic para leer el resultado), {{Falló}} (la próxima corrida lo vuelve a intentar) o {{Salteada}}, con el motivo: la tarea estaba pausada, se alcanzó el límite diario de IA, el usuario perdió el acceso al asistente, etc.",
            "Cuando una corrida termina bien, te llega una notificación («tarea de IA lista») que abre esta pantalla.",
          ],
        },
      ],
      tasks: [
        {
          id: "programar-tarea-ia",
          title: "Programar una tarea de IA",
          permission: "ai:chat",
          screens: [
            {
              kind: "dialog",
              title: "Nueva tarea de IA",
              description:
                "El asistente la corre solo, con tus permisos de lectura, y deja el resultado acá. Horario de Buenos Aires.",
              fields: [
                {
                  label: "Nombre",
                  kind: "input",
                  value: "Cobranzas vencidas",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Qué tiene que hacer",
                  kind: "textarea",
                  value:
                    "Resumime las cobranzas vencidas por cliente y qué cambió desde la semana pasada.",
                  marker: 3,
                  wide: true,
                },
                {
                  label: "Frecuencia",
                  kind: "select",
                  value: "Todas las semanas",
                  marker: 4,
                },
                { label: "Hora", kind: "select", value: "08:00", marker: 4 },
                { label: "Día", kind: "select", value: "lunes", marker: 4 },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Programar", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/ai/tasks]], hacé clic en {{Nueva tarea}}.",
            "En {{Nombre}}, poné un nombre corto (hasta 120 caracteres).",
            "En {{Qué tiene que hacer}}, escribí el pedido como se lo dirías al asistente (entre 10 y 2000 caracteres).",
            {
              text: "Elegí cuándo corre:",
              substeps: [
                "{{Frecuencia}}: {{Todos los días}}, {{Todas las semanas}} o {{Todos los meses}}.",
                "{{Hora}}: en intervalos de 15 minutos, hora de Buenos Aires.",
                "{{Día}} (semanal): el día de la semana. {{Día del mes}} (mensual): del 1 al 28.",
              ],
            },
            "Hacé clic en {{Programar}}.",
          ],
          after: [
            "Aparece «Tarea programada.» y la tarjeta muestra la próxima corrida. El resultado de cada corrida queda en {{Corridas}}.",
          ],
          errors: [
            {
              message: "Describí la tarea (mínimo 10 caracteres).",
              fix: "Escribí un pedido más completo.",
            },
            {
              message: "Poné un nombre.",
              fix: "Completá el nombre.",
            },
            {
              message:
                "Llegaste al máximo de … tareas activas. Pausá o borrá alguna.",
              fix: "Pausá o borrá una tarea que ya no uses y volvé a programar.",
            },
          ],
          related: ["pausar-tarea-ia"],
          keywords: [
            "programar",
            "automático",
            "recurrente",
            "resumen semanal",
            "workflow",
          ],
        },
        {
          id: "pausar-tarea-ia",
          title: "Pausar, reanudar o borrar una tarea de IA",
          permission: "ai:chat",
          steps: [
            "En [[/ai/tasks]], usá el interruptor de la tarjeta para pausarla ({{Pausar tarea}}) o reanudarla ({{Reanudar tarea}}).",
            "Para borrarla, hacé clic en el tacho ({{Borrar tarea}}) y confirmá con {{Borrar}}.",
          ],
          after: [
            "Una tarea pausada no corre y su tarjeta dice «pausada». Al borrarla aparece «Tarea borrada.» y se borran también sus corridas y su memoria; no se puede deshacer.",
          ],
          errors: [
            {
              message: "No se encontró la tarea.",
              fix: "Ya se borró: recargá la página.",
            },
          ],
          related: ["programar-tarea-ia"],
          keywords: ["pausar", "borrar", "desactivar"],
        },
      ],
    },
    {
      id: "documentos",
      title: "Documentos",
      menuPath: "Inteligencia › Documentos",
      routes: ["/documentos"],
      permission: "ai:read",
      intro: [
        "Subís un comprobante escaneado o una foto y la IA detecta qué es, extrae los datos y, después de que los revisás, te deja crear el registro desde ahí: la factura de compra, el recibo, la orden de pago, los cheques o la factura de venta.",
        "Las pestañas filtran por estado: {{Pendientes}}, {{Confirmados}}, {{Descartados}} y {{Fallidos}}. La lista muestra {{Archivo}}, {{Tipo}}, {{Contraparte}} (el cliente o proveedor encontrado por CUIT), {{Confianza}}, {{Estado}} y {{Creado}}.",
        "Ves los documentos que escaneaste vos; owner y admin ven los de todos.",
      ],
      screens: [
        {
          kind: "page",
          title: "Documentos",
          tabs: {
            labels: ["Pendientes", "Confirmados", "Descartados", "Fallidos"],
            active: 0,
          },
          table: {
            columns: [
              "Archivo",
              "Tipo",
              "Contraparte",
              "Confianza",
              "Estado",
              "Creado",
              "",
            ],
            rows: [
              [
                "~factura-ypf.pdf",
                "~Factura de compra",
                "~YPF S.A.",
                "~Alta",
                "~Pendiente",
                "~05/11/2026",
                "~Revisar",
              ],
              [
                "~cheque.jpg",
                "~Cheque",
                "~—",
                "~Media",
                "~Pendiente",
                "~05/11/2026",
                "~Revisar",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Qué tipos reconoce",
          body: [
            "{{Factura de compra}}, {{Factura de venta}}, {{NC / ND}}, {{Recibo}}, {{Orden de pago}}, {{Remito}}, {{Cheque}} y {{Extracto bancario}}; lo demás queda como {{Otro}}.",
            "La {{Confianza}} ({{Alta}}, {{Media}}, {{Baja}}) indica cuán segura está la IA de la lectura: con confianza baja, revisá cada dato con el archivo al lado.",
          ],
        },
        {
          title: "Siempre del lado fiscal",
          body: [
            "Un comprobante escaneado tiene CUIT y es fiscal: los formularios que se abren desde la revisión ofrecen solo el lado fiscal (ver [[#canales-fiscal-interno]]).",
          ],
        },
      ],
      tasks: [
        {
          id: "escanear-documento",
          title: "Escanear un documento",
          permission: ["ai:read", "files:write"],
          steps: [
            "En [[/documentos]], arrastrá el archivo al recuadro {{Escaneá o subí una factura, recibo u orden de pago}}, o hacé clic en {{Elegir archivo}}. En el celular podés usar {{Tomar foto}}.",
            "Esperá a que se lea: en la lista, la columna {{Tipo}} muestra «Leyendo…» hasta que termina.",
          ],
          after: [
            "Aparece «Documento en proceso…». Cuando la IA termina, el documento queda en {{Pendientes}} con su tipo, la contraparte encontrada por CUIT y la confianza. Si no se pudo leer, queda en {{Fallidos}}.",
            "El archivo queda guardado y se ve en [[/files]] como {{Documento escaneado}}.",
          ],
          errors: [
            {
              message: "El archivo supera 10 MB.",
              fix: "Escaneá en menor resolución y volvé a subirlo.",
            },
            {
              message: "Tipo no permitido (…).",
              fix: "Subí un PDF o una imagen.",
            },
            {
              message:
                "Alcanzaste el límite de escaneos con IA. Probá más tarde.",
              fix: "Hiciste muchos escaneos seguidos: esperá un rato.",
            },
            {
              message:
                "Se alcanzó el límite diario de IA. Probá de nuevo mañana.",
              fix: "Se usó todo el consumo de IA del día: volvé a escanear mañana.",
            },
            {
              message: "No tenés permiso para escanear documentos.",
              fix: "Pedile el escaneo a alguien con acceso a Documentos y permiso para subir archivos.",
            },
          ],
          related: ["revisar-documento", "adjuntar-archivo-al-asistente"],
          keywords: [
            "escanear",
            "OCR",
            "leer factura",
            "foto de factura",
            "digitalizar",
          ],
        },
        {
          id: "revisar-documento",
          title: "Revisar lo que leyó la IA",
          permission: "ai:read",
          steps: [
            "En [[/documentos]] ({{Pendientes}}), hacé clic en {{Revisar}} en la fila del documento.",
            "Se abre el panel con los datos extraídos y, en pantallas grandes, el archivo al lado para compararlos.",
            "Fijate los avisos de arriba: el tipo, la confianza, la contraparte encontrada, {{Posible duplicado}} si ya parece cargado, y la cuenta de gasto sugerida en las compras.",
            "Abajo está la acción para crear el registro (ver las tareas siguientes).",
          ],
          after: [
            "Si el cliente o proveedor no se encontró por CUIT, la revisión lo avisa: cargalo y volvé a escanear el documento.",
            "Si tu usuario no tiene el permiso para crear ese registro, la revisión muestra el motivo en lugar del botón.",
          ],
          errors: [
            {
              message: "No se pudo cargar la extracción.",
              fix: "Hacé clic en Reintentar o volvé a abrir la revisión.",
            },
          ],
          keywords: ["revisar", "extracción", "datos leídos"],
        },
        {
          id: "cargar-compra-desde-documento",
          title: "Cargar una factura de compra (o NC/ND de compra) escaneada",
          permission: ["ai:read", "purchase_invoices:write"],
          prerequisites: [
            "Un documento detectado como {{Factura de compra}} o {{NC / ND}}, ya revisado ([[#revisar-documento]]).",
          ],
          steps: [
            "En la revisión, hacé clic en {{Revisar y cargar factura de compra}} (o {{Revisar y cargar NC/ND de compra}}).",
            "Se abre {{Cargar factura de compra}} con los datos leídos y el archivo al lado. Revisá y corregí lo que haga falta, como en la carga manual de una compra.",
            "Guardá la compra.",
          ],
          after: [
            "La compra queda cargada con el archivo adjunto y el documento pasa a {{Confirmados}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para cargar compras.",
              fix: "La revisión muestra este aviso en lugar del botón: pedile la carga a alguien de Finanzas, Admin u Owner.",
            },
          ],
          keywords: [
            "factura de proveedor",
            "compra escaneada",
            "cargar compra",
          ],
        },
        {
          id: "crear-recibo-desde-documento",
          title: "Crear un recibo o una orden de pago desde un documento",
          permission: {
            anyOf: ["receipts:write", "payment_orders:write"],
          },
          prerequisites: [
            "Un documento detectado como {{Recibo}} (con el cliente encontrado) o como {{Orden de pago}} (con el proveedor encontrado).",
            "Además del acceso a Documentos (`ai:read`), necesitás `receipts:write` para el recibo o `payment_orders:write` para la orden de pago, y poder ver las cuentas.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Crear recibo",
              description:
                "Revisá los datos extraídos y elegí la cuenta donde entró la plata. La imputación a facturas es automática (FIFO).",
              fields: [
                { label: "Canal", kind: "select", value: "Fiscal" },
                { label: "Número", kind: "input", value: "0001-00001234" },
                { label: "Fecha de cobro", kind: "date", value: "05/11/2026" },
                { label: "Importe", kind: "money", value: "$ 150.000,00" },
                { label: "Moneda", kind: "select", value: "ARS" },
                {
                  label: "Cuenta de cobro",
                  kind: "select",
                  value: "Banco Galicia",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Crear recibo", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la revisión, hacé clic en {{Crear recibo}} (o {{Crear orden de pago}}).",
            "Revisá {{Canal}}, {{Número}}, la fecha, {{Importe}} y {{Moneda}}, y elegí la cuenta: {{Cuenta de cobro}} para el recibo, {{Cuenta de pago}} para la orden de pago.",
            "Hacé clic en {{Crear recibo}} (o {{Crear orden de pago}}).",
          ],
          after: [
            "Aparece «Recibo creado.» u «Orden de pago creada.». El movimiento entra (o sale) de la cuenta elegida y se imputa solo a los comprobantes pendientes, del más viejo al más nuevo. El documento pasa a {{Confirmados}}.",
          ],
          errors: [
            {
              message:
                "No se encontró el … por CUIT. Cargá el … y volvé a escanear para crear el documento automáticamente.",
              fix: "La revisión muestra este aviso en lugar del botón: cargá el cliente o proveedor con ese CUIT y volvé a escanear el documento.",
            },
            {
              message: "La extracción ya fue procesada.",
              fix: "Ya se creó el registro de este documento: buscalo en Recibos u Órdenes de pago.",
            },
          ],
          keywords: [
            "recibo escaneado",
            "orden de pago escaneada",
            "cobranza",
            "pago",
          ],
        },
        {
          id: "crear-cheques-desde-documento",
          title: "Cargar cheques escaneados en cartera",
          permission: ["ai:read", "cheques:write"],
          prerequisites: [
            "Un documento detectado como {{Cheque}}, y poder mover caja y ver las cuentas.",
          ],
          steps: [
            "En la revisión, hacé clic en {{Crear cheques en cartera}} (muestra cuántos cheques leyó).",
            "En {{Canal}}, elegí el canal de los cheques (viene el de la vista). En {{Cuenta de cartera}}, elegí la cuenta donde quedan. Si querés, completá {{Endosante (opcional)}}: quién te los entregó.",
            "Revisá cada cheque ({{Banco}}, {{Serie}}, {{Número}}, {{Librador}}, {{CUIT librador}}, {{Importe}}, {{Emisión}}, {{Pago / vto}}, {{Moneda}}) y corregí lo que haga falta.",
            "Hacé clic en el botón **Crear N cheques**.",
          ],
          after: [
            "Aparece «… cheque(s) creados en cartera.»: los cheques quedan en cartera en la cuenta elegida, con su canal, su ingreso en la cuenta y el archivo adjunto, igual que con {{Nuevo cheque}}, y el documento pasa a {{Confirmados}}.",
          ],
          errors: [
            {
              message: "Elegí la cuenta de cartera.",
              fix: "Elegí una cuenta en Cuenta de cartera.",
            },
            {
              message: "Elegí el canal.",
              fix: "Elegí un canal en Canal.",
            },
            {
              message: "… cheque(s) no se pudieron crear (cheque …: …)",
              fix: "Los demás se crearon. El mensaje dice qué pasó con el primero que falló (por ejemplo, «Ya existe un cheque … para …» si el número ya está cargado con ese banco). Corregilo y cargá los que faltan desde Cheques recibidos.",
            },
            {
              message: "No tenés permiso para cargar cheques.",
              fix: "La revisión muestra este aviso en lugar del botón: pedile la carga a alguien con permiso sobre cheques.",
            },
          ],
          keywords: ["cheque escaneado", "cartera", "foto de cheque"],
        },
        {
          id: "emitir-factura-desde-documento",
          title: "Emitir una factura de venta a partir de un documento",
          summary:
            "Emite un comprobante nuevo con los datos leídos (por ejemplo, de una factura armada fuera del sistema).",
          permission: ["ai:read", "invoices:issue"],
          prerequisites: [
            "Un documento detectado como {{Factura de venta}} con el cliente encontrado por CUIT, y un punto de venta habilitado.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Emitir factura de venta",
              description:
                "Se emite un comprobante nuevo por el flujo normal (AFIP en canales fiscales) con la numeración que corresponda — el número del escaneo no se reutiliza.",
              fields: [
                { label: "Canal", kind: "select", marker: 2 },
                {
                  label: "Punto de venta",
                  kind: "select",
                  value: "00003",
                  marker: 2,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Emitir factura", variant: "primary", marker: 3 },
              ],
            },
          ],
          steps: [
            "En la revisión, hacé clic en {{Emitir factura de venta}}.",
            "Revisá cliente, fecha, total e ítems, y elegí {{Canal}} y {{Punto de venta}}.",
            "Hacé clic en {{Emitir factura}}.",
          ],
          after: [
            "Aparece «Factura enviada a emisión.»: se emite por el flujo normal de comprobantes (con CAE de AFIP en el canal fiscal) y el documento pasa a {{Confirmados}}.",
            "Si el comprobante ya estaba registrado en el sistema (o no se pudo verificar), el botón queda deshabilitado para no emitirlo dos veces.",
          ],
          errors: [
            {
              message: "El cliente no tiene CUIT cargado.",
              fix: "Completá el CUIT en la ficha del cliente.",
            },
            {
              message: "El cliente no tiene condición de IVA válida.",
              fix: "Completá la condición de IVA en la ficha del cliente.",
            },
            {
              message: "No tenés permiso para emitir facturas.",
              fix: "La revisión muestra este aviso en lugar del botón: pedile la emisión a alguien con permiso para emitir comprobantes.",
            },
          ],
          keywords: ["facturar desde escaneo", "factura de venta escaneada"],
        },
        {
          id: "ver-carga-de-remito",
          title: "Encontrar la carga de un remito escaneado",
          permission: "ai:read",
          steps: [
            "Revisá un documento detectado como {{Remito}}.",
            "Abajo, en «Carga del remito …», aparecen las cargas que tienen ese número de remito; hacé clic en una para abrirla en Cargas. Si ninguna lo tiene, usá {{Ir a Cargas}}.",
          ],
          after: [
            "El remito no crea nada: sirve para encontrar la carga. Los extractos bancarios tampoco crean nada desde acá: se concilian en Conciliación.",
          ],
          keywords: ["remito", "carga", "buscar carga"],
        },
        {
          id: "descartar-documento",
          title: "Descartar un documento",
          permission: "ai:read",
          steps: [
            "En [[/documentos]], en la fila del documento, hacé clic en el tacho ({{Descartar}}).",
            "Confirmá con {{Descartar}}.",
          ],
          after: [
            "El documento pasa a {{Descartados}}: no se crea nada y el archivo queda subido.",
          ],
          errors: [
            {
              message: "La extracción no existe o ya fue procesada.",
              fix: "Ya se confirmó o descartó: mirá las otras pestañas.",
            },
          ],
          keywords: ["descartar", "borrar documento", "ignorar"],
        },
      ],
    },
  ],
};
