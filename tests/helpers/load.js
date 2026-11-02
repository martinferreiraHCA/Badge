'use strict';
/* Loads the browser-style modules into the Node global scope for tests. */
const path = require('path');
const ORDER = ['core', 'jl-auth', 'jpeg', 'avi', 'gif', 'rcsp', 'badge-client', 'qr', 'patterns', 'textfx', 'clock', 'scene'];
const fs = require('fs');
for (const name of ORDER) { const f = path.join(__dirname, '..', '..', 'js', name + '.js'); if (fs.existsSync(f)) require(f); }
module.exports = globalThis.BS;
