import type { GuidePage } from "../types";

import { importerFormatConcepts } from "./importer-formats";

// Administración: users and per-user access, the AFIP padrón, points of sale
// and AFIP/ARCA setup, the PDF preview, the importer, the audit log and the
// database backups.

export const adminPage: GuidePage = {
  file: "admin.html",
  title: "Administración",
  lead: "Usuarios y accesos, consultas y configuración de AFIP, el importador de planillas, la auditoría y los backups.",
  sections: [
    // ── Usuarios ───────────────────────────────────────────────────────────
    {
      id: "admin-usuarios",
      title: "Usuarios",
      menuPath: "Admin › Usuarios",
      routes: ["/admin/users"],
      permission: "users:read",
      intro: [
        "Lista a los miembros del equipo con sus roles. Desde acá se invita a usuarios nuevos y se editan los roles y los accesos de cada uno. Qué hace cada rol y cómo funcionan los accesos por usuario está en [[#roles-y-permisos]].",
        "La tabla muestra {{Email}} (tu propia cuenta lleva la marca {{Vos}}), {{Roles}} (el de más jerarquía resaltado; {{Sin roles}} si no tiene ninguno), {{Último acceso}} y {{Creado}}. Arriba, {{Buscar por email}} filtra la lista mientras escribís.",
        "En una instalación nueva, sin ningún owner todavía, el primer usuario creado que abre esta pantalla pasa a ser owner automáticamente.",
      ],
      screens: [
        {
          kind: "page",
          title: "Usuarios",
          subtitle: "Gestioná los miembros del equipo y sus roles.",
          actions: [{ label: "Invitar usuario", variant: "primary" }],
          toolbar: [{ label: "Buscar por email", kind: "input" }],
          table: {
            columns: ["Email", "Roles", "Último acceso", "Creado"],
            rows: [
              [
                "~maria@jouve.com.ar",
                "~Finanzas",
                "~04/11/2026 09:12",
                "~01/03/2026 10:00",
              ],
              [
                "~juan@jouve.com.ar",
                "~Operaciones",
                "~03/11/2026 18:40",
                "~15/05/2026 11:20",
              ],
            ],
            rowMenu: true,
          },
        },
      ],
      tasks: [
        {
          id: "invitar-usuario",
          title: "Invitar a un usuario",
          summary:
            "Manda un mail de activación y deja asignados los roles con los que va a entrar.",
          permission: ["users:invite", "users:assign_role"],
          prerequisites: [
            "Ser owner o admin. El botón solo aparece si podés asignar al menos un rol: un admin no puede dar el rol owner ni un rol que traiga algo que a él le denegaron.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Invitar usuario",
              description:
                "Se enviará un mail de activación. Los roles se asignan al confirmarse la cuenta.",
              fields: [
                {
                  label: "Email",
                  kind: "input",
                  value: "nuevo@jouve.com.ar",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Roles iniciales",
                  kind: "checkbox",
                  value: "Finanzas",
                  marker: 3,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Enviar invitación", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/admin/users]], hacé clic en {{Invitar usuario}}.",
            "En {{Email}}, escribí el mail de la persona.",
            {
              text: "En {{Roles iniciales}}, tildá uno o más roles.",
              substeps: [
                "Cada rol muestra su descripción. Los que no podés asignar aparecen deshabilitados con la aclaración «No podés cambiarlo.».",
                "Tiene que quedar al menos un rol tildado.",
              ],
            },
            "Hacé clic en {{Enviar invitación}}.",
          ],
          after: [
            "La persona recibe un mail para activar su cuenta y aparece en la lista con los roles elegidos. El sistema muestra {{Invitación enviada.}}",
            "Queda registrado en [[/admin/audit]] como `user.invited`, y los roles asignados como `user.roles.updated`.",
            "Para recortarle módulos después, usá [[#editar-accesos-usuario]].",
          ],
          errors: [
            {
              message: "Email y al menos un rol son obligatorios.",
              fix: "Completá el mail y tildá al menos un rol.",
            },
            {
              message: "Datos inválidos.",
              fix: "Revisá que el mail esté bien escrito.",
            },
            {
              message: "No podés asignar alguno de esos roles.",
              fix: "Destildá el rol que no podés dar (por ejemplo, owner si sos admin) o pedile la invitación al owner.",
            },
            {
              message: "No podés invitarte a vos mismo.",
              fix: "Usá el mail de la otra persona.",
            },
            {
              message: "Ya estaba invitado; editá sus accesos.",
              fix: "La cuenta ya existe con roles: cambiáselos con {{Accesos}} en su fila.",
            },
            {
              message: "No se pudo enviar la invitación.",
              fix: "Revisá el mail y probá de nuevo en un rato.",
            },
            {
              message: "Usuario invitado pero no se asignaron roles.",
              fix: "La invitación salió pero sin roles: asignáselos con {{Accesos}} en su fila.",
            },
            {
              message: "No tenés permiso para invitar usuarios.",
              fix: "Pedile la invitación a un owner o admin.",
            },
          ],
          related: ["editar-accesos-usuario", "roles-y-permisos"],
          keywords: [
            "alta de usuario",
            "nuevo usuario",
            "dar acceso",
            "invitación",
            "agregar empleado al sistema",
          ],
        },
        {
          id: "editar-accesos-usuario",
          title: "Cambiar los roles o los accesos de un usuario",
          summary:
            "Sumar o quitar roles, y (solo el owner) ocultarle módulos enteros o denegarle acciones puntuales.",
          permission: { anyOf: ["users:assign_role", "users:manage_access"] },
          prerequisites: [
            "Ser owner o admin. Cambiar roles lo pueden hacer owner y admin (un admin no toca el rol owner); denegar módulos y acciones lo hace solo el owner.",
            "Nadie edita sus propios accesos: tu fila no tiene el menú.",
          ],
          screens: [
            {
              kind: "menu",
              caption: "En la fila del usuario",
              trigger: "⋯",
              items: [{ label: "Accesos", marker: 1 }],
            },
            {
              kind: "dialog",
              title: "Accesos",
              description: "maria@jouve.com.ar",
              fields: [
                {
                  label: "Roles",
                  kind: "checkbox",
                  value: "Finanzas",
                  marker: 2,
                  wide: true,
                },
                {
                  label: "Ocultar módulo",
                  kind: "checkbox",
                  value: "Recursos humanos",
                  marker: 3,
                },
                {
                  label: "Denegar",
                  kind: "checkbox",
                  value: "Anular · Comprobantes emitidos",
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/admin/users]], en la fila del usuario, abrí el menú ⋯ y elegí {{Accesos}}.",
            {
              text: "En {{Roles}}, tildá los roles que querés sumar y destildá los que querés quitar.",
              substeps: [
                "Los roles que no podés cambiar aparecen deshabilitados.",
                "Para dar más acceso, sumá un rol; para recortarlo, usá la sección de abajo.",
              ],
            },
            {
              text: "Si sos owner, en {{Módulos y acciones}} recortá lo que el rol trae.",
              substeps: [
                "Cada módulo lista las acciones que le dan sus roles (por ejemplo «Ver», «Crear y editar», «Anular») y de qué rol viene cada una.",
                "{{Ocultar módulo}} quita el módulo entero: desaparece del menú y se quitan todas sus acciones.",
                "{{Denegar}} en una acción quita solo esa acción. Lo denegado se ve tachado.",
                "Arriba se ve cuántos permisos le quedan del total que dan sus roles.",
                "Si el usuario tiene el rol owner no se le puede denegar nada: el diálogo lo avisa.",
              ],
            },
            "Hacé clic en {{Guardar}}. Se habilita solo si cambiaste algo.",
          ],
          after: [
            "El sistema muestra {{Accesos actualizados.}} y la lista se actualiza.",
            "Los cambios de roles quedan en [[/admin/audit]] como `user.roles.updated`, y los de módulos y acciones como `user.access.updated`.",
            "Las denegaciones rigen en la aplicación: datos relacionados pueden verse en otros módulos que los muestran con su propio permiso.",
            "Si el usuario pasa a ser owner, se le borran todas las denegaciones.",
          ],
          errors: [
            {
              message: "Otro cambio se guardó antes; recargá los accesos.",
              fix: "Alguien cambió los accesos mientras editabas. En el aviso del diálogo hacé clic en {{Recargar}} (se pierden tus cambios) y volvé a hacerlos.",
            },
            {
              message: "No podés editar tus propios accesos.",
              fix: "Pedile el cambio a otro owner o admin.",
            },
            {
              message: "No podés modificar ese rol.",
              fix: "Un admin no puede dar ni quitar el rol owner, ni dar un rol con algo que a él le denegaron: pedíselo al owner.",
            },
            {
              message: "Tiene que quedar al menos un usuario con rol owner.",
              fix: "No le quites el rol owner al último owner: primero dáselo a otra persona.",
            },
            {
              message: "No tenés permiso para modificar roles.",
              fix: "Pedile el cambio a un owner o admin.",
            },
            {
              message: "No tenés permiso para modificar accesos.",
              fix: "Solo el owner deniega módulos y acciones.",
            },
            {
              message: "No se pudieron leer los accesos.",
              fix: "Cerrá el diálogo y volvé a abrirlo.",
            },
            {
              message: "Actualización pendiente; reintentá en unos minutos.",
              fix: "El sistema se está actualizando: probá de nuevo en unos minutos.",
            },
            {
              message: "No se pudieron guardar los accesos.",
              fix: "Probá de nuevo; si sigue, avisá a soporte.",
            },
          ],
          related: ["invitar-usuario", "roles-y-permisos"],
          keywords: [
            "cambiar rol",
            "quitar permiso",
            "denegar",
            "ocultar módulo",
            "sacar acceso",
            "permisos por usuario",
            "dar de baja usuario",
          ],
        },
      ],
    },

    // ── Padrón AFIP ────────────────────────────────────────────────────────
    {
      id: "admin-padron-afip",
      title: "Padrón AFIP",
      menuPath: "Admin › Padrón AFIP",
      routes: ["/admin/padron"],
      permission: "padron:lookup",
      intro: [
        "Consulta directa a la constancia de inscripción de AFIP (A5) de un CUIT. Sirve para ver los datos fiscales de un contribuyente (razón social, condición de IVA, domicilio, impuestos) tal como los devuelve AFIP, sin crear nada en el sistema.",
        "Cada consulta queda guardada 24 horas: repetirla en ese plazo no vuelve a llamar a AFIP. Hay un límite de 60 consultas por hora por usuario.",
      ],
      tasks: [
        {
          id: "consultar-padron-afip",
          title: "Consultar un CUIT en el padrón",
          permission: "padron:lookup",
          screens: [
            {
              kind: "page",
              title: "Padrón AFIP",
              subtitle:
                "Consulta directa a la constancia de inscripción de AFIP (A5). Cacheada 24 h y limitada a 60 consultas/hora por usuario.",
              toolbar: [
                {
                  label: "CUIT",
                  kind: "input",
                  value: "30-71463743-2",
                  marker: 1,
                },
              ],
              actions: [{ label: "Consultar", variant: "primary", marker: 2 }],
            },
          ],
          steps: [
            "En [[/admin/padron]], escribí el CUIT en {{CUIT}} (con o sin guiones).",
            "Hacé clic en {{Consultar}}.",
          ],
          after: [
            "Abajo aparecen los datos que devolvió AFIP, tal cual llegan (en formato técnico). La marca {{cache}} indica que vienen de una consulta de las últimas 24 horas.",
            "Si AFIP no responde pero había una consulta anterior guardada, se muestra esa con la marca {{stale (AFIP no disponible)}}: puede estar desactualizada.",
          ],
          errors: [
            {
              message:
                "CUIT inválido — debe tener 11 dígitos y empezar con 2 o 3.",
              fix: "Revisá el número: son 11 dígitos y empieza con 2 o 3.",
            },
            {
              message: "El CUIT … no existe en el padrón de AFIP.",
              fix: "Verificá el número con el contribuyente.",
            },
            {
              message:
                "El CUIT … no está en el padrón de homologación de AFIP, que solo tiene datos de prueba.",
              fix: "El sistema está conectado al ambiente de prueba de AFIP: solo encuentra CUIT de prueba.",
            },
            {
              message: "CUIT … no encontrado en el padrón de AFIP.",
              fix: "Verificá el número con el contribuyente.",
            },
            {
              message: "AFIP no emite constancia para el CUIT …: …",
              fix: "AFIP explica el motivo (por ejemplo, sin impuestos activos). El contribuyente tiene que regularizarlo en AFIP.",
            },
            {
              message:
                "El padrón de AFIP no respondió (HTTP …). Probá de nuevo en un rato.",
              fix: "AFIP está caído o lento: reintentá más tarde.",
            },
            {
              message: "Llegaste al límite de … consultas al padrón por hora.",
              fix: "Se permiten 60 consultas por hora: esperá los segundos que indica «Reintentar en …».",
            },
            {
              message:
                "No se pudo verificar el límite de consultas al padrón. Probá de nuevo.",
              fix: "Reintentá en un momento.",
            },
            {
              message: "No tenés permiso para consultar el padrón.",
              fix: "Pedile la consulta a alguien de Finanzas, admin u owner.",
            },
          ],
          keywords: [
            "constancia de inscripción",
            "consultar CUIT",
            "AFIP",
            "ARCA",
            "condición de IVA",
            "razón social",
          ],
        },
      ],
    },

    // ── Accesos ────────────────────────────────────────────────────────────
    {
      id: "admin-accesos",
      title: "Accesos",
      menuPath: "Admin › Accesos",
      routes: ["/admin/accesos"],
      permission: "afip:admin",
      intro: [
        "Los usuarios con los que JouveERP entra solo a servicios externos, todos en un lugar. Cada bloque dice si funciona y cuándo entró por última vez, y {{Cambiar}} (o {{Configurar}} la primera vez) carga el usuario y la clave.",
        "{{Usuario de ARCA para Mis Comprobantes}}: con el que se bajan los comprobantes recibidos a [[/purchases/arca]].",
        "{{Usuario de Strix para los km de la flota}}: con el que se traen los km de cada vehículo a [[/vehicle-km]] (ver [[#editar-km-mensual]]).",
        "Cada bloque lo ve quien administra ese servicio (hoy, owner y admin). Si ARCA o Strix no están configurados o quedaron pausados, el aviso de [[/purchases/arca]] o de [[/vehicle-km]] manda acá.",
        "Las claves se guardan cifradas y no se vuelven a mostrar. Si un servicio rechaza la clave, JouveERP deja de intentar hasta que se vuelva a cargar acá.",
      ],
      tasks: [
        {
          id: "configurar-usuario-arca",
          title: "Configurar el usuario de ARCA para Mis Comprobantes",
          summary:
            "El usuario con clave fiscal con el que el sistema baja de ARCA los comprobantes recibidos.",
          permission: "afip:admin",
          prerequisites: [
            "Un usuario de ARCA al que DZ & Sons le delegó solo el servicio Mis Comprobantes.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Usuario de ARCA para Mis Comprobantes",
              description:
                "Usá un usuario al que DZ & Sons le delegó solo el servicio Mis Comprobantes. La clave se guarda cifrada y no se vuelve a mostrar.",
              fields: [
                {
                  label: "CUIT del usuario",
                  kind: "input",
                  value: "20-12345678-9",
                  marker: 2,
                },
                {
                  label: "Clave fiscal",
                  kind: "input",
                  value: "••••••••",
                  marker: 3,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "Guardar", variant: "primary", marker: 4 },
              ],
            },
          ],
          steps: [
            "En [[/admin/accesos]], en el bloque {{Usuario de ARCA para Mis Comprobantes}}, hacé clic en {{Configurar}} (o en {{Cambiar}} si ya hay uno).",
            "En {{CUIT del usuario}}, escribí el CUIT de la persona que entra a ARCA.",
            "En {{Clave fiscal}}, escribí su clave. Si solo cambiás el CUIT de un usuario que funciona, podés dejarla vacía para no cambiarla.",
            "Hacé clic en {{Guardar}}.",
          ],
          after: [
            "El sistema muestra {{Usuario de ARCA guardado.}} La clave se guarda cifrada y no se vuelve a mostrar.",
            "El bloque muestra el estado: {{Sin configurar}}, funcionando con la fecha del último ingreso, o pausado si ARCA rechazó la clave o falló dos veces (en ese caso hay que volver a cargar la clave).",
            "Queda registrado en [[/admin/audit]] como `afip.arca_web_credentials_saved`, sin la clave.",
          ],
          errors: [
            {
              message: "CUIT inválido.",
              fix: "Revisá el CUIT.",
            },
            {
              message: "Falta la clave.",
              fix: "La primera vez hay que cargar la clave.",
            },
            {
              message:
                "JouveERP dejó de entrar a ARCA con esta clave: cargá la clave para volver a intentar.",
              fix: "Escribí la clave actual (o la nueva, si la cambiaste en ARCA) y guardá.",
            },
            {
              message: "La clave es demasiado larga.",
              fix: "Revisá lo que escribiste en {{Clave fiscal}}.",
            },
            {
              message: "No se pudo guardar el usuario de ARCA.",
              fix: "Probá de nuevo en un rato.",
            },
            {
              message: "No tenés permiso para configurar AFIP.",
              fix: "Pedíselo a un owner o admin.",
            },
          ],
          keywords: [
            "clave fiscal",
            "Mis Comprobantes",
            "recibidos",
            "robot ARCA",
            "delegar servicio",
          ],
        },
      ],
    },

    // ── Puntos de venta AFIP ───────────────────────────────────────────────
    {
      id: "admin-puntos-de-venta",
      title: "Puntos de venta AFIP",
      menuPath: "Admin › Puntos de venta",
      routes: ["/admin/afip/puntos-de-venta"],
      permission: "afip:admin",
      intro: [
        "La pantalla de configuración de AFIP/ARCA. Arriba muestra el ambiente ({{Producción}} u {{Homologación}}) y el CUIT con el que se factura, y tiene cuatro bloques:",
        "{{Diagnóstico AFIP}}: las validaciones que tienen que pasar antes de emitir: {{Variables de entorno}}, {{Certificado}} (avisa cuando faltan menos de 30 días para que venza y cuando está vencido), el ticket de acceso a los servicios ({{WSAA — wsfe}} y el del padrón) y el estado del servidor de facturación ({{WSFEv1 — FEDummy}}).",
        "{{Puntos de venta}}: los puntos de venta que AFIP tiene habilitados para el CUIT, con {{Número}}, {{Alias}}, {{Canal}}, {{Habilitado}} y el estado en {{AFIP}} (activo o bloqueado y su tipo de emisión). AFIP solo devuelve los puntos de factura electrónica por web service (WSFEv1); los de Comprobantes en Línea u otros servicios no aparecen.",
        "{{Conciliación con ARCA}}: dos pestañas. {{Ventas}} compara, por punto de venta y tipo de comprobante, el último número autorizado en ARCA contra lo que tiene el sistema. {{Compras}} compara los comprobantes que ARCA lista como recibidos contra las compras fiscales, por año y mes: ver [[#conciliacion-compras-arca]].",
        "Quien carga compras (permiso de escribir compras) sin administrar AFIP entra a esta página y ve solo el bloque {{Conciliación con ARCA}} con la pestaña {{Compras}}; cada pestaña aparece solo para quien la puede ver.",
        "{{CAEA (contingencia)}}: el código anticipado por quincena para emitir con AFIP caído.",
      ],
      screens: [
        {
          kind: "page",
          title: "Puntos de venta AFIP",
          actions: [
            { label: "Refrescar", variant: "outline" },
            { label: "Sincronizar con AFIP", variant: "primary" },
          ],
          table: {
            columns: [
              "Número",
              "Alias",
              "Canal",
              "Habilitado",
              "AFIP",
              "Acciones",
            ],
            rows: [
              ["~00003", "~Jouve fiscal", "~Jouve fiscal", "~Sí", "~Activo"],
              ["~00010", "~Sin asignar", "~—", "~No", "~Activo"],
              [
                "~00001",
                "~Interno Jouve",
                "~Logística Jouve — Interno",
                "~Sí",
                "",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Punto de venta y canal",
          body: [
            "Un punto de venta solo aparece para emitir comprobantes si está asociado a un canal y habilitado. Cada canal tiene un solo punto de venta habilitado a la vez y numera todo con ese: facturas, remitos, NC/ND, recibos y órdenes de pago. Hoy son el 00003 en el canal fiscal y el 00001 en el interno.",
            "Un punto de venta que ya numeró comprobantes, recibos u órdenes de pago en su canal no se puede pasar a otro canal.",
            "El punto 00001 del canal interno no existe en AFIP: la sincronización no lo toca.",
          ],
        },
        {
          title: "Conciliación con ARCA: ventas",
          body: [
            "La pestaña {{Ventas}} del bloque {{Conciliación con ARCA}}, con el cuadro {{Numeración de ventas}}. ARCA numera cada tipo de comprobante sin saltos, así que del 1 al último autorizado todo tiene que estar en el sistema. La tabla muestra {{PV}}, {{Tipo}}, {{Último en ARCA}}, {{Último en el ERP}}, {{Por importar}} (números por encima del último que tiene el sistema), {{Huecos}} (números que faltan por debajo, por ejemplo NC/ND que esperan su factura de origen) y {{Números faltantes}} (los primeros huecos).",
            "Lo que falta se trae con {{Traer de ARCA}} en [[/invoices]].",
          ],
        },
        {
          title: "CAEA",
          body: [
            "El CAEA es un código que AFIP otorga por quincena para emitir desde un punto de venta de contingencia cuando AFIP no responde. El sistema lo pide solo antes de cada quincena (los días 11 y del 24 al 28); los comprobantes emitidos con CAEA se informan a AFIP automáticamente hasta la fecha tope.",
            "La tabla muestra las últimas quincenas con {{Quincena}}, {{CAEA}}, {{Vigencia}} y {{Tope p/ informar}}. Arriba, una marca dice el CAEA vigente o {{Sin CAEA vigente}}, y otra cuántos comprobantes faltan informar.",
          ],
        },
      ],
      tasks: [
        {
          id: "sincronizar-puntos-de-venta",
          title: "Sincronizar los puntos de venta con AFIP",
          summary:
            "Trae de AFIP los puntos de venta habilitados para el CUIT y su estado.",
          permission: "afip:admin",
          steps: [
            "En [[/admin/afip/puntos-de-venta]], hacé clic en {{Sincronizar con AFIP}}.",
          ],
          after: [
            "Un aviso dice cuántos puntos se sincronizaron, cuántos son nuevos y cuántos se actualizaron. Los nuevos entran sin canal y deshabilitados: configuralos con [[#configurar-punto-de-venta]].",
            "Un punto de venta asignado a un canal interno no se toca.",
            "Queda registrado en [[/admin/audit]] como `afip.pos_synced`.",
            "{{Refrescar}}, en cambio, solo vuelve a leer el diagnóstico y la lista sin consultar los puntos de venta en AFIP.",
          ],
          errors: [
            {
              message: "No tenés permiso para administrar AFIP.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message: "Error consultando WSFEv1.",
              fix: "AFIP no respondió: revisá el {{Diagnóstico AFIP}} y reintentá más tarde.",
            },
          ],
          related: ["configurar-punto-de-venta"],
          keywords: ["POS", "punto de venta", "FEParamGetPtosVenta"],
        },
        {
          id: "configurar-punto-de-venta",
          title: "Asignar un punto de venta a un canal",
          summary:
            "Le pone alias, lo asocia a un canal y lo habilita para emitir.",
          permission: "afip:admin",
          prerequisites: [
            "El punto de venta tiene que estar en la lista: [[#sincronizar-puntos-de-venta]].",
          ],
          screens: [
            {
              kind: "dialog",
              title: "~Punto de venta 00003",
              description:
                "Asociá el POS a un canal para que aparezca en el form de emisión.",
              fields: [
                {
                  label: "Alias",
                  kind: "input",
                  value: "Jouve fiscal",
                  marker: 2,
                },
                {
                  label: "Canal",
                  kind: "select",
                  value: "Jouve fiscal",
                  marker: 3,
                },
                {
                  label: "Habilitado para emitir desde JouveERP.",
                  kind: "checkbox",
                  value: "Sí",
                  marker: 4,
                  wide: true,
                },
              ],
              footer: [
                { label: "Cancelar", variant: "ghost" },
                { label: "Guardar", variant: "primary", marker: 5 },
              ],
            },
          ],
          steps: [
            "En [[/admin/afip/puntos-de-venta]], en la fila del punto de venta, hacé clic en el ícono de engranaje ({{Configurar}}).",
            "En {{Alias}}, escribí un nombre para reconocerlo (opcional, hasta 120 caracteres).",
            "En {{Canal}}, elegí el canal o {{Sin asignar}}. Un punto de venta de AFIP lista los canales fiscales activos; uno que no está en AFIP (como el 00001), los internos. El canal actual se ve aunque esté inactivo.",
            "Tildá {{Habilitado para emitir desde JouveERP.}} para que aparezca en el formulario de comprobantes; destildalo para sacarlo.",
            "Hacé clic en {{Guardar}}. Se habilita solo si cambiaste algo.",
          ],
          after: [
            "El sistema muestra {{Configuración guardada.}} Un punto habilitado empieza a usarse para numerar los comprobantes de ese canal.",
            "Queda registrado en [[/admin/audit]] como `afip.pos_configured`.",
          ],
          errors: [
            {
              message: "Para habilitar el POS hay que asignarle un canal.",
              fix: "Elegí un canal en {{Canal}} o destildá la habilitación.",
            },
            {
              message:
                "El canal ya tiene habilitado el POS …. Deshabilitalo antes de habilitar otro.",
              fix: "Configurá primero el otro punto de venta destildando la habilitación, y después habilitá este.",
            },
            {
              message: "El canal no existe o está inactivo.",
              fix: "Elegí un canal activo.",
            },
            {
              message:
                "El POS … ya numeró comprobantes en su canal: no se lo puede cambiar de canal",
              fix: "Dejalo en su canal. Podés cambiarle el alias o deshabilitarlo.",
            },
            {
              message: "El POS … no existe en DB. Sincronizá con AFIP primero.",
              fix: "Hacé [[#sincronizar-puntos-de-venta]] y volvé a intentar.",
            },
            {
              message: "No tenés permiso para administrar AFIP.",
              fix: "Pedíselo a un owner o admin.",
            },
          ],
          related: ["sincronizar-puntos-de-venta"],
          keywords: [
            "habilitar punto de venta",
            "canal fiscal",
            "POS",
            "numeración",
          ],
        },
        {
          id: "conciliar-con-arca",
          title: "Conciliar la numeración con ARCA",
          summary:
            "Verifica que el sistema tenga todos los comprobantes que ARCA autorizó.",
          permission: "afip:admin",
          steps: [
            "En [[/admin/afip/puntos-de-venta]], en el bloque {{Conciliación con ARCA}}, pestaña {{Ventas}}, hacé clic en {{Conciliar con ARCA}}.",
            "Esperá a que termine la consulta y leé el resumen y la tabla.",
          ],
          after: [
            "Si está todo, el resumen dice que el ERP tiene cada comprobante que ARCA autorizó. Si no, dice cuántos faltan importar y cuántos son huecos, y cada fila muestra los primeros huecos en {{Números faltantes}}.",
            "No cambia nada: solo consulta. Lo que falta se trae con {{Traer de ARCA}} en [[/invoices]].",
          ],
          errors: [
            {
              message:
                "No hay puntos de venta fiscales habilitados para conciliar.",
              fix: "Asigná un punto de venta a un canal fiscal y habilitalo: [[#configurar-punto-de-venta]].",
            },
            {
              message: "No se pudo conciliar con ARCA.",
              fix: "Reintentá en un rato; si AFIP está caído, revisá el {{Diagnóstico AFIP}}.",
            },
          ],
          related: ["configurar-punto-de-venta"],
          keywords: [
            "faltan comprobantes",
            "huecos de numeración",
            "último número",
            "ARCA",
          ],
        },
        {
          id: "solicitar-caea",
          title: "Solicitar el CAEA",
          summary:
            "Pide a AFIP el CAEA de la quincena actual y de la siguiente, sin esperar al proceso automático.",
          permission: "afip:admin",
          prerequisites: [
            "Un punto de venta de contingencia CAEA dado de alta en ARCA.",
          ],
          steps: [
            "En [[/admin/afip/puntos-de-venta]], en el bloque {{CAEA (contingencia)}}, hacé clic en {{Solicitar CAEA}}.",
          ],
          after: [
            "Un aviso muestra el CAEA vigente y el de la próxima quincena (o «—» si AFIP todavía no lo otorga). La tabla se actualiza.",
            "Queda registrado en [[/admin/audit]] como `caea.requested`.",
          ],
          errors: [
            {
              message: "No se pudo obtener el CAEA.",
              fix: "AFIP rechazó el pedido. Si AFIP explica el motivo (por ejemplo, que no hay punto de venta CAEA registrado o que la ventana de pedido está cerrada), resolvelo en ARCA y reintentá.",
            },
            {
              message: "No se pudo leer el estado CAEA.",
              fix: "Recargá la pantalla.",
            },
          ],
          keywords: ["contingencia", "AFIP caído", "CAEA", "quincena"],
        },
      ],
    },

    // ── Preview de PDF ─────────────────────────────────────────────────────
    {
      id: "admin-preview-pdf",
      title: "Preview de PDF",
      menuPath: "Admin › Preview PDF",
      routes: ["/admin/afip/preview-pdf"],
      permission: "afip:admin",
      intro: [
        "Muestra el PDF de un comprobante existente sin emitir nada nuevo. Sirve para revisar cómo sale la plantilla. Lista los 50 comprobantes más recientes; si no hay ninguno, lo avisa.",
      ],
      tasks: [
        {
          id: "previsualizar-pdf-comprobante",
          title: "Ver el PDF de un comprobante",
          permission: ["afip:admin", "invoices:read"],
          screens: [
            {
              kind: "page",
              title: "Preview de PDF",
              subtitle:
                "Renderiza el PDF de un comprobante existente sin emitir nada nuevo. Útil para iterar la plantilla.",
              toolbar: [
                {
                  label: "Elegí un comprobante",
                  kind: "select",
                  value: "00003-00000125 · factura A · 2026-11-04 · emitted",
                  marker: 1,
                },
              ],
              actions: [{ label: "Abrir", variant: "outline", marker: 2 }],
            },
          ],
          steps: [
            "En [[/admin/afip/preview-pdf]], elegí el comprobante en la lista (muestra punto de venta y número, tipo, fecha y estado). El PDF se ve abajo.",
            "Para verlo en grande, hacé clic en {{Abrir}}: se abre en una pestaña nueva.",
          ],
          after: [
            "No cambia nada: el PDF se genera de nuevo con los datos guardados del comprobante.",
          ],
          keywords: ["plantilla", "PDF", "factura", "vista previa"],
        },
      ],
    },

    // ── Importador ─────────────────────────────────────────────────────────
    {
      id: "admin-importador",
      title: "Importador",
      menuPath: "Admin › Importador",
      routes: ["/admin/imports"],
      permission: "imports:read",
      intro: [
        "Carga planillas para el arranque: clientes, proveedores, empleados y vehículos; tarifas, préstamos, cheques en cartera y saldos de clientes al arranque; extractos bancarios para conciliar; y sueldos y viajes de antes del sistema como referencia.",
        "La pestaña {{Importaciones}} lista cada importación con {{Fecha}} (y quién la hizo), {{Tipo}}, {{Archivo}}, {{Importadas}}, {{Ya estaban}}, {{Con error}} y {{Estado}} ({{Confirmada}} o {{Deshecha}}, con fecha y quién la deshizo). Las pestañas {{Sueldos históricos}} y {{Viajes históricos}} muestran lo importado de antes del sistema.",
      ],
      screens: [
        {
          kind: "page",
          title: "Importador",
          actions: [{ label: "Importar planilla", variant: "primary" }],
          tabs: {
            labels: [
              "Importaciones",
              "Sueldos históricos",
              "Viajes históricos",
            ],
            active: 0,
          },
          table: {
            columns: [
              "Fecha",
              "Tipo",
              "Archivo",
              "Importadas",
              "Ya estaban",
              "Con error",
              "Estado",
            ],
            rows: [
              [
                "~04/11/2026 10:20",
                "~Clientes",
                "~clientes.xlsx",
                "~182",
                "~3",
                "~2",
                "~Confirmada",
              ],
            ],
          },
        },
      ],
      concepts: [
        {
          title: "Cómo lee la planilla",
          body: [
            "Acepta .xlsx (lee la primera hoja) o .csv, de hasta 4 MB y 5000 filas. Busca la fila de títulos y propone qué columna corresponde a cada dato; los títulos pueden variar (se reconocen sinónimos, listados abajo).",
            "Nada se guarda hasta que confirmás. Cada fila queda {{Lista}}, {{Ya existe}} (ya estaba cargada o se repite en el archivo: se saltea) o {{Con error}} (queda afuera, con el motivo).",
            "En tarifas, préstamos, cheques y saldos iniciales, una fila que se repite en el archivo es un error en todas sus repeticiones: hay que dejar una sola con el importe total.",
            "Importar dos veces el mismo archivo no duplica nada: lo que ya está cargado se saltea, y el diálogo avisa si ese archivo ya se importó antes.",
          ],
        },
        {
          title: "Qué hace cada tipo",
          body: [
            "**Clientes**, **Proveedores**, **Empleados** y **Vehículos** crean los que no existen (se compara por CUIT, CUIL o patente; sin ese dato, por nombre). Un existente no se actualiza. Un empleado chofer crea también su ficha de chofer con la licencia.",
            "**Sueldos históricos** y **Viajes históricos** son solo de referencia: no generan asientos, pagos, facturas, cuenta corriente ni entran en Gestión ni en los libros.",
            "**Tarifas por cliente** crea las tarifas con su vigencia, como el tarifario del cliente.",
            "**Préstamos al arranque** crea los préstamos con sus cuotas pendientes; no registra el desembolso (la deuda entra con el ajuste inicial). Pide el canal.",
            "**Cheques en cartera al arranque** entra los cheques de terceros a la cuenta de cartera elegida con contrapartida en ajustes de caja. Pide la cuenta y el canal. Si ya cargaste el saldo inicial de esa cuenta, no lo dupliques.",
            "**Saldos iniciales de clientes** carga lo que debe cada cliente al corte, en pesos; no crea recibos, movimientos ni asientos.",
            "**Extracto bancario** carga las líneas del extracto de la cuenta elegida para conciliarlas en Tesorería; no crea movimientos.",
            "Las diferencias de saldos se corrigen con el ajuste inicial.",
          ],
        },
        ...importerFormatConcepts(),
      ],
      tasks: [
        {
          id: "importar-planilla",
          title: "Importar una planilla",
          permission: "imports:write",
          prerequisites: [
            "Ser owner o admin. Además, cada tipo pide el permiso de escritura de su módulo (por ejemplo, Clientes pide poder crear clientes); en {{Qué importar}} solo aparecen los tipos que podés importar. **Saldos iniciales de clientes** lo importa solo el owner.",
            "Para cheques y extractos, ver las cuentas de Tesorería.",
            "Para sueldos, tarifas y saldos, que los empleados o clientes ya estén cargados.",
          ],
          screens: [
            {
              kind: "dialog",
              title: "Importar planilla",
              description:
                "Subí un .xlsx (primera hoja) o .csv con una fila de títulos. Nada se guarda hasta que confirmes; las filas con error quedan afuera y las que ya están cargadas se saltean.",
              fields: [
                {
                  label: "Qué importar",
                  kind: "select",
                  value: "Clientes",
                  marker: 2,
                },
                {
                  label: "Archivo",
                  kind: "input",
                  value: "clientes.xlsx",
                  marker: 3,
                },
              ],
              table: {
                columns: ["Fila", "Registro", "Estado"],
                rows: [
                  ["~2", "~Transportes del Sur SA", "~Lista"],
                  ["~3", "~Logística Norte SRL", "~Ya existe"],
                  ["~4", "~Cliente sin CUIT", "~Con error"],
                ],
                marker: 6,
              },
              footer: [
                { label: "Cancelar", variant: "outline" },
                { label: "~Importar 1 fila", variant: "primary", marker: 7 },
              ],
            },
          ],
          steps: [
            "En [[/admin/imports]], hacé clic en {{Importar planilla}}.",
            "En {{Qué importar}}, elegí el tipo. Debajo se ve qué hace ese tipo y qué columnas lee.",
            "En {{Archivo}}, elegí el .xlsx o .csv.",
            {
              text: "Si el tipo lo pide, elegí la cuenta y el canal.",
              substeps: [
                "Cheques en cartera: {{Cuenta de cartera}} (una cuenta de cheques) y {{Canal}}.",
                "Extracto bancario: {{Cuenta del extracto}} (banco, billetera, caja o inversión).",
                "Préstamos: {{Canal}}.",
              ],
            },
            "Hacé clic en {{Leer archivo}}.",
            {
              text: "Revisá el resultado.",
              substeps: [
                "En {{Columnas}}, cada dato muestra la columna elegida; cambiala si está mal o elegí {{No está}}. Las obligatorias llevan * o (falta). Si cambiaste alguna, hacé clic en {{Volver a leer con estas columnas}}.",
                "La línea de conteo dice cuántas filas están listas, ya cargadas y con error.",
                "La tabla muestra cada {{Fila}} con su {{Registro}} y {{Estado}}, y debajo los errores o advertencias de esa fila.",
              ],
            },
            "Hacé clic en el botón **Importar N filas** del pie. Solo se habilita si no faltan columnas, hay filas listas, el archivo no pasa de 5000 filas y no cambiaste columnas sin volver a leer.",
          ],
          after: [
            "Un aviso dice cuántas filas se importaron, cuántas ya estaban y cuántas con error quedaron afuera. La importación aparece en {{Importaciones}} como {{Confirmada}}.",
            "Las filas listas se guardan todas juntas: si una falla, no se guarda ninguna.",
            "Queda registrado en [[/admin/audit]] como `import_run.committed`.",
            "Si algo quedó mal, podés [[#deshacer-importacion]] mientras nadie haya tocado lo importado.",
          ],
          errors: [
            {
              message: "Elegí el archivo.",
              fix: "Elegí un archivo con datos.",
            },
            {
              message: "El archivo supera los 4 MB.",
              fix: "Dividí la planilla en varios archivos.",
            },
            {
              message:
                "El formato .xls no se puede leer: guardalo como .xlsx o .csv.",
              fix: "Abrilo en Excel y guardalo como .xlsx o .csv.",
            },
            {
              message: "Subí el archivo en .xlsx o .csv.",
              fix: "Convertí la planilla a uno de esos formatos.",
            },
            {
              message: "No se pudo leer el Excel.",
              fix: "Abrilo y volvé a guardarlo como .xlsx, o exportalo a .csv.",
            },
            {
              message:
                "No encontramos la fila de títulos: la planilla tiene que tener una fila con los nombres de las columnas.",
              fix: "Agregá una fila con los nombres de las columnas arriba de los datos.",
            },
            {
              message: "Elegí la cuenta.",
              fix: "Elegí la cuenta de cartera o del extracto.",
            },
            {
              message: "Elegí el canal.",
              fix: "Elegí el canal de los préstamos o cheques.",
            },
            {
              message: "Los cheques van a una cuenta de cheques en cartera.",
              fix: "Elegí una cuenta de cheques en {{Cuenta de cartera}}.",
            },
            {
              message:
                "El extracto es de una cuenta de banco, billetera, caja o inversión.",
              fix: "Elegí otra cuenta en {{Cuenta del extracto}}.",
            },
            {
              message: "La cuenta no existe o está inactiva.",
              fix: "Elegí una cuenta activa.",
            },
            {
              message: "El canal no existe o está inactivo.",
              fix: "Elegí un canal activo.",
            },
            {
              message: "Faltan columnas obligatorias.",
              fix: "En {{Columnas}}, elegí la columna de cada dato obligatorio y volvé a leer.",
            },
            {
              message:
                "El archivo tiene más de 5000 filas o celdas muy largas: dividilo y volvé a importar.",
              fix: "Partí la planilla en archivos más chicos.",
            },
            {
              message: "No hay filas nuevas para importar.",
              fix: "Todo ya estaba cargado o tiene errores: corregí las filas con error en la planilla y volvé a leer.",
            },
            {
              message: "No tenés permiso para importar.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message: "No se pudo importar el archivo.",
              fix: "No se guardó nada: probá de nuevo.",
            },
          ],
          related: ["deshacer-importacion"],
          keywords: [
            "importar excel",
            "subir planilla",
            "carga masiva",
            "csv",
            "migración de datos",
            "arranque",
            "saldos iniciales",
            "extracto",
          ],
        },
        {
          id: "deshacer-importacion",
          title: "Deshacer una importación",
          summary:
            "Borra todo lo que trajo una importación, si nadie lo editó ni lo usa.",
          permission: "imports:write",
          prerequisites: [
            "Ser owner o admin, con el permiso de escritura del módulo de ese tipo.",
            "La importación está {{Confirmada}} e importó al menos una fila.",
          ],
          steps: [
            "En [[/admin/imports]], pestaña {{Importaciones}}, en la fila de la importación hacé clic en el ícono {{Deshacer}} (flecha hacia atrás).",
            "En {{Deshacer la importación}}, confirmá con {{Deshacer}}.",
          ],
          after: [
            "Se borran las filas que importó y la importación queda como {{Deshecha}}, con fecha y usuario. El sistema muestra {{Importación deshecha.}}",
            "En cheques, también se borra su entrada a la cartera.",
            "Queda registrado en [[/admin/audit]] como `import_run.undone`. Para volver a cargarlo, importá el archivo de nuevo.",
          ],
          errors: [
            {
              message:
                "No se puede deshacer la importación: algún registro se editó después de importarlo",
              fix: "Lo importado ya se modificó: corregí los registros a mano.",
            },
            {
              message:
                "No se puede deshacer la importación: sus … ya se usan en otros datos (…)",
              fix: "Hay comprobantes, movimientos u otros datos que usan lo importado: corregí a mano.",
            },
            {
              message:
                "No se puede deshacer la importación: alguna tarifa se editó después de importarla",
              fix: "Corregí las tarifas desde el tarifario del cliente.",
            },
            {
              message:
                "No se puede deshacer la importación: ya se facturó almacenaje con estas tarifas",
              fix: "Las tarifas ya se usaron para facturar: cerralas o corregilas desde el tarifario.",
            },
            {
              message:
                "No se puede deshacer la importación: algún préstamo o cuota se editó, se pagó o tiene desembolso",
              fix: "Corregí el préstamo desde su ficha.",
            },
            {
              message:
                "No se puede deshacer la importación: algún cheque se editó o ya salió de la cartera",
              fix: "Corregí los cheques a mano.",
            },
            {
              message:
                "No se puede deshacer la importación: algún saldo inicial se editó después de importarlo",
              fix: "Corregí el saldo inicial desde la ficha del cliente.",
            },
            {
              message:
                "No se puede deshacer la importación: algún cliente ya tiene recibos cargados después de importar su saldo",
              fix: "Corregí el saldo inicial a mano.",
            },
            {
              message:
                "No se puede deshacer la importación: alguna línea del extracto ya está conciliada o marcada como que no corresponde",
              fix: "Desconciliá esas líneas en Tesorería y volvé a intentar.",
            },
            {
              message: "La importación no existe.",
              fix: "Recargá la pantalla.",
            },
            {
              message: "No tenés permiso para importar.",
              fix: "Pedíselo a un owner o admin.",
            },
            {
              message: "No se pudo deshacer la importación.",
              fix: "Probá de nuevo; no se borró nada.",
            },
          ],
          related: ["importar-planilla"],
          keywords: ["revertir importación", "borrar importación", "deshacer"],
        },
        {
          id: "ver-sueldos-historicos",
          title: "Ver los sueldos históricos",
          permission: ["imports:read", "hr:read"],
          steps: [
            "En [[/admin/imports]], abrí la pestaña {{Sueldos históricos}}.",
            "Elegí el año en el selector de la derecha (los últimos 16 años).",
          ],
          after: [
            "Arriba, una tabla resume cada {{Período}} con la cantidad de {{Empleados}}, el {{Neto}} y lo {{Pagado}}. Abajo, el detalle por empleado con {{Tipo}} (mensual o aguinaldo) y {{Pagado el}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para ver los sueldos.",
              fix: "Hace falta poder ver Recursos humanos.",
            },
          ],
          keywords: ["sueldos anteriores", "historial de sueldos"],
        },
        {
          id: "ver-viajes-historicos",
          title: "Ver los viajes históricos",
          permission: ["imports:read", "trips:read"],
          steps: [
            "En [[/admin/imports]], abrí la pestaña {{Viajes históricos}}.",
            "Elegí el mes en el selector de la derecha.",
          ],
          after: [
            "Arriba se ve el total del mes (viajes, km y flete) y abajo cada viaje con {{Fecha}}, {{Vehículo}}, {{Chofer}}, {{Cliente}}, {{Recorrido}}, {{Km}} y {{Flete}}.",
          ],
          errors: [
            {
              message: "No tenés permiso para ver los viajes.",
              fix: "Hace falta poder ver Viajes.",
            },
          ],
          keywords: ["viajes anteriores", "historial de viajes"],
        },
      ],
    },

    // ── Auditoría ──────────────────────────────────────────────────────────
    {
      id: "admin-auditoria",
      title: "Auditoría",
      menuPath: "Admin › Auditoría",
      routes: ["/admin/audit"],
      permission: "audit:read",
      intro: [
        "Quién hizo qué y cuándo: usuarios, el asistente IA (con el usuario que lo pidió) y los procesos automáticos. Los eventos se guardan 400 días.",
        "La tabla muestra {{Fecha}}, {{Quién}} (el usuario, «Asistente IA (por …)» o {{Sistema}}), {{Qué hizo}} en una frase («emitió la Factura A 0003-00022312 a TRANSPORTES SUR SA por $ 1.234.567,00», «registró el Recibo 0001-00000045 de AGRO PAMPA», «programó el viaje del 07/11/2026 con AE463UF») y {{Sobre qué}}: el comprobante, recibo, viaje, cliente o proveedor, con link a su pantalla. Al llegar al final de la lista se cargan solos los eventos siguientes.",
        "Las consultas seguidas que hace el asistente para responder una pregunta se muestran en una sola fila («consultó IVA Ventas, IVA Compras e Impuestos (09/2026)»). Para no verlas, prendé {{Ocultar consultas del asistente}}.",
        "El detalle de una factura, un recibo, una orden de pago, una compra o un viaje también muestra su {{Historial}}: quién lo creó, editó, emitió o anuló y cuándo, con las mismas frases. Lo ve solo quien puede ver la auditoría.",
      ],
      screens: [
        {
          kind: "page",
          title: "Auditoría",
          actions: [{ label: "Exportar CSV", variant: "outline" }],
          toolbar: [
            {
              label: "Buscar",
              kind: "input",
              value: "Transportes Sur, 22312, AE463UF",
              wide: true,
            },
            { label: "Desde", kind: "date" },
            { label: "Hasta", kind: "date" },
            { label: "Usuario", kind: "select", value: "Todos" },
            { label: "Qué", kind: "select", value: "Todo" },
            { label: "Ocultar consultas del asistente", kind: "switch" },
          ],
          table: {
            columns: ["Fecha", "Quién", "Qué hizo", "Sobre qué"],
            rows: [
              [
                "~5 nov 2026, 09:31",
                "~María Gómez",
                "~emitió la Factura A 0003-00022312 a TRANSPORTES SUR SA por $ 1.234.567,00",
                "~Factura A 0003-00022312 · TRANSPORTES SUR SA",
              ],
              [
                "~5 nov 2026, 09:20",
                "~Asistente IA (por Tomás)",
                "~consultó IVA Ventas, IVA Compras e Impuestos (09/2026)",
                "~—",
              ],
            ],
          },
        },
      ],
      tasks: [
        {
          id: "filtrar-auditoria",
          title: "Buscar eventos en la auditoría",
          permission: "audit:read",
          steps: [
            {
              text: "En [[/admin/audit]], usá el buscador y los filtros (se aplican al instante).",
              substeps: [
                "El buscador encuentra los eventos por lo que nombran: un cliente o proveedor («Transportes Sur»), un número de comprobante o recibo («22312») o una patente («AE463UF»). Por ejemplo, para saber quién le hizo una factura a un cliente, escribí el nombre del cliente y elegí {{Qué}} › {{Facturas y notas}}.",
                "{{Desde}} y {{Hasta}}: el rango de fechas. La fecha desde no puede ser posterior a la hasta.",
                "{{Usuario}}: quién lo hizo.",
                "{{Qué}}: el tipo de tarea (Facturas y notas, Recibos, Órdenes de pago, Compras, Viajes y cargas, Clientes, Proveedores, Usuarios y permisos, Asistente IA, Configuración…).",
                "{{Ocultar consultas del asistente}}: saca de la lista lo que el asistente solo leyó para responder.",
              ],
            },
            "Para ver un evento completo, hacé clic en la fila o en {{Ver detalle}}.",
            "Para volver a ver todo, hacé clic en {{Limpiar}}.",
          ],
          after: [
            "El detalle muestra quién, qué hizo y sobre qué, y un {{Detalle técnico}} con los datos del evento (identificadores incluidos). CBU, CUIL, claves y tokens se muestran enmascarados.",
          ],
          errors: [
            {
              message:
                "La fecha desde no puede ser posterior a la fecha hasta.",
              fix: "Corregí el rango de fechas.",
            },
            {
              message: "No tenés permiso para ver la auditoría.",
              fix: "Pedíselo a un owner o admin.",
            },
          ],
          related: ["exportar-auditoria"],
          keywords: [
            "quién hizo",
            "log",
            "historial de cambios",
            "trazabilidad",
            "registro de actividad",
            "quién hizo la factura",
            "quién hizo el recibo",
            "quién programó el viaje",
          ],
        },
        {
          id: "exportar-auditoria",
          title: "Exportar la auditoría a CSV",
          permission: "audit:read",
          steps: [
            "En [[/admin/audit]], aplicá los filtros que quieras.",
            "Hacé clic en {{Exportar CSV}}.",
          ],
          after: [
            "Se descarga un archivo `auditoria-AAAA-MM-DD.csv` con los eventos filtrados (buscador incluido), del más nuevo al más viejo, hasta 10.000 eventos, con las columnas {{Fecha}}, {{Quién}}, {{Qué hizo}} y {{Sobre qué}}.",
          ],
          errors: [
            {
              message: "No hay eventos para exportar con esos filtros.",
              fix: "Ampliá los filtros.",
            },
            {
              message:
                "Se exportaron los … eventos más recientes; acotá las fechas para el resto.",
              fix: "Exportá por tramos de fechas para tener todo.",
            },
            {
              message: "No se pudo exportar la auditoría.",
              fix: "Probá de nuevo.",
            },
          ],
          related: ["filtrar-auditoria"],
          keywords: ["descargar auditoría", "csv", "excel"],
        },
      ],
    },

    // ── Backups ────────────────────────────────────────────────────────────
    {
      id: "admin-backups",
      title: "Backups",
      menuPath: "Admin › Backups",
      routes: ["/admin/backups"],
      permission: "audit:read",
      intro: [
        "Las copias diarias de la base de datos, generadas automáticamente todas las noches (03:00 UTC). Se guardan 30 días; las más viejas se borran solas.",
        "La tabla muestra {{Archivo}} (el más reciente con la marca {{último}}), {{Tamaño}}, {{SHA256}} (para verificar que el archivo no cambió) y {{Subido}}.",
        "Se recomienda una vez por mes restaurar el backup más reciente en un proyecto aparte y verificar que estén los datos.",
      ],
      tasks: [
        {
          id: "descargar-backup",
          title: "Descargar un backup",
          permission: "audit:read",
          prerequisites: ["Ser owner o admin."],
          steps: [
            "En [[/admin/backups]], en la fila del backup, hacé clic en {{Descargar}}.",
          ],
          after: [
            "Se abre la descarga en una pestaña nueva y el sistema muestra {{Link de descarga generado (válido 5 min).}} El link vale 5 minutos.",
            "La descarga queda registrada en [[/admin/audit]] como `backup.downloaded`: es una copia completa de la base.",
          ],
          errors: [
            {
              message: "No se pudo generar URL de descarga.",
              fix: "Probá de nuevo en un rato.",
            },
            {
              message: "Solo owner/admin pueden descargar backups.",
              fix: "Pedíselo a un owner o admin.",
            },
          ],
          keywords: [
            "copia de seguridad",
            "dump",
            "base de datos",
            "restaurar",
          ],
        },
      ],
    },
  ],
};
