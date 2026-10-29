# Servidor de juego

El servidor, el conector de TikTok Live y el overlay se ejecutan como un solo proceso Node.js. `modules/overlay` sirve el overlay en `/` y el panel de administración está en `/backend`; ambos comparten la misma API y SSE. Desde la raíz, `iniciar-servidores.bat` instala dependencias, libera el puerto configurado e inicia el servidor en el puerto 80. Para ejecutarlo manualmente, usa `npm start` desde `servidor\` (o define `PORT` para cambiar el puerto).

El servidor está organizado por unidades de negocio: `modules/game`, `modules/tiktok` y `modules/overlay`. Las reglas y el estado del juego viven dentro de `modules/game/services`; las rutas HTTP de cada unidad están junto al módulo propietario. `modules/realtime` solo comparte el transporte SSE y no contiene reglas de negocio.

Los usuarios se asignan de forma equilibrada a A o B y conservan su equipo. Los likes se acumulan y cada 10 generan un avance; comentarios avanzan una casilla. Los regalos pequeños como Rosa movilizan tropas, y los regalos grandes como León invaden o refuerzan una capital disponible. La clasificación suma los diamantes de regalos y las interacciones. Cada resultado se difunde por `GET /api/game-state/stream` como SSE `update`, junto al estado actualizado. El overlay, el panel y la API están disponibles en el mismo host y puerto, 80 por defecto.

El panel `/backend` usa un diseño adaptable para configurar la conexión, ver eventos, consultar el tablero y ejecutar acciones de prueba. El enlace «Abrir overlay» vuelve a la vista pública en `/`.

## API principal

- `GET /api/game-state`: países, tablero y top 3.
- `GET /api/game-state/stream`: snapshot y actualizaciones SSE.
- `POST /api/game-state/actions`: acción existente (`donation`, `interaction` o `move`) o resolución de tropas con `{ "type": "troop", "teamId": "A", "sourceIndex": 0, "targetIndex": 1, "sentAmount": 4 }`.
- `PATCH /api/game-state/countries/:id`: modifica nombre y capital.
- `POST /api/game-state/countries/:id/points` y `/morale`: ajusta puntos o moral.
- `PUT /api/game-state/board/:index`: actualiza dueño y tropas.
- `GET /api/config` y `PUT /api/config`: consulta eventos y conecta una cuenta de TikTok.
- `GET /api/status`: estado del servidor y del conector integrado.

Las casillas admiten hasta 100 tropas. La movilización existente descuenta desgaste según la distancia Manhattan; las acciones de `resolveTroopAction` resuelven fortalecimiento, invasión, ataque o empate. Las casillas propias con moral de 70 o más regeneran 3 tropas por segundo.

Ejecuta `npm test` para las pruebas o `npm run test:coverage` para generar el resumen de cobertura de Node.js. Se requiere Node.js 18 o posterior.

Para entender el árbol, los contratos entre módulos y cómo añadir una función nueva, consulta [ARCHITECTURE.md](ARCHITECTURE.md).
