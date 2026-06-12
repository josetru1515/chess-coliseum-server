/* ─── tests/engine.test.js ───────────────────────────────────────
 * Batería de pruebas del motor de ajedrez (engine.js).
 * Ejecutar:  npm test   (o: node tests/engine.test.js)
 *
 * Incluye perft: conteo de nodos contra valores públicos conocidos.
 * Si el motor genera un solo movimiento de más o de menos en millones
 * de posiciones, el número no cuadra y el test falla.
 */
'use strict';

const ChessEngine = require('../engine.js');

let passed = 0, failed = 0;

function check(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) { passed++; console.log(`  ✔ ${name}`); }
    else {
        failed++;
        console.error(`  ✘ ${name}\n      esperado: ${JSON.stringify(expected)}\n      obtenido: ${JSON.stringify(actual)}`);
    }
}

function section(title) { console.log(`\n── ${title} ──`); }

// Convierte notación "e2" → {x,z}
function s(str) { return { x: 'abcdefgh'.indexOf(str[0]), z: parseInt(str[1], 10) - 1 }; }
function mv(game, from, to, promotion) {
    const f = s(from), t = s(to);
    return game.makeMove({ fromX: f.x, fromZ: f.z, toX: t.x, toZ: t.z, promotion: promotion || null });
}

// ════════════════════════════════════════════════════════════════
section('PERFT — posición inicial');
{
    const g = new ChessEngine();
    check('perft(1) = 20', g.perft(1), 20);
    check('perft(2) = 400', g.perft(2), 400);
    check('perft(3) = 8902', g.perft(3), 8902);
    check('perft(4) = 197281', g.perft(4), 197281);
}

