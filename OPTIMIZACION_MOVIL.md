# 📱 Optimización móvil (iPhone) — notas para futuras sesiones

> Documento vivo. Resume el diagnóstico real, las decisiones tomadas y lo que falta.
> Si retomas esto en otra sesión, **lee esto primero** antes de tocar `index.html`.

## Síntoma
El juego corre **perfecto en PC y en Google Pixel 10**, pero **lento en iPhone** (y flojo en
otros móviles). El cliente es **un solo `index.html`** (~208 KB) con Three.js r162 cargado por
CDN (importmap). No hay React, ni Vite, ni chess.js, ni Cannon.js — esas tecnologías que
mencionaban diagnósticos previos **eran falsas** (alucinaciones de agentes que no leyeron el código).

## Seguridad / cómo volver atrás
- Repo: `github.com/josetru1515/chess-coliseum-server`
- **Tag de respaldo de la versión estable:** `v1.0-estable` → `git checkout v1.0-estable`
- **Rama de trabajo:** `optimizacion-movil` (todos los cambios van aquí; `main` queda intacto)

## Diagnóstico REAL (verificado en el código)
- **pixelRatio**: ya estaba capado a 2 (iPhone tiene devicePixelRatio 3 → 9× píxeles; cap 2 → 4×).
- **Sombras**: ya desactivadas (`renderer.shadowMap.enabled = false`).
- **Bloom**: ya desactivado (causaba pantalla negra). El `EffectComposer` solo hace `RenderPass` + `SMAAPass`.
- **Doble antialiasing**: `WebGLRenderer({ antialias:true })` (MSAA) **+** `SMAAPass` a la vez. En móvil sobra uno.
- **Luces**: `setupLights()` usa `if … return;` **por arena** (según `coliseumId` de la URL), así que
  **NO hay 39 luces a la vez**. Máximo real por escena **~10–11** (rama de `setupLights` + las
  decorativas que añade el `build*Arena` de esa arena; p. ej. el volcán suma 4 PointLight en
  `buildCumbresLavaArena`). Sigue siendo alto para WebGL móvil (cada luz se evalúa por píxel),
  pero **no es catastrófico**.
- **Sin detección de móvil**: no había forma de bajar calidad solo en teléfonos.

### Conteo de luces por arena (peor caso simultáneo)
| Coliseo (coliseumId) | setupLights | Decorativas | Total |
|---|---|---|---|
| Estadio Verde (`estadio verde`) | 11 | 0 | 11 |
| Volcán (`volcan`/`volcano`)     | 7  | 4 (lava) | 11 |
| Hielo (`hielo`/`frost`)         | 10 | 0 | 10 |
| Cementerio (`cementerio`/`shadow`) | 10 | 0 | 10 |
| Genérico (resto)                | 8  | 0 | 8 |

## Sugerencias evaluadas (y por qué sí/no)
- ❌ **`useLegacyLights = false`**: en r162 **ya es el default** y **no es una optimización** —
  solo cambia cómo se interpretan las *unidades* de intensidad. Tocarlo no da FPS y alteraría el look.
- ❌ **Deferred rendering / `MeshDeferredMaterial`**: **no existe** en Three.js actual; mala idea en
  WebGL móvil (ancho de banda, sin MSAA, transparencias). Para 10–11 luces es sobreingeniería.
- ✅ **Pre-warm de shaders**: real y útil contra el *tirón al cargar* en WebKit iOS.

## Plan (gateado a móvil — PC y Pixel 10 quedan IDÉNTICOS)
1. ✅/⏳ `pixelRatio` 2 → **1.5** solo en móvil (de 4× a ~2.25× píxeles).
2. ✅/⏳ Quitar el **doble AA** en móvil (un solo método de antialiasing).
3. ✅/⏳ **Pre-warm de shaders** antes del primer frame.
4. ⏳ **Recorte suave de luces** solo en móvil (bucles decorativos: 6→3, 4→2 PointLight). *Pendiente: probar en iPhone real primero.*
5. ⏳ Aligerar `backdrop-filter: blur()` en iOS. *Secundario.*

> El estado real (✅ hecho vs ⏳ pendiente) se confirma en el `git log` de la rama `optimizacion-movil`.
> Solo el usuario puede probar en un iPhone físico; tras cada tanda de cambios, **probar ahí** antes de seguir.
