/* Verifica que cada nivel de coliseo responde dentro de su presupuesto
 * de tiempo y devuelve un movimiento legal, en una posición de medio juego.
 * Ejecutar: node tests/check_ai_speed.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ChessEngine = require(path.join(root, 'engine.js'));
const workerCode = fs.readFileSync(path.join(root, 'aiWorker.js'), 'utf8');

let lastResponse = null;
const sandbox = {
    importScripts: () => { }, ChessEngine, self: {}, console, Math, Date, Symbol, Infinity
};
sandbox.self.postMessage = (msg) => { lastResponse = msg; };
vm.createContext(sandbox);
vm.runInContext(workerCode, sandbox, { filename: 'aiWorker.js' });

// Posición de medio juego con mucha ramificación (apertura italiana desarrollada)
const MIDGAME = 'r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w - - 6 6';

const cases = [
    { name: 'Humanos (1 turno)', level: 2, maxMs: 2500 },
    { name: 'Hielo (2 turnos)', level: 4, maxMs: 3500 },
    { name: 'Vacío (4 turnos)', level: 8, maxMs: 7000 },
    { name: 'Dragones (6 turnos)', level: 10, maxMs: 13000 },
];

let ok = true;
for (const c of cases) {
    lastResponse = null;
    const t0 = Date.now();
    sandbox.self.onmessage({ data: { fen: MIDGAME, level: c.level } });
    const ms = Date.now() - t0;
    const game = new ChessEngine(MIDGAME);
    const legal = lastResponse && lastResponse.move && !!game.makeMove(lastResponse.move);
    const inTime = ms <= c.maxMs;
    if (legal && inTime) {
        console.log(`  ✔ ${c.name}: ${ms} ms, profundidad alcanzada ${lastResponse.depth}, movimiento legal`);
    } else {
        ok = false;
        console.error(`  ✘ ${c.name}: ${ms} ms (límite ${c.maxMs}), legal=${legal}, resp=${JSON.stringify(lastResponse)}`);
    }
}
console.log(ok ? '\n✔ VELOCIDAD OK' : '\n✘ HAY FALLOS');
process.exit(ok ? 0 : 1);
