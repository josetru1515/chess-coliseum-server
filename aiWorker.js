/* ─── aiWorker.js — IA de Chess Coliseum Pro ─────────────────────
 * Web Worker: recibe { fen, level } y responde { move, eval }.
 *
 * Las REGLAS viven en engine.js (motor único compartido): este archivo
 * solo contiene la búsqueda (minimax + poda alfa-beta) y la evaluación.
 *
 * La evaluación entiende estados terminales:
 *   - jaque mate  → ±MATE (prefiere el mate más rápido)
 *   - ahogado     → 0 (tablas, no "casi victoria")
 *   - material insuficiente → 0
 */
importScripts('engine.js');

const PIECE_VALUES = { pawn: 100, knight: 320, bishop: 330, rook: 500, queen: 900, king: 0 };
const MATE = 1000000;

// Tablas posicionales (perspectiva blanca; fila 0 = fila 8 del rival)
const POS_TABLES = {
    pawn: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5, 5, 10, 25, 25, 10, 5, 5],
        [0, 0, 0, 20, 20, 0, 0, 0],
        [5, -5, -10, 0, 0, -10, -5, 5],
        [5, 10, 10, -20, -20, 10, 10, 5],
        [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    knight: [
        [-50, -40, -30, -30, -30, -30, -40, -50],
        [-40, -20, 0, 0, 0, 0, -20, -40],
        [-30, 0, 10, 15, 15, 10, 0, -30],
        [-30, 5, 15, 20, 20, 15, 5, -30],
        [-30, 0, 15, 20, 20, 15, 0, -30],
        [-30, 5, 10, 15, 15, 10, 5, -30],
        [-40, -20, 0, 5, 5, 0, -20, -40],
        [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    bishop: [
        [-20, -10, -10, -10, -10, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 5, 5, 10, 10, 5, 5, -10],
        [-10, 0, 10, 10, 10, 10, 0, -10],
        [-10, 10, 10, 10, 10, 10, 10, -10],
        [-10, 5, 0, 0, 0, 0, 5, -10],
        [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    rook: [
        [0, 0, 0, 0, 0, 0, 0, 0],
        [5, 10, 10, 10, 10, 10, 10, 5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [-5, 0, 0, 0, 0, 0, 0, -5],
        [0, 0, 0, 5, 5, 0, 0, 0]
    ],
    queen: [
        [-20, -10, -10, -5, -5, -10, -10, -20],
        [-10, 0, 0, 0, 0, 0, 0, -10],
        [-10, 0, 5, 5, 5, 5, 0, -10],
        [-5, 0, 5, 5, 5, 5, 0, -5],
        [0, 0, 5, 5, 5, 5, 0, -5],
        [-10, 5, 5, 5, 5, 5, 0, -10],
        [-10, 0, 5, 0, 0, 0, 0, -10],
        [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    king: [
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-30, -40, -40, -50, -50, -40, -40, -30],
        [-20, -30, -30, -40, -40, -30, -30, -20],
        [-10, -20, -20, -20, -20, -20, -20, -10],
        [20, 20, 0, 0, 0, 0, 20, 20],
        [20, 30, 10, 0, 0, 10, 30, 20]
    ]
};

// Profundidad por nivel. Los coliseos usan: humanos=1, hielo=2,
// vacío=4, dragones=6 (dificultad ascendente).
function depthForLevel(level) {
    if (level <= 2) return 1;
    if (level <= 4) return 2;
    if (level <= 6) return 3;
    if (level <= 8) return 4;
    if (level === 9) return 5;
    return 6;
}

// Presupuesto de tiempo por profundidad máxima (ms). Si no alcanza,
// la IA juega el mejor movimiento de la última profundidad completada.
const TIME_BUDGET_MS = { 1: 800, 2: 1500, 3: 2500, 4: 4500, 5: 7000, 6: 10000 };

const ABORT = Symbol('search-abort');
let deadline = Infinity;

function posValue(type, x, z, color) {
    const table = POS_TABLES[type];
    if (!table) return 0;
    const row = color === 'white' ? (7 - z) : z;
    return (table[row] && table[row][x]) || 0;
}

// Evaluación estática desde la perspectiva de aiColor (+ = bueno para la IA)
function evaluate(game, aiColor, level) {
    let score = 0;
    const posWeight = Math.min(1, level / 6);
    for (const p of game.getPieces()) {
        const sign = p.color === aiColor ? 1 : -1;
        score += sign * ((PIECE_VALUES[p.type] || 0) + posValue(p.type, p.x, p.z, p.color) * posWeight);
    }
    // Niveles bajos cometen "errores" (ruido en la evaluación)
    if (level <= 4) {
        const noise = (11 - level) * 15;
        score += (Math.random() - 0.5) * noise;
    }
    return score;
}

// Captura primero: mejora muchísimo la poda alfa-beta
function orderMoves(game, moves) {
    return moves.sort((a, b) => (b.isCapture ? 1 : 0) - (a.isCapture ? 1 : 0));
}

function minimax(game, depth, alpha, beta, aiColor, level, ply) {
    if (Date.now() > deadline) throw ABORT; // se acabó el tiempo de pensar

    const moves = game.allLegalMoves();

    // Estados terminales: esto es lo que la IA vieja no entendía
    if (moves.length === 0) {
        if (game.isInCheck(game.turn)) {
            // El bando al turno está en jaque mate
            return game.turn === aiColor ? -(MATE - ply) : (MATE - ply);
        }
        return 0; // Ahogado = tablas
    }
    if (game._insufficientMaterial()) return 0;
    if (game.halfmove >= 100) return 0;

    if (depth === 0) return evaluate(game, aiColor, level);

    const maximizing = game.turn === aiColor;
    let best = maximizing ? -Infinity : Infinity;

    for (const m of orderMoves(game, moves)) {
        const info = game._apply(m);
        let score;
        try {
            score = minimax(game, depth - 1, alpha, beta, aiColor, level, ply + 1);
        } finally {
            game._undo(m, info); // deshacer SIEMPRE, incluso al abortar por tiempo
        }

        if (maximizing) {
            if (score > best) best = score;
            if (score > alpha) alpha = score;
        } else {
            if (score < best) best = score;
            if (score < beta) beta = score;
        }
        if (beta <= alpha) break;
    }
    return best;
}

self.onmessage = function (e) {
    const { fen, level } = e.data;
    const game = new ChessEngine(fen);
    const aiColor = game.turn;
    const lvl = level || 5;
    const maxDepth = depthForLevel(lvl);
    deadline = Date.now() + (TIME_BUDGET_MS[maxDepth] || 3000);

    let rootMoves = orderMoves(game, game.allLegalMoves());
    let bestMove = null;
    let bestScore = -Infinity;
    let reachedDepth = 0;

    // Iterative deepening: busca a profundidad 1, luego 2, etc.
    // Si el tiempo se agota a mitad de una profundidad, se queda con
    // el resultado de la última profundidad COMPLETA.
    for (let d = 1; d <= maxDepth; d++) {
        let curBest = null;
        let curScore = -Infinity;
        let alpha = -Infinity;
        let completed = true;

        try {
            for (const m of rootMoves) {
                const info = game._apply(m);
                let score;
                try {
                    score = minimax(game, d - 1, alpha, Infinity, aiColor, lvl, 1);
                } finally {
                    game._undo(m, info);
                }
                if (score > curScore || curBest === null) {
                    curScore = score;
                    curBest = m;
                }
                if (score > alpha) alpha = score;
            }
        } catch (err) {
            if (err !== ABORT) throw err;
            completed = false;
        }

        if (completed && curBest) {
            bestMove = curBest;
            bestScore = curScore;
            reachedDepth = d;
            // El mejor de esta vuelta se explora primero en la siguiente
            // (mejora muchísimo la poda alfa-beta)
            rootMoves = [curBest, ...rootMoves.filter(m => m !== curBest)];
            if (bestScore > MATE / 2) break; // mate encontrado: no hay que pensar más
        } else {
            if (!bestMove && curBest) { bestMove = curBest; bestScore = curScore; } // mejor parcial que nada
            break; // sin tiempo para profundidades mayores
        }
    }

    self.postMessage({
        move: bestMove
            ? { fromX: bestMove.fromX, fromZ: bestMove.fromZ, toX: bestMove.toX, toZ: bestMove.toZ, promotion: bestMove.promotion || null }
            : null,
        eval: bestScore,
        depth: reachedDepth
    });
};
