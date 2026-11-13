'use strict';
const assert = require('node:assert/strict');
const M = require('./detector.js');
global.atob ??= str => Buffer.from(str, 'base64').toString('binary');
global.btoa ??= str => Buffer.from(str, 'binary').toString('base64');
const S = M.SIZE, R = S + M.MARGIN * 2;
function pixel(x, y, c) { return (x * 13 + y * 23 + x * y * 7 + c * 61) & 255; }
function source(w, h) { const a = new Uint8Array(w*h*4); for(let y=0;y<h;y++) for(let x=0;x<w;x++) for(let c=0;c<4;c++) a[(y*w+x)*4+c]=c===3?255:pixel(x,y,c);return a; }
function crop(image, w, x0, y0, s) { const a=new Uint8Array(s*s*4);for(let y=0;y<s;y++) for(let x=0;x<s;x++) for(let c=0;c<4;c++)a[(y*s+x)*4+c]=image[((y+y0)*w+x+x0)*4+c];return a; }
const img = source(R,R), pos = M.MARGIN;
const patch = crop(img,R,pos,pos,S);
const tmpl = M.validatedTemplate(M.templateFromCapture(patch));
const perfect = M.bestMatch(tmpl,img,R,R);
assert.ok(perfect > .9999, 'perfect match');
const offsetImg = source(R,R);
// Shift entire pattern by (5,-3) with neutral background; should still find template.
const shifted = new Uint8Array(offsetImg.length).fill(31);
for(let y=0;y<S;y++)for(let x=0;x<S;x++)for(let c=0;c<4;c++)shifted[((y+pos-3)*R+(x+pos+5))*4+c]=patch[(y*S+x)*4+c];
const shiftedScore = M.bestMatch(tmpl,shifted,R,R);
assert.ok(shiftedScore > .9999, 'shifted match');
const others = new Uint8Array(R*R*4).fill(200);
assert.ok(M.bestMatch(tmpl,others,R,R) < 0.95, 'non-match rejected');
assert.equal(M.newClick(null,20), false);
assert.equal(M.newClick(100,160), false);
assert.equal(M.newClick(4000,20), true);
assert.equal(M.newClick(80,30), true);
assert.equal(M.newClick(4000,600), false);
assert.equal(M.near({x:50,y:50},{x:60,y:60},24), true);
assert.equal(M.near({x:50,y:50},{x:90,y:90},24), false);
assert.throws(()=>M.templateFromCapture(new Uint8Array(S*S*4).fill(0)), /too little detail/);
assert.throws(()=>M.fromBase64('YQ==',S,S), /buffer size/);
console.log('Detector tests: PASS. Perfect=' + perfect.toFixed(4) + ' shifted=' + shiftedScore.toFixed(4));
