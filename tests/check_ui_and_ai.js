/* Verificación auxiliar (no es parte de npm test):
 * 1. Extrae el <script type="module"> de index.html y comprueba su sintaxis.
 * 2. Ejecuta aiWorker.js simulando el entorno de Web Worker y comprueba
 *    que la IA encuentra un mate en 1 y promociona correctamente.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let ok = true;

// ── 1. Sintaxis del módulo de index.html ─────────────────────
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
if (!m) { console.error('✘ No se encontró el <script type="module">'); process.exit(1); }
try {
    // Comprobación de sintaxis (sin ejecutar): los `import` no son válidos
    // en un Script clásico, así que se eliminan antes de parsear.
    const code = m[1].replace(/^\s*import\s[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
    new vm.Script(code, { filename: 'index-module.js' });
    console.log('✔ Sintaxis del script del juego (index.html) correcta');
} catch (e) {
    ok = false;
    console.error('✘ Error de sintaxis en el script de index.html:', e.message);
}

// ── 2. aiWorker.js simulado ──────────────────────────────────
const ChessEngine = require(path.join(root, 'engine.js'));
const workerCode = fs.readFileSync(path.join(root, 'aiWorker.js'), 'utf8');

let lastResponse = null;
const sandbox = {
    importScripts: () => { },     // engine.js se inyecta directo
    ChessEngine,
    self: {},
    console,
    Math,
    Date,
    Symbol,
    Infinity
};
sandbox.self.postMessage = (msg) => { lastResponse = msg; };
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox, { filename: 'aiWorker.js' });

function askAI(fen, level) {
    lastResponse = null;
    sandbox.self.onmessage({ data: { fen, level } });
    return lastResponse;
}

// Mate en 1: dama blanca en h5 puede dar mate... usamos una clásica:
// Negras al turno, torre negra en a-file da mate bajando: k7/8/8/8/8/8/r7/... mejor algo simple:
// Blancas: Re1, Da5 — Negras: Ra8 solo. Da5-d8 NO... usemos:
// FEN: rey negro en h8, torre blanca a1, rey blanco g6 → Ra1-a8 es mate.
{
    const r = askAI('7k/8/6K1/8/8/8/8/R7 w - - 0 1', 8);
    const game = new ChessEngine('7k/8/6K1/8/8/8/8/R7 w - - 0 1');
    const rec = game.makeMove(r.move);
    if (rec && rec.status.state === 'checkmate') {
        console.log(`✔ IA encuentra mate en 1 (${rec.lan})`);
    } else {
        ok = false;
        console.error('✘ IA no encontró el mate en 1. Respondió:', JSON.stringify(r));
    }
}

// Promoción: peón blanco a7, la IA debe coronar (y declarar la pieza)
{
    const r = askAI('8/P6k/8/8/8/8/8/K7 w - - 0 1', 8);
    if (r.move && r.move.fromX === 0 && r.move.toZ === 7 && r.move.promotion) {
        console.log(`✔ IA corona declarando la pieza: ${r.move.promotion}`);
    } else {
        ok = false;
        console.error('✘ IA no coronó correctamente. Respondió:', JSON.stringify(r));
    }
}

// La IA juega para CUALQUIER color (antes asumía negras): blancas al turno arriba ✓,
// ahora negras al turno con mate en 1: torre negra en a2 → a1 con rey blanco en h1...
{
    const fen = 'k7/8/8/8/8/8/r7/6K1 b - - 0 1'; // torre negra a2: Ra2-a1 no es mate (rey escapa h2)... comprobamos solo que devuelve un movimiento legal
    const r = askAI(fen, 5);
    const game = new ChessEngine(fen);
    if (r.move && game.makeMove(r.move)) {
        console.log('✔ IA juega con negras (movimiento legal)');
    } else {
        ok = false;
        console.error('✘ IA no devolvió movimiento legal para negras:', JSON.stringify(r));
    }
}

// Ahogado vs victoria: la IA con dama+rey contra rey solo NO debe ahogar
// cuando tiene mate disponible. Posición: mate en 1 con dama.
{
    const fen = '7k/5Q2/5K2/8/8/8/8/8 w - - 0 1'; // Qf7-g7# es mate (Kf6 lo protege)
    const r = askAI(fen, 8);
    const game = new ChessEngine(fen);
    const rec = game.makeMove(r.move);
    if (rec && rec.status.state === 'checkmate') {
        console.log(`✔ IA elige mate y no ahogado (${rec.lan})`);
    } else if (rec && rec.status.state === 'stalemate') {
        ok = false;
        console.error('✘ ¡La IA ahogó al rival teniendo mate!', rec.lan);
    } else {
        ok = false;
        console.error('✘ IA no mató teniendo mate en 1:', JSON.stringify(r), rec && rec.status);
    }
}

console.log(ok ? '\n✔ TODO OK' : '\n✘ HAY FALLOS');
process.exit(ok ? 0 : 1);
