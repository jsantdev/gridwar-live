# Cómo está organizado el servidor

Este proyecto es un único servidor Node.js. Las carpetas separan responsabilidades para que una función nueva tenga un lugar claro; no son servidores independientes ni microservicios.

## Mapa de carpetas

```text
servidor/
  server.js                    # Arranque y conexión de módulos
  modules/
    game/                      # Reglas y estado de la partida
      index.js                 # Construye el módulo y controla su ciclo de vida
      routes.js                # Endpoints /api/game-state
      services/
        gameStateService.js    # Países, tablero, líderes y cambios válidos
        warRulesService.js     # Reglas de movimiento y avance
        troopActionService.js  # Fortificar, atacar, invadir y empatar
        gameInteractionService.js # Traduce actividad del público a jugadas
        inactivityBotService.js  # Acción automática después de 10 s
    tiktok/                    # Conexión y configuración de TikTok Live
      index.js                 # Une conector, eventos y módulo del juego
      routes.js                # /api/config, /api/events y /api/status
      tiktokMonitorService.js  # Conexión con tiktok-live-connector
      eventConfig.js           # Tipos y nombres de eventos
      giftTranslationService.js # Normaliza nombres de regalos
      eventFeedService.js      # Ordena eventos para el monitor
    overlay/                   # Página pública servida en /
      index.js
      index.html
    realtime/
      sseHub.js                # Clientes SSE y difusión de eventos
  public/
    index.html                 # Panel de administración en /backend
  test/                        # Pruebas automáticas
  data/                        # Configuración local persistente
```

`server.js` es el punto de composición: crea el transporte SSE, inicializa cada módulo, monta sus rutas y los detiene al cerrar el proceso. No debería contener reglas del juego, lógica de regalos ni HTML del overlay.

## Qué hace cada unidad

| Unidad | Es responsable de | No debería hacer |
|---|---|---|
| `game` | Estado, líderes, reglas tácticas, interacción del público con la partida y bot de inactividad | Conectarse directamente a TikTok o decidir cómo se dibuja el overlay |
| `tiktok` | Conectar/desconectar la cuenta, normalizar y filtrar eventos, guardar su configuración y mostrar el registro | Cambiar celdas por su cuenta; entrega los eventos al módulo `game` |
| `overlay` | Servir la página de visualización | Aplicar reglas o guardar el estado del juego |
| `realtime` | Mantener conexiones SSE y emitir mensajes con nombre y datos | Interpretar regalos, países o tácticas |

El flujo principal es:

```text
TikTok Live -> módulo tiktok -> módulo game -> estado del juego
                                      |
                                      +-> SSE -> overlay y panel
Panel -> rutas del módulo game ------+
```

## Contrato entre módulos

Cada unidad dueña de una API HTTP expone `registerRoutes(app)`. Recibe la aplicación Express para registrar sus endpoints, pero conserva la lógica y los servicios dentro de su propia carpeta. Los módulos que mantienen recursos exponen `close()`; el módulo de juego expone además `start()` para activar su temporizador después de que todos los módulos se hayan creado.

`game.handleLiveEvent(evento)` recibe un evento normalizado. TikTok llama a `game.noteLiveActivity(evento)` al recibir actividad real —incluso si el tipo está oculto en el registro— y solo pasa al manejador los eventos permitidos por el filtro. Así, ocultar un tipo de evento no afecta el reinicio del temporizador de inactividad.

Los eventos normalizados pueden incluir `type`, `username`, `time`, `content`, `activityCount` y `diamondCount`. El conector TikTok es responsable de normalizar la forma original del proveedor; el módulo de juego no necesita importar el SDK de TikTok.

## Contrato de HTTP y SSE

- `GET /` sirve el overlay.
- `GET /backend` sirve el panel; `/panel` permanece como redirección compatible.
- `GET /api/game-state` devuelve `{ countries, board, leaders, activeCountryId, winner }`.
- `GET /api/game-state/stream` envía `snapshot` con el estado inicial, `mode` con el modo de conexión y eventos `update` con `{ result, state, simulated }`.
- `GET /api/events` envía el estado del monitor y un `snapshot` del registro; nuevos eventos se envían como `update`.
- `GET/PUT /api/config` lee o cambia la cuenta de TikTok y los eventos ocultos.
- `GET /api/status` devuelve el estado del monitor y del conector.
- Las demás rutas de `/api/game-state` pertenecen al módulo de juego; sus operaciones contestan `{ ok, result, state }` cuando son exitosas.

`realtime/sseHub` es un contrato de transporte pequeño: `attach(respuesta, mensajesIniciales)`, `broadcast(nombre, datos)` y `close()`. El significado de `snapshot`, `update` y `mode` lo definen los módulos que los publican.

## Dónde hacer cambios

- Una regla de captura, ataque o movimiento: `modules/game/services/warRulesService.js` o `troopActionService.js`.
- Una reacción a regalos, likes o comentarios: `modules/game/services/gameInteractionService.js`; agrega el reconocimiento del evento a TikTok solo si el conector aún no lo normaliza.
- Una ruta para consultar/modificar la partida: `modules/game/routes.js`.
- Una ruta o preferencia de conexión TikTok: `modules/tiktok/routes.js` y `modules/tiktok/index.js`.
- Una animación o tarjeta del overlay: `modules/overlay/index.html`.
- El formato o el envío de eventos SSE: `modules/realtime/sseHub.js` y el módulo que sea dueño de esos datos.
- El orden de inicio o cierre del servidor: `server.js`.

Al añadir una función, colócala en el módulo que es dueño del dato o la regla. Evita que `game` importe el SDK, que `tiktok` cambie el tablero directamente o que `server.js` se convierta en otra colección de rutas. Para iniciar la aplicación desde una prueba, inyecta servicios o temporizadores falsos en `createWebserver()` en lugar de conectarte a TikTok de verdad.

## Verificación

Desde esta carpeta:

```text
npm test
npm run test:coverage
```

La cobertura informa líneas, ramas y funciones ejecutadas por las pruebas; una cifra alta no reemplaza pruebas de las reglas importantes ni significa que todos los comportamientos posibles estén verificados.
