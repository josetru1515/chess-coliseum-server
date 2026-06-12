# ⚔ Chess Coliseum Pro

Batalla de ajedrez 3D (Three.js) con IA, PvP local y PvP online (Socket.io + Firebase).

## Arquitectura

```
                    ┌─────────────────┐
                    │    engine.js     │   ← MOTOR ÚNICO (reglas, turnos,
                    │  (fuente única   │     historial, estado, FEN)
                    │   de verdad)     │
                    └────────┬─────────┘
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
     index.html         aiWorker.js       server.js
     (UI 3D: solo       (búsqueda IA      (autoridad PvP:
      ANIMA lo que       minimax sobre     valida CADA
      el motor           el motor)         movimiento)
      aprueba)
```

| Archivo | Rol |
|---|---|
| `engine.js` | Motor de ajedrez. Sin dependencias. Corre en navegador, Web Worker y Node. |
| `index.html` | Escena 3D y UI. No decide legalidad: pide al motor y anima el resultado. |
| `aiWorker.js` | IA en Web Worker. Recibe FEN, responde el mejor movimiento. |
| `server.js` | Express + Socket.io. Mantiene un motor por sala y rechaza movimientos ilegales. |
| `multiplayer.js` | Cliente social/online: Firebase Auth, amigos, invitaciones, socket. |
| `tests/engine.test.js` | Batería de pruebas del motor (perft + reglas). |

## Flujo de un movimiento

1. **Local**: clic → `attemptMove` → (modal de promoción si corona) → `commitMove` → `engine.makeMove` valida y aplica → `animateMove` mueve los meshes → al terminar la animación, `finishMove` actualiza estado/turno.
2. **Online**: además, el movimiento (con la promoción elegida) viaja al servidor → el servidor lo valida con SU motor → lo reenvía al rival → el rival lo aplica por el mismo camino. Si algo diverge, el cliente pide `requestSync` y reconstruye desde el historial oficial del servidor.
3. **IA**: `makeAIMove` envía el FEN al worker → el worker responde `{move}` → se aplica por el mismo camino que un movimiento humano.

## Reglas implementadas (decisiones de diseño)

✅ Movimiento completo de las 6 piezas · jaque · jaque mate · ahogado
✅ Enroque corto y largo (con todas sus condiciones)
✅ Captura al paso
✅ Promoción con elección obligatoria (reina/torre/alfil/caballo) — sincronizada en PvP
✅ Regla de 50 movimientos — **automática** (no reclamable, simplifica la UI)
✅ Triple repetición — **automática** (misma decisión)
✅ Tablas por material insuficiente

Decisiones conscientes:
- **Formato de historial**: registros JSON propios (`{fromX, fromZ, toX, toZ, promotion, captured, lan, …}`) + notación larga (`e2e4`, `a7a8n`) + FEN en cualquier momento (`engine.fen()`). Cualquier partida se puede reconstruir reproduciendo el historial (hay test de ello). No se genera PGN/SAN; si algún día hace falta, se construye encima de este historial.
- **Tablas automáticas**: en ajedrez oficial, 50 movimientos y triple repetición son *reclamables*; aquí se aplican solas porque no hay árbitro ni botón de reclamo.
- La IA en búsqueda no detecta repetición (por rendimiento); el motor sí la detecta en la partida real.

## Criterios de aceptación ("¿cuándo está correcto?")

Una versión del juego se considera correcta si:

1. `npm test` pasa al 100% (incluye perft: posición inicial d4=197.281 nodos, Kiwipete d3=97.862, etc. — un solo movimiento mal generado rompe el conteo).
2. La UI nunca permite un movimiento que el motor rechace (la legalidad se consulta, no se duplica).
3. En PvP online el servidor rechaza: movimientos fuera de turno, de un socket que no es jugador de la sala, o ilegales — y es el único que anuncia el resultado.
4. Una promoción a torre/alfil/caballo se ve idéntica en ambos clientes.
5. Tras una reconexión, el cliente queda con el mismo FEN que el servidor.
6. Mate, ahogado, 50 movimientos, repetición y material insuficiente terminan la partida con el mensaje correcto en ambos clientes.

## Comandos

```bash
npm install        # dependencias del servidor
npm test           # batería de pruebas del motor
npm start          # servidor PvP en http://localhost:3001 (sirve también el juego)
```

Deploy del cliente: Firebase Hosting (`firebase deploy`) — sirve la raíz; `public/` es una versión antigua ignorada en `firebase.json`.
