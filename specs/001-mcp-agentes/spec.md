# Feature Specification: Conector para asistentes de IA (MCP) de la agenda

**Feature Branch**: `001-mcp-agentes`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "Servidor MCP de la agenda (barberia-saas) para que agentes de IA (Claude, ChatGPT o cualquier cliente MCP) trabajen con el SaaS. Dos usos: (1) una barbería nueva se registra a través de su asistente [...] y queda con la prueba gratis de 14 días, aceptando términos y privacidad igual que en /registro; (2) el dueño de una barbería ya registrada conecta su asistente con su propia cuenta y maneja su barbería: ver la agenda del día, agregar/mover/cancelar citas, ver servicios y paquetes y cambiarlos, ver ventas y resumen. Cada barbería solo ve lo suyo; los barberos solo lo que ya pueden hoy. Los clientes finales NO agendan por el MCP. Debe vivir en el mismo servidor (agendabarberias.xyz/mcp), sin dependencias nuevas salvo que se justifique, y respetar la constitución."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - El dueño maneja su barbería desde su asistente (Priority: P1)

Un dueño ya registrado agrega "Agenda de Barberías" como conector en su asistente (Claude, ChatGPT u otro), entra con
su cuenta del panel en una pantalla de la agenda y desde ese momento le pide cosas en lenguaje normal: "¿qué citas
tengo hoy?", "anota a Luis a las 5 con Pedro para un corte", "mueve la cita de Jorge a mañana a las 11", "cancela la
de las 3", "¿cuánto vendimos esta semana?", "sube el corte clásico a 220".

**Why this priority**: Es el uso de todos los días y el que diferencia al SaaS: la barbería se maneja hablando con
su asistente, sin abrir el panel.

**Independent Test**: Con una barbería de prueba, conectar un cliente MCP con la cuenta del dueño y comprobar que lee
la agenda del día y que una cita creada, movida y cancelada por el asistente aparece igual en el panel.

**Acceptance Scenarios**:

1. **Given** un dueño conectado, **When** pide la agenda de hoy, **Then** recibe las citas del día (hora, cliente, servicio, barbero, estado, precio) en hora de Mérida, iguales a las del panel.
2. **Given** un dueño conectado y un horario libre, **When** pide agendar a un cliente, **Then** la cita queda en la agenda con el precio que calcula la agenda y aparece en el panel.
3. **Given** un horario ocupado, cerrado o pasado, **When** pide agendar ahí, **Then** se rechaza con un mensaje claro y se le ofrecen horarios libres de ese día.
4. **Given** una cita existente, **When** pide moverla o cancelarla, **Then** cambia igual que si lo hubiera hecho en el panel (mismos avisos al cliente y a la lista de espera que hoy).
5. **Given** un dueño conectado, **When** pide cambiar el precio o el nombre de un servicio o paquete, **Then** el cambio se ve en su página y en la agenda.
6. **Given** un dueño conectado, **When** pide ventas o resumen de un periodo (hoy, semana, mes), **Then** recibe las mismas cifras que muestra el panel.
7. **Given** el dueño de la barbería A conectado, **When** el asistente intenta leer o cambiar algo de la barbería B, **Then** no lo logra.
8. **Given** un barbero (no dueño) conectado con su cuenta, **When** pide algo que en el panel solo puede el dueño (ventas, precios, ajustes), **Then** se le niega; sí puede lo que hoy puede en el panel (su agenda y sus citas).

---

### User Story 2 - Una barbería nueva se registra desde un asistente (Priority: P2)

El dueño de una barbería que todavía no usa el SaaS le dice a su asistente "regístrame en Agenda de Barberías". El
asistente le pide el nombre de la barbería, el enlace que quiere, su nombre, su correo y su WhatsApp, revisa que el
enlace esté libre y le abre la pantalla de la agenda donde el dueño pone su contraseña y acepta los términos y el
aviso de privacidad. Al terminar, la barbería queda creada con su prueba gratis de 14 días y el asistente ya queda
conectado a ella (Historia 1).

**Why this priority**: Trae barberías nuevas por un canal nuevo, pero depende de que el manejo (P1) exista para que
valga la pena registrarse así.

**Independent Test**: Desde un cliente MCP sin cuenta, registrar una barbería nueva y comprobar que existe con su
página, su agenda, prueba de 14 días y aceptación de términos registrada, igual que una creada en /registro.

**Acceptance Scenarios**:

1. **Given** un enlace libre y datos válidos, **When** el dueño termina el alta, **Then** la barbería existe con los mismos datos de inicio que una creada en /registro, 14 días de prueba y la fecha de aceptación de términos.
2. **Given** un enlace ocupado o reservado, **When** el asistente lo consulta, **Then** se le dice que no está disponible y se le sugieren alternativas.
3. **Given** datos inválidos (correo, WhatsApp que no sea de 10 dígitos, nombre vacío), **When** se intenta el alta, **Then** se rechaza con el mismo mensaje que da /registro.
4. **Given** que el dueño no acepta términos y privacidad, **When** intenta terminar, **Then** la barbería no se crea.
5. **Given** muchos intentos de alta seguidos, **When** se pasa el límite que ya tiene /registro, **Then** se detiene con un mensaje claro.

---

### User Story 3 - El dueño ve y quita sus asistentes conectados (Priority: P3)

En el panel (pestaña Ajustes), el dueño ve qué asistentes tiene conectados y desde cuándo, y puede desconectar
cualquiera al momento.

