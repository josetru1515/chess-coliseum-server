/* Verifica que makeUnlockToken es IDÉNTICO entre chess_coliseum_pro/index.html
 * y mundo/mundo-frontend/src/App.jsx, y que verifyUnlockToken acepta/rechaza
 * correctamente. Ejecutar desde a_growingnow:  node chess_coliseum_pro/tests/check_unlock_token.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'chess_coliseum_pro', 'index.html'), 'utf8');
const appjsx = fs.readFileSync(path.join(root, 'mundo', 'mundo-frontend', 'src', 'App.jsx'), 'utf8');

// Extrae una función contando llaves (los regex no sirven con llaves anidadas)
function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`);
    if (start === -1) throw new Error(`${name} no encontrado`);
    let i = src.indexOf('{', start);
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }
    const code = src.slice(start, i + 1);
    return code;
}

const chessMakeSrc = extractFn(html, 'makeUnlockToken');
const mundoMakeSrc = extractFn(appjsx, 'makeUnlockToken');
const mundoVerifySrc = extractFn(appjsx, 'verifyUnlockToken');

const chessMake = new Function('skin', 'ts', chessMakeSrc.slice(chessMakeSrc.indexOf('{') + 1, -1));
const mundoMake = new Function('skin', 'ts', mundoMakeSrc.slice(mundoMakeSrc.indexOf('{') + 1, -1));

let ok = true;
function check(name, cond) {
    if (cond) console.log(`  ✔ ${name}`);
    else { ok = false; console.error(`  ✘ ${name}`); }
}

// 1. Mismos tokens en ambos lados
const ts = 1750000000000;
for (const skin of ['verde', 'blanca', 'alanegra', 'Dimensius']) {
    check(`token idéntico para '${skin}'`, chessMake(skin, ts) === mundoMake(skin, ts));
}

// 2. verifyUnlockToken con el contexto que tiene en App.jsx
const UNLOCKABLE_SKINS = ['verde', 'blanca', 'alanegra', 'Dimensius'];
const UNLOCK_TOKEN_MAX_AGE_MS = 10 * 60 * 1000;
const verifyBody = mundoVerifySrc.slice(mundoVerifySrc.indexOf('{') + 1, -1);
const verify = new Function('skin', 'token', 'UNLOCKABLE_SKINS', 'UNLOCK_TOKEN_MAX_AGE_MS', 'makeUnlockToken', verifyBody);
const v = (skin, token) => verify(skin, token, UNLOCKABLE_SKINS, UNLOCK_TOKEN_MAX_AGE_MS, mundoMake);

const now = Date.now();
check('token legítimo de chess → aceptado', v('verde', chessMake('verde', now)) === true);
check('token inventado → rechazado', v('verde', `${now}.abc123`) === false);
check('skin no canjeable (orcos) → rechazada', v('orcos', chessMake('orcos', now)) === false);
check('token caducado (>10 min) → rechazado', v('verde', chessMake('verde', now - 11 * 60 * 1000)) === false);
check('sin token → rechazado', v('Dimensius', null) === false);
check('token de otra skin → rechazado', v('Dimensius', chessMake('verde', now)) === false);

console.log(ok ? '\n✔ TOKEN OK' : '\n✘ HAY FALLOS');
process.exit(ok ? 0 : 1);
