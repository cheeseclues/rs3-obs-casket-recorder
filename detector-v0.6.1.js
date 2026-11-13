/* Pure, dependency-free Alt1 pixel matcher. No OS calls, game inputs, or network access. */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CasketMatcher = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 28;
  const MARGIN = 12;

  function fromBase64(encoded, width, height) {
    if (typeof encoded !== 'string' || !encoded) throw new Error('Alt1 returned no pixels. Check Screen Pixels permission.');
    const binary = atob(encoded);
    const expected = width * height * 4;
    if (binary.length !== expected) {
      throw new Error(`Unexpected Alt1 pixel buffer size (${binary.length}, expected ${expected}).`);
    }
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    return data;
  }
  function toBase64(bytes) {
    let str = '';
    // Small template only (28*28*4 bytes), no stack overflow.
    for (const b of bytes) str += String.fromCharCode(b);
    return btoa(str);
  }
  function varianceChannels(bytes) {
    const n = bytes.length / 4;
    const means = [0, 0, 0, 0], variances = [0, 0, 0, 0];
    for (let i = 0; i < bytes.length; i += 4)
      for (let c = 0; c < 4; c++) means[c] += bytes[i + c];
    for (let c = 0; c < 4; c++) means[c] /= n;
    for (let i = 0; i < bytes.length; i += 4)
      for (let c = 0; c < 4; c++) {
        const delta = bytes[i + c] - means[c]; variances[c] += delta * delta;
      }
    for (let c = 0; c < 4; c++) variances[c] /= n;
    return [0, 1, 2, 3].sort((a, b) => variances[b] - variances[a]).slice(0, 3);
  }
  function contrast(bytes, channels) {
    const n = bytes.length / 4;
    const means = channels.map(c => { let s = 0; for (let i = c; i < bytes.length; i += 4) s += bytes[i]; return s / n; });
    let s = 0;
    for (let i = 0; i < bytes.length; i += 4)
      for (let k = 0; k < channels.length; k++) s += Math.abs(bytes[i + channels[k]] - means[k]);
    return s / (n * channels.length);
  }
  function templateFromCapture(bytes) {
    if (bytes.length !== SIZE * SIZE * 4) throw new Error('Wrong calibration image dimensions.');
    const channels = varianceChannels(bytes);
    const detail = contrast(bytes, channels);
    if (detail < 9) throw new Error('Calibration image has too little detail. Hover over the CASKET ICON, not an empty slot.');
    return { version: 1, size: SIZE, channels, encoded: toBase64(bytes) };
  }
  function validatedTemplate(obj) {
    if (!obj || obj.version !== 1 || obj.size !== SIZE || !Array.isArray(obj.channels) ||
        obj.channels.length !== 3 || !obj.channels.every(c => Number.isInteger(c) && c >= 0 && c < 4) ||
        new Set(obj.channels).size !== 3) throw new Error('Saved calibration is invalid.');
    return { ...obj, bytes: fromBase64(obj.encoded, SIZE, SIZE) };
  }
  function scoreAt(templateBytes, capture, captureWidth, x, y, channels, sampleStep) {
    let difference = 0, count = 0;
    for (let row = 0; row < SIZE; row += sampleStep) {
      for (let col = 0; col < SIZE; col += sampleStep) {
        const a = (row * SIZE + col) * 4;
        const b = ((row + y) * captureWidth + col + x) * 4;
        for (const c of channels) difference += Math.abs(templateBytes[a + c] - capture[b + c]);
        count += channels.length;
      }
    }
    return 1 - (difference / (count * 255));
  }
  // Search a +/-12 pixel cursor offset, then refine +/-1 pixel at full resolution.
  // This tolerates slight differences in where the user points inside the item icon.
  function bestMatch(template, capture, captureWidth, captureHeight) {
    if (captureWidth !== SIZE + 2 * MARGIN || captureHeight !== SIZE + 2 * MARGIN)
      throw new Error('Invalid search area dimensions.');
    let score = -1, bestX = MARGIN, bestY = MARGIN;
    for (let y = 0; y <= 2 * MARGIN; y += 2) {
      for (let x = 0; x <= 2 * MARGIN; x += 2) {
        const value = scoreAt(template.bytes, capture, captureWidth, x, y, template.channels, 2);
        if (value > score) { score = value; bestX = x; bestY = y; }
      }
    }
    score = -1;
    for (let y = Math.max(0, bestY - 2); y <= Math.min(2 * MARGIN, bestY + 2); y++) {
      for (let x = Math.max(0, bestX - 2); x <= Math.min(2 * MARGIN, bestX + 2); x++) {
        const value = scoreAt(template.bytes, capture, captureWidth, x, y, template.channels, 1);
        if (value > score) score = value;
      }
    }
    return score;
  }
  // Alt1 rsLastActive is time since last click; a decrease means a new click.
  // First observation is ignored so opening the app cannot create a false trigger.
  function newClick(previousAge, currentAge) {
    return Number.isFinite(previousAge) && Number.isFinite(currentAge) &&
      previousAge >= 0 && currentAge >= 0 && currentAge <= 350 && previousAge - currentAge >= 15;
  }
  function near(a, b, maxDistance) {
    return !!a && !!b && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= maxDistance ** 2;
  }
  return { SIZE, MARGIN, fromBase64, templateFromCapture, validatedTemplate, bestMatch, newClick, near };
});