**Why this priority**: Es la salida de seguridad del P1; sin ella no hay forma de cortar un acceso perdido.

**Independent Test**: Conectar un asistente, desconectarlo desde el panel y comprobar que su siguiente pedido se
rechaza.

**Acceptance Scenarios**:

1. **Given** un asistente conectado, **When** el dueño lo quita en el panel, **Then** el asistente deja de poder leer o cambiar nada de inmediato.
2. **Given** que el dueño cambia su contraseña, **When** termina, **Then** todos sus asistentes conectados quedan desconectados.

### Edge Cases

- El asistente pide una fecha relativa ("mañana", "el sábado"): se interpreta en hora de Mérida.
- La suscripción de la barbería venció: puede leer, pero no agendar (igual que la página), con un mensaje que lo explique.
- Dos pedidos chocan por el mismo horario (uno por el asistente y otro por la página): solo uno gana; el otro recibe "ya está ocupado".
- El asistente pide algo que el SaaS no tiene (por ejemplo cobrar con tarjeta): responde que no está disponible, sin inventar.
- Un barbero sin cuenta propia intenta conectarse: no puede; solo cuentas del equipo de esa barbería.
- Textos que vienen del asistente con código o HTML: se guardan como texto y nunca se ejecutan en el panel ni en la página.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: La agenda MUST ofrecer un conector para asistentes de IA en una dirección pública fija del SaaS (agendabarberias.xyz/mcp) que funcione con Claude, ChatGPT y cualquier asistente que use el estándar MCP.
- **FR-002**: Para conectarse con una barbería, el dueño o barbero MUST entrar con su cuenta del panel en una pantalla de la propia agenda; la contraseña nunca pasa por la conversación con el asistente.
- **FR-003**: Cada conexión MUST quedar ligada a una sola persona y una sola barbería, y solo permitir lo que esa persona ya puede hacer en el panel (dueño: todo lo listado; barbero: lo que hoy le permite el panel).
- **FR-004**: Un asistente conectado MUST poder: ver citas de un día; ver horarios libres; agendar, mover y cancelar citas; ver servicios, paquetes y extras; cambiar nombre, precio y descripción de servicios y paquetes; ver ventas y resumen por periodo.
- **FR-005**: Agendar, mover y cancelar MUST seguir exactamente las mismas reglas de la agenda (horarios libres, cierres, precio calculado por el servidor, suscripción vigente, avisos) que el panel.
- **FR-006**: Un asistente sin conexión MUST poder consultar si un enlace está libre y empezar el alta de una barbería nueva; el alta se termina en la pantalla de la agenda, donde el dueño pone su contraseña y acepta términos y privacidad.
- **FR-007**: El alta por asistente MUST dar el mismo resultado que /registro (datos de inicio, 14 días de prueba, fecha de aceptación) y respetar sus mismas validaciones y su límite de intentos.
- **FR-008**: El dueño MUST poder ver y quitar sus asistentes conectados desde el panel; cambiar la contraseña MUST desconectarlos todos.
- **FR-009**: Cada cambio hecho por un asistente MUST quedar registrado como hecho "desde el asistente" junto a la persona dueña de la conexión.
- **FR-010**: Las respuestas al asistente MUST ir en español de México y en términos del negocio, sin exponer datos de otras barberías ni datos internos (contraseñas, correos privados de avisos).
- **FR-011**: Los clientes finales no pueden agendar por este conector (fuera de alcance); siguen usando la página de agendar.

### Key Entities

- **Conexión de asistente**: un acceso que un integrante del equipo autorizó para un asistente; pertenece a una persona y una barbería; tiene fecha de alta, último uso y se puede quitar.
- **Alta pendiente**: los datos de una barbería nueva que un asistente juntó y que esperan a que el dueño ponga su contraseña y acepte; vence si no se termina.
- **Barbería, cita, servicio/paquete, usuario del equipo**: las mismas que ya existen; el conector no crea copias.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un dueño conecta su asistente a su barbería en menos de 2 minutos, sin ayuda.
- **SC-002**: Una barbería nueva queda registrada desde un asistente en menos de 5 minutos.
- **SC-003**: El 100 % de las citas creadas, movidas o canceladas por un asistente se ven igual en el panel y en la página al momento.
- **SC-004**: En las pruebas, 0 casos en que un asistente lea o cambie datos de otra barbería o haga algo que esa persona no puede en el panel.
- **SC-005**: Desconectar un asistente desde el panel corta su acceso en su siguiente pedido (menos de 1 minuto).
- **SC-006**: Funciona con al menos dos asistentes distintos (Claude y ChatGPT) haciendo el flujo completo de las historias 1 y 2.

## Assumptions

- La conexión usa el inicio de sesión estándar que piden Claude y ChatGPT para conectores remotos (pantalla de autorización de la propia agenda); no se reparten claves a mano.
- La contraseña del alta se escribe en la pantalla de la agenda, no en el chat, aunque el dueño se la dé al asistente: por seguridad se le pide de nuevo ahí.
- Las cifras de ventas y resumen son las mismas que ya calcula el panel (no hay reportes nuevos).
- No se agregan funciones nuevas a la agenda: el conector expone lo que el panel ya hace.
- Sigue la constitución del proyecto: solo `express` y `pg` salvo que el plan justifique otra cosa, español, pruebas antes de publicar y publicación con aprobación.