section('PERFT — "Kiwipete" (enroques, capturas al paso, jaques)');
{
    const g = new ChessEngine('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    check('perft(1) = 48', g.perft(1), 48);
    check('perft(2) = 2039', g.perft(2), 2039);
    check('perft(3) = 97862', g.perft(3), 97862);
}

section('PERFT — posición 3 (finales con peones y al paso)');
{
    const g = new ChessEngine('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    check('perft(1) = 14', g.perft(1), 14);
    check('perft(2) = 191', g.perft(2), 191);
    check('perft(3) = 2812', g.perft(3), 2812);
    check('perft(4) = 43238', g.perft(4), 43238);
}

section('PERFT — posición 4 (promociones masivas)');
{
    const g = new ChessEngine('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    check('perft(1) = 6', g.perft(1), 6);
    check('perft(2) = 264', g.perft(2), 264);
    check('perft(3) = 9467', g.perft(3), 9467);
}

section('PERFT — posición 5 (promoción + jaques cruzados)');
{
    const g = new ChessEngine('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
    check('perft(1) = 44', g.perft(1), 44);
    check('perft(2) = 1486', g.perft(2), 1486);
}

// ════════════════════════════════════════════════════════════════
section('Peones: mover ≠ atacar');
{
    const g = new ChessEngine('k7/8/8/8/4P3/8/8/K7 w - - 0 1'); // peón blanco en e4
    check('e4 NO ataca e5 (avance no es ataque)', g.isSquareAttacked(4, 4, 'white'), false);
    check('e4 SÍ ataca d5 (diagonal vacía)', g.isSquareAttacked(3, 4, 'white'), true);
    check('e4 SÍ ataca f5 (diagonal vacía)', g.isSquareAttacked(5, 4, 'white'), true);
}

section('Jaque mate (mate del loco)');
{
    const g = new ChessEngine();
    mv(g, 'f2', 'f3'); mv(g, 'e7', 'e5'); mv(g, 'g2', 'g4');
    const rec = mv(g, 'd8', 'h4');
    check('último movimiento aceptado', !!rec, true);
    check('estado: jaque mate', rec.status.state, 'checkmate');
    check('ganan las negras', rec.status.winner, 'black');
}

section('Ahogado');
{
    const g = new ChessEngine('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    const st = g.getStatus();
    check('estado: ahogado', st.state, 'stalemate');
    check('resultado: tablas', st.winner, 'draw');
}

section('Captura al paso');
{
    const g = new ChessEngine('rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    mv(g, 'e2', 'e4');                       // doble avance junto al peón negro de d4
    const rec = mv(g, 'd4', 'e3');           // captura al paso
    check('al paso aceptada', !!rec, true);
    check('marcada como enPassant', rec.enPassant, true);
    check('peón capturado estaba en e4', { x: rec.captured.x, z: rec.captured.z }, { x: 4, z: 3 });
    check('e4 quedó vacía', g.pieceAt(4, 3), null);
    check('peón negro ahora en e3', g.pieceAt(4, 2).color, 'black');
}

section('Al paso caduca tras un movimiento');
{
    const g = new ChessEngine('rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    mv(g, 'e2', 'e4'); mv(g, 'g8', 'f6'); mv(g, 'g1', 'f3');
    check('d4xe3 ya no es legal', mv(g, 'd4', 'e3'), null);
}

section('Promoción con elección obligatoria');
{
    const g = new ChessEngine('8/P7/8/8/8/8/7k/K7 w - - 0 1');
    check('sin elegir pieza → rechazado', mv(g, 'a7', 'a8'), null);
    check('needsPromotion detecta la coronación', g.needsPromotion(0, 6, 0, 7), true);
    const rec = mv(g, 'a7', 'a8', 'knight');
    check('promoción a caballo aceptada', rec.promotion, 'knight');
    check('en a8 hay un caballo', g.pieceAt(0, 7).type, 'knight');
    check('notación: a7a8n', rec.lan, 'a7a8n');
}

section('Enroque');
{
    const g = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const rec = mv(g, 'e1', 'g1'); // enroque corto blanco
    check('enroque corto aceptado', rec.castle, 'king');
    check('torre saltó a f1', g.pieceAt(5, 0).type, 'rook');
    check('h1 quedó vacía', g.pieceAt(7, 0), null);
    const rec2 = mv(g, 'e8', 'c8'); // enroque largo negro
    check('enroque largo negro aceptado', rec2.castle, 'queen');
    check('torre negra en d8', g.pieceAt(3, 7).type, 'rook');
}

section('Enroque prohibido a través de jaque');
{
    // Torre negra en f3 ataca f1: el rey no puede atravesar f1
    const g = new ChessEngine('r3k2r/8/8/8/8/5r2/8/R3K2R w KQkq - 0 1');
    check('enroque corto rechazado', mv(g, 'e1', 'g1'), null);
    check('enroque largo sigue legal', mv(g, 'e1', 'c1').castle, 'queen');
}

section('Derechos de enroque se pierden al mover rey/torre');
{
    const g = new ChessEngine('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    mv(g, 'h1', 'h2'); mv(g, 'a8', 'a7'); // torre blanca H y torre negra A se mueven
    mv(g, 'h2', 'h1'); mv(g, 'a7', 'a8'); // vuelven — los derechos NO se recuperan
    check('blancas perdieron enroque corto', mv(g, 'e1', 'g1'), null);
    const w = mv(g, 'e1', 'c1');
    check('blancas conservan enroque largo', w && w.castle, 'queen');
    check('negras perdieron enroque largo', mv(g, 'e8', 'c8'), null);
    const b = mv(g, 'e8', 'g8');
    check('negras conservan enroque corto', b && b.castle, 'king');
}

section('Regla de 50 movimientos');
{
    const g = new ChessEngine('k7/8/8/8/8/8/8/K6R w - - 99 80');
    const rec = mv(g, 'h1', 'h2'); // movimiento 100 sin peón ni captura
    check('tablas por 50 movimientos', rec.status.state, 'fifty_moves');
    check('resultado: tablas', rec.status.winner, 'draw');
}

section('Triple repetición');
{
    const g = new ChessEngine();
    mv(g, 'g1', 'f3'); mv(g, 'g8', 'f6');
    mv(g, 'f3', 'g1'); mv(g, 'f6', 'g8'); // 2ª vez en posición inicial
    mv(g, 'g1', 'f3'); mv(g, 'g8', 'f6');
    mv(g, 'f3', 'g1');
    const rec = mv(g, 'f6', 'g8');         // 3ª vez en posición inicial
    check('tablas por repetición', rec.status.state, 'threefold');
}

section('Material insuficiente');
{
    check('K vs K', new ChessEngine('k7/8/8/8/8/8/8/K7 w - - 0 1').getStatus().state, 'insufficient_material');
    check('K+B vs K', new ChessEngine('k7/8/8/8/8/8/8/KB6 w - - 0 1').getStatus().state, 'insufficient_material');
    check('K+N vs K', new ChessEngine('k7/8/8/8/8/8/8/KN6 w - - 0 1').getStatus().state, 'insufficient_material');
    check('K+R vs K NO es tablas', new ChessEngine('k7/8/8/8/8/8/8/KR6 w - - 0 1').getStatus().over, false);
    check('K+P vs K NO es tablas', new ChessEngine('k7/8/8/8/8/8/P7/K7 w - - 0 1').getStatus().over, false);
}

section('Validaciones de turno y legalidad');
{
    const g = new ChessEngine();
    check('negras no pueden mover en turno blanco', mv(g, 'e7', 'e5'), null);
    check('movimiento ilegal de torre rechazado', mv(g, 'a1', 'a5'), null);
    check('no puedes dejarte en jaque', (() => {
        const h = new ChessEngine('k7/8/8/8/4r3/8/4P3/4K3 w - - 0 1'); // torre negra clava... el rey no puede quedar expuesto
        return mv(h, 'e2', 'd3'); // mover el peón clavado en e2 abre la columna e
    })(), null);
}

section('Historial y deshacer');
{
    const g = new ChessEngine();
    const initialFen = g.fen();
    mv(g, 'e2', 'e4'); mv(g, 'e7', 'e5'); mv(g, 'g1', 'f3');
    check('historial registra 3 movimientos', g.history.length, 3);
    check('historial en notación larga', g.history.map(h => h.lan), ['e2e4', 'e7e5', 'g1f3']);
    g.undo(); g.undo(); g.undo();
    check('deshacer restaura el FEN inicial', g.fen(), initialFen);
    check('historial vacío tras deshacer', g.history.length, 0);
}

section('FEN ida y vuelta');
{
    const fens = [
        ChessEngine.START_FEN,
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
    ];
    for (const f of fens) {
        check(`fen → load → fen: ${f.slice(0, 20)}…`, new ChessEngine(f).fen(), f);
    }
}

section('Sincronización: registro completo para reproducir partidas');
{
    const g = new ChessEngine();
    mv(g, 'e2', 'e4'); mv(g, 'd7', 'd5'); mv(g, 'e4', 'd5');
    const g2 = new ChessEngine();
    for (const h of g.history) {
        g2.makeMove({ fromX: h.fromX, fromZ: h.fromZ, toX: h.toX, toZ: h.toZ, promotion: h.promotion });
    }
    check('partida reconstruida desde el historial', g2.fen(), g.fen());
}

// ════════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════`);
console.log(`  ${passed} pruebas pasaron, ${failed} fallaron`);
console.log(`═══════════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
