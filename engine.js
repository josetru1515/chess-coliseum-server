/* ─── engine.js — Chess Coliseum Pro ─────────────────────────────
 * Motor ÚNICO de ajedrez: tablero, turnos, reglas, historial y estado.
 * Lo usan: index.html (UI 3D), aiWorker.js (IA) y server.js (autoridad PvP).
 *
 * Sin dependencias. Funciona en:
 *   - Navegador:  <script src="engine.js"> → window.ChessEngine
 *   - Web Worker: importScripts('engine.js') → self.ChessEngine
 *   - Node:       const ChessEngine = require('./engine.js')
 *
 * Coordenadas (mismas que la UI 3D):
 *   x = columna 0..7 (a..h) | z = fila 0..7 (1..8)
 *   Blancas: filas z=0/1, sus peones avanzan +z.
 *   Negras:  filas z=7/6, sus peones avanzan -z.
 *
 * Reglas implementadas (decisión de diseño, ver README):
 *   movimiento completo de las 6 piezas, jaque, jaque mate, ahogado,
 *   enroque (ambos lados), captura al paso, promoción con elección,
 *   regla de 50 movimientos (automática), triple repetición (automática)
 *   y tablas por material insuficiente.
 */
(function (global, factory) {
    if (typeof module === 'object' && typeof module.exports === 'object') {
        module.exports = factory();
    } else {
        global.ChessEngine = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const WHITE = 'white', BLACK = 'black';
    const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const PROMOTABLE = ['queen', 'rook', 'bishop', 'knight'];
    const FEN_TYPES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
    const TYPE_FEN = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

    const KNIGHT_JUMPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
    const KING_STEPS = [[1, 1], [1, 0], [1, -1], [0, 1], [0, -1], [-1, 1], [-1, 0], [-1, -1]];
    const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

    function other(color) { return color === WHITE ? BLACK : WHITE; }
    function onBoard(x, z) { return x >= 0 && x <= 7 && z >= 0 && z <= 7; }
    function sq(x, z) { return 'abcdefgh'[x] + (z + 1); }

    class ChessEngine {

        constructor(fen) {
            this.loadFen(fen || START_FEN);
        }

        reset() { this.loadFen(START_FEN); }

        // ── FEN ──────────────────────────────────────────────
        loadFen(fen) {
            const parts = fen.trim().split(/\s+/);
            this.board = new Array(64).fill(null);
            const rows = parts[0].split('/');
            for (let r = 0; r < 8; r++) {
                const z = 7 - r; // FEN empieza por la fila 8
                let x = 0;
                for (const ch of rows[r]) {
                    if (ch >= '1' && ch <= '8') { x += parseInt(ch, 10); continue; }
                    const color = ch === ch.toUpperCase() ? WHITE : BLACK;
                    this.board[z * 8 + x] = { type: FEN_TYPES[ch.toLowerCase()], color };
                    x++;
                }
            }
            this.turn = parts[1] === 'b' ? BLACK : WHITE;
            const c = parts[2] || '-';
            this.castling = {
                wk: c.includes('K'), wq: c.includes('Q'),
                bk: c.includes('k'), bq: c.includes('q')
            };
            if (parts[3] && parts[3] !== '-') {
                this.epTarget = { x: 'abcdefgh'.indexOf(parts[3][0]), z: parseInt(parts[3][1], 10) - 1 };
            } else {
                this.epTarget = null;
            }
            this.halfmove = parseInt(parts[4] || '0', 10);
            this.fullmove = parseInt(parts[5] || '1', 10);
            this.history = [];   // registros públicos de la partida
            this._stack = [];    // pila interna para undo (incluye búsqueda IA)
            this.repetition = new Map();
            this._bumpRepetition();
        }

        fen() {
            let placement = '';
            for (let r = 0; r < 8; r++) {
                const z = 7 - r;
                let empty = 0;
                for (let x = 0; x < 8; x++) {
                    const cell = this.board[z * 8 + x];
                    if (!cell) { empty++; continue; }
                    if (empty) { placement += empty; empty = 0; }
                    const ch = TYPE_FEN[cell.type];
                    placement += cell.color === WHITE ? ch.toUpperCase() : ch;
                }
                if (empty) placement += empty;
                if (r < 7) placement += '/';
            }
            let castle = '';
            if (this.castling.wk) castle += 'K';
            if (this.castling.wq) castle += 'Q';
            if (this.castling.bk) castle += 'k';
            if (this.castling.bq) castle += 'q';
            const ep = this.epTarget ? sq(this.epTarget.x, this.epTarget.z) : '-';
            return `${placement} ${this.turn === WHITE ? 'w' : 'b'} ${castle || '-'} ${ep} ${this.halfmove} ${this.fullmove}`;
        }

        // ── Consultas ────────────────────────────────────────
        pieceAt(x, z) {
            if (!onBoard(x, z)) return null;
            const cell = this.board[z * 8 + x];
            return cell ? { type: cell.type, color: cell.color, x, z } : null;
        }

        getPieces() {
            const out = [];
            for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
                const cell = this.board[z * 8 + x];
                if (cell) out.push({ type: cell.type, color: cell.color, x, z });
            }
            return out;
        }

        findKing(color) {
            for (let i = 0; i < 64; i++) {
                const cell = this.board[i];
                if (cell && cell.type === 'king' && cell.color === color) {
                    return { x: i % 8, z: (i - i % 8) / 8 };
                }
            }
            return null;
        }

        // Casillas ATACADAS (distinto de "casillas a las que puedo mover"):
        // un peón ataca solo en diagonal aunque la casilla esté vacía,
        // y NO ataca la casilla a la que avanza.
        isSquareAttacked(x, z, byColor) {
            const b = this.board;
            // Peones: un peón de byColor en (x±1, z-d) ataca (x,z)
            const d = byColor === WHITE ? 1 : -1;
            for (const dx of [-1, 1]) {
                const px = x + dx, pz = z - d;
                if (onBoard(px, pz)) {
                    const cell = b[pz * 8 + px];
                    if (cell && cell.type === 'pawn' && cell.color === byColor) return true;
                }
            }
            // Caballos
            for (const [dx, dz] of KNIGHT_JUMPS) {
                const nx = x + dx, nz = z + dz;
                if (onBoard(nx, nz)) {
                    const cell = b[nz * 8 + nx];
                    if (cell && cell.type === 'knight' && cell.color === byColor) return true;
                }
            }
            // Rey contrario (adyacencia)
            for (const [dx, dz] of KING_STEPS) {
                const nx = x + dx, nz = z + dz;
                if (onBoard(nx, nz)) {
                    const cell = b[nz * 8 + nx];
                    if (cell && cell.type === 'king' && cell.color === byColor) return true;
                }
            }
            // Deslizantes: torre/dama y alfil/dama
            const rays = [
                [ROOK_DIRS, 'rook'],
                [BISHOP_DIRS, 'bishop']
            ];
            for (const [dirs, slider] of rays) {
                for (const [dx, dz] of dirs) {
                    let nx = x + dx, nz = z + dz;
                    while (onBoard(nx, nz)) {
                        const cell = b[nz * 8 + nx];
                        if (cell) {
                            if (cell.color === byColor && (cell.type === slider || cell.type === 'queen')) return true;
                            break;
                        }
                        nx += dx; nz += dz;
                    }
                }
            }
            return false;
        }

        isInCheck(color) {
            const king = this.findKing(color);
            if (!king) return false;
            return this.isSquareAttacked(king.x, king.z, other(color));
        }

        // ── Generación de movimientos ────────────────────────
        _pseudoForSquare(x, z, out) {
            const cell = this.board[z * 8 + x];
            if (!cell) return;
            const color = cell.color;
            const self = this;

            function add(toX, toZ, extra) {
                out.push(Object.assign({ fromX: x, fromZ: z, toX, toZ, promotion: null }, extra || {}));
            }
            function targetCell(toX, toZ) { return self.board[toZ * 8 + toX]; }
            function addStep(toX, toZ) {
                if (!onBoard(toX, toZ)) return;
                const t = targetCell(toX, toZ);
                if (!t) add(toX, toZ);
                else if (t.color !== color) add(toX, toZ, { isCapture: true });
            }
            function addSlide(dirs) {
                for (const [dx, dz] of dirs) {
                    let nx = x + dx, nz = z + dz;
                    while (onBoard(nx, nz)) {
                        const t = targetCell(nx, nz);
                        if (!t) { add(nx, nz); }
                        else { if (t.color !== color) add(nx, nz, { isCapture: true }); break; }
                        nx += dx; nz += dz;
                    }
                }
            }

            switch (cell.type) {
                case 'pawn': {
                    const d = color === WHITE ? 1 : -1;
                    const startZ = color === WHITE ? 1 : 6;
                    const lastZ = color === WHITE ? 7 : 0;
                    const addPawn = (toX, toZ, extra) => {
                        if (toZ === lastZ) {
                            for (const promo of PROMOTABLE) {
                                out.push(Object.assign({ fromX: x, fromZ: z, toX, toZ, promotion: promo }, extra || {}));
                            }
                        } else {
                            add(toX, toZ, extra);
                        }
                    };
                    // Avance (nunca captura de frente)
                    if (onBoard(x, z + d) && !targetCell(x, z + d)) {
                        addPawn(x, z + d);
                        if (z === startZ && !targetCell(x, z + 2 * d)) {
                            add(x, z + 2 * d, { double: true });
                        }
                    }
                    // Capturas en diagonal + captura al paso
                    for (const dx of [-1, 1]) {
                        const nx = x + dx, nz = z + d;
                        if (!onBoard(nx, nz)) continue;
                        const t = targetCell(nx, nz);
                        if (t && t.color !== color) {
                            addPawn(nx, nz, { isCapture: true });
                        } else if (!t && this.epTarget && this.epTarget.x === nx && this.epTarget.z === nz) {
                            add(nx, nz, { isCapture: true, enPassant: true });
                        }
                    }
                    break;
                }
                case 'knight':
                    for (const [dx, dz] of KNIGHT_JUMPS) addStep(x + dx, z + dz);
                    break;
                case 'bishop': addSlide(BISHOP_DIRS); break;
                case 'rook': addSlide(ROOK_DIRS); break;
                case 'queen': addSlide(ROOK_DIRS); addSlide(BISHOP_DIRS); break;
                case 'king': {
                    for (const [dx, dz] of KING_STEPS) addStep(x + dx, z + dz);
                    // Enroque: rey en su casilla inicial, derechos vigentes,
                    // casillas intermedias vacías, rey no en jaque y sin
                    // atravesar casillas atacadas.
                    const homeZ = color === WHITE ? 0 : 7;
                    if (x === 4 && z === homeZ) {
                        const enemy = other(color);
                        const rightK = color === WHITE ? this.castling.wk : this.castling.bk;
                        const rightQ = color === WHITE ? this.castling.wq : this.castling.bq;
                        const rookK = targetCell(7, homeZ);
                        const rookQ = targetCell(0, homeZ);
                        if (rightK && rookK && rookK.type === 'rook' && rookK.color === color &&
                            !targetCell(5, homeZ) && !targetCell(6, homeZ) &&
                            !this.isSquareAttacked(4, homeZ, enemy) &&
                            !this.isSquareAttacked(5, homeZ, enemy) &&
                            !this.isSquareAttacked(6, homeZ, enemy)) {
                            add(6, homeZ, { castle: 'king' });
                        }
                        if (rightQ && rookQ && rookQ.type === 'rook' && rookQ.color === color &&
                            !targetCell(3, homeZ) && !targetCell(2, homeZ) && !targetCell(1, homeZ) &&
                            !this.isSquareAttacked(4, homeZ, enemy) &&
                            !this.isSquareAttacked(3, homeZ, enemy) &&
                            !this.isSquareAttacked(2, homeZ, enemy)) {
                            add(2, homeZ, { castle: 'queen' });
                        }
                    }
                    break;
                }
            }
        }

        // Movimientos legales de la pieza en (x,z). Solo para el color al turno.
        movesFor(x, z) {
            const cell = onBoard(x, z) ? this.board[z * 8 + x] : null;
            if (!cell || cell.color !== this.turn) return [];
            const pseudo = [];
            this._pseudoForSquare(x, z, pseudo);
            const legal = [];
            for (const m of pseudo) {
                const info = this._apply(m);
                if (!this.isInCheck(cell.color)) legal.push(m);
                this._undo(m, info);
            }
            return legal;
        }

        allLegalMoves() {
            const out = [];
            for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
                const cell = this.board[z * 8 + x];
                if (cell && cell.color === this.turn) {
                    const mv = this.movesFor(x, z);
                    for (const m of mv) out.push(m);
                }
            }
            return out;
        }

        hasAnyLegalMove() {
            for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
                const cell = this.board[z * 8 + x];
                if (cell && cell.color === this.turn && this.movesFor(x, z).length > 0) return true;
            }
            return false;
        }

        // ¿Este movimiento requiere elegir pieza de promoción?
        needsPromotion(fromX, fromZ, toX, toZ) {
            const cell = onBoard(fromX, fromZ) ? this.board[fromZ * 8 + fromX] : null;
            if (!cell || cell.type !== 'pawn' || cell.color !== this.turn) return false;
            const lastZ = cell.color === WHITE ? 7 : 0;
            if (toZ !== lastZ) return false;
            return this.movesFor(fromX, fromZ).some(m => m.toX === toX && m.toZ === toZ);
        }

        // ── Aplicar / deshacer (interno) ─────────────────────
        _apply(m) {
            const fromI = m.fromZ * 8 + m.fromX;
            const toI = m.toZ * 8 + m.toX;
            const piece = this.board[fromI];
            const info = {
                captured: null, capturedX: null, capturedZ: null,
                prevCastling: Object.assign({}, this.castling),
                prevEp: this.epTarget,
                prevHalf: this.halfmove,
                prevFull: this.fullmove,
                wasPawn: piece.type === 'pawn'
            };

            let captured = this.board[toI];
            if (m.enPassant) {
                const capI = m.fromZ * 8 + m.toX; // el peón capturado está al lado, no en destino
                captured = this.board[capI];
                this.board[capI] = null;
                info.capturedX = m.toX; info.capturedZ = m.fromZ;
            } else if (captured) {
                info.capturedX = m.toX; info.capturedZ = m.toZ;
            }
            info.captured = captured || null;

            this.board[toI] = piece;
            this.board[fromI] = null;
            if (m.promotion) piece.type = m.promotion;

            if (m.castle) {
                const zz = m.fromZ;
                if (m.castle === 'king') {
                    this.board[zz * 8 + 5] = this.board[zz * 8 + 7];
                    this.board[zz * 8 + 7] = null;
                } else {
                    this.board[zz * 8 + 3] = this.board[zz * 8 + 0];
                    this.board[zz * 8 + 0] = null;
                }
            }

            // Derechos de enroque: el rey movió (con o sin enroque)
            if (piece.type === 'king' || m.castle) {
                if (piece.color === WHITE) { this.castling.wk = false; this.castling.wq = false; }
                else { this.castling.bk = false; this.castling.bq = false; }
            }
            // Torre que se mueve desde su esquina
            if (m.fromX === 0 && m.fromZ === 0) this.castling.wq = false;
            if (m.fromX === 7 && m.fromZ === 0) this.castling.wk = false;
            if (m.fromX === 0 && m.fromZ === 7) this.castling.bq = false;
            if (m.fromX === 7 && m.fromZ === 7) this.castling.bk = false;
            // Torre capturada en su esquina
            if (info.captured) {
                if (info.capturedX === 0 && info.capturedZ === 0) this.castling.wq = false;
                if (info.capturedX === 7 && info.capturedZ === 0) this.castling.wk = false;
                if (info.capturedX === 0 && info.capturedZ === 7) this.castling.bq = false;
                if (info.capturedX === 7 && info.capturedZ === 7) this.castling.bk = false;
            }

            // Casilla de captura al paso para el próximo turno
            this.epTarget = m.double ? { x: m.fromX, z: (m.fromZ + m.toZ) / 2 } : null;

            // Relojes
            if (info.wasPawn || info.captured) this.halfmove = 0;
            else this.halfmove++;
            if (this.turn === BLACK) this.fullmove++;
            this.turn = other(this.turn);
            return info;
        }

        _undo(m, info) {
            const fromI = m.fromZ * 8 + m.fromX;
            const toI = m.toZ * 8 + m.toX;
            const piece = this.board[toI];
            this.board[fromI] = piece;
            this.board[toI] = null;
            if (m.promotion) piece.type = 'pawn';
            if (m.castle) {
                const zz = m.fromZ;
                if (m.castle === 'king') {
                    this.board[zz * 8 + 7] = this.board[zz * 8 + 5];
                    this.board[zz * 8 + 5] = null;
                } else {
                    this.board[zz * 8 + 0] = this.board[zz * 8 + 3];
                    this.board[zz * 8 + 3] = null;
                }
            }
            if (info.captured) {
                this.board[info.capturedZ * 8 + info.capturedX] = info.captured;
            }
            this.castling = info.prevCastling;
            this.epTarget = info.prevEp;
            this.halfmove = info.prevHalf;
            this.fullmove = info.prevFull;
            this.turn = other(this.turn);
        }

        // ── API pública de juego ─────────────────────────────
        // makeMove({fromX, fromZ, toX, toZ, promotion}) → registro | null
        // En promoción, `promotion` es OBLIGATORIO ('queen'|'rook'|'bishop'|'knight').
        // opts.search=true: modo búsqueda IA (sin historial ni repetición, más rápido).
        makeMove(input, opts) {
            const search = !!(opts && opts.search);
            const { fromX, fromZ, toX, toZ } = input;
            if (!onBoard(fromX, fromZ) || !onBoard(toX, toZ)) return null;
            const cell = this.board[fromZ * 8 + fromX];
            if (!cell || cell.color !== this.turn) return null;

            const candidates = this.movesFor(fromX, fromZ).filter(m => m.toX === toX && m.toZ === toZ);
            if (candidates.length === 0) return null;

            let move;
            if (candidates[0].promotion) {
                const promo = input.promotion;
                if (!promo || !PROMOTABLE.includes(promo)) return null; // elección explícita obligatoria
                move = candidates.find(m => m.promotion === promo);
                if (!move) return null;
            } else {
                move = candidates[0];
            }

            const color = cell.color;
            const pieceType = cell.type;
            const info = this._apply(move);
            this._stack.push({ move, info, real: !search });

            const record = {
                color,
                type: pieceType,
                fromX, fromZ, toX, toZ,
                promotion: move.promotion || null,
                castle: move.castle || null,
                rookMove: move.castle
                    ? (move.castle === 'king'
                        ? { fromX: 7, fromZ, toX: 5, toZ: fromZ }
                        : { fromX: 0, fromZ, toX: 3, toZ: fromZ })
                    : null,
                enPassant: !!move.enPassant,
                captured: info.captured
                    ? { type: info.captured.type, color: info.captured.color, x: info.capturedX, z: info.capturedZ }
                    : null,
                lan: sq(fromX, fromZ) + sq(toX, toZ) + (move.promotion ? TYPE_FEN[move.promotion] : '')
            };

            if (!search) {
                this._bumpRepetition();
                record.check = this.isInCheck(this.turn);
                record.status = this.getStatus();
                this.history.push(record);
            }
            return record;
        }

        undo() {
            const entry = this._stack.pop();
            if (!entry) return null;
            if (entry.real) {
                this._decRepetition();
                this.history.pop();
            }
            this._undo(entry.move, entry.info);
            return entry.move;
        }

        // ── Estado de la partida ─────────────────────────────
        // → { over, state, winner, reason }
        //   state: 'playing'|'check'|'checkmate'|'stalemate'|
        //          'fifty_moves'|'threefold'|'insufficient_material'
        //   winner: 'white'|'black'|'draw'|null
        getStatus() {
            const inCheck = this.isInCheck(this.turn);
            if (!this.hasAnyLegalMove()) {
                if (inCheck) {
                    return { over: true, state: 'checkmate', winner: other(this.turn), reason: 'jaque mate' };
                }
                return { over: true, state: 'stalemate', winner: 'draw', reason: 'rey ahogado' };
            }
            if (this._insufficientMaterial()) {
                return { over: true, state: 'insufficient_material', winner: 'draw', reason: 'material insuficiente' };
            }
            if (this.halfmove >= 100) {
                return { over: true, state: 'fifty_moves', winner: 'draw', reason: 'regla de 50 movimientos' };
            }
            if ((this.repetition.get(this._positionKey()) || 0) >= 3) {
                return { over: true, state: 'threefold', winner: 'draw', reason: 'triple repetición' };
            }
            return { over: false, state: inCheck ? 'check' : 'playing', winner: null, reason: null };
        }

        _insufficientMaterial() {
            const rest = [];
            for (let i = 0; i < 64; i++) {
                const cell = this.board[i];
                if (cell && cell.type !== 'king') {
                    if (cell.type === 'pawn' || cell.type === 'rook' || cell.type === 'queen') return false;
                    rest.push({ type: cell.type, sqColor: (i % 8 + ((i - i % 8) / 8)) % 2 });
                }
            }
            if (rest.length === 0) return true;                      // K vs K
            if (rest.length === 1) return true;                      // K+B/K+N vs K
            const bishops = rest.filter(p => p.type === 'bishop');
            if (bishops.length === rest.length &&
                bishops.every(b => b.sqColor === bishops[0].sqColor)) return true; // alfiles del mismo color
            return false;
        }

        // ── Repetición ───────────────────────────────────────
        _positionKey() {
            // Posición + turno + derechos de enroque + casilla al paso
            let key = '';
            for (let i = 0; i < 64; i++) {
                const cell = this.board[i];
                key += cell ? (cell.color === WHITE ? TYPE_FEN[cell.type].toUpperCase() : TYPE_FEN[cell.type]) : '.';
            }
            key += this.turn === WHITE ? 'w' : 'b';
            key += (this.castling.wk ? 'K' : '') + (this.castling.wq ? 'Q' : '') +
                (this.castling.bk ? 'k' : '') + (this.castling.bq ? 'q' : '');
            key += this.epTarget ? sq(this.epTarget.x, this.epTarget.z) : '-';
            return key;
        }

        _bumpRepetition() {
            const key = this._positionKey();
            this.repetition.set(key, (this.repetition.get(key) || 0) + 1);
        }

        _decRepetition() {
            const key = this._positionKey();
            const n = (this.repetition.get(key) || 0) - 1;
            if (n <= 0) this.repetition.delete(key); else this.repetition.set(key, n);
        }

        // ── Perft (para tests) ───────────────────────────────
        perft(depth) {
            if (depth === 0) return 1;
            let nodes = 0;
            const moves = this.allLegalMoves();
            if (depth === 1) return moves.length;
            for (const m of moves) {
                const info = this._apply(m);
                nodes += this.perft(depth - 1);
                this._undo(m, info);
            }
            return nodes;
        }
    }

    ChessEngine.START_FEN = START_FEN;
    ChessEngine.WHITE = WHITE;
    ChessEngine.BLACK = BLACK;
    ChessEngine.PROMOTABLE = PROMOTABLE;

    return ChessEngine;
});
