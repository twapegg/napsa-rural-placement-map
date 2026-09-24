// Attach Cached Coords  (Code node, "Run Once for All Items")
// Input: every row of the coordinate cache (Get Cached Coords, executeOnce).
// Output: one item per sheet row, with coordinates from the sheet or the cache
// where those are present AND land in the state the address names. Anything
// else is flagged for geocoding.

const STATE_BOX = {
  NSW:[-37.6,-28.1,140.9,153.7], VIC:[-39.3,-33.9,140.9,150.1],
  QLD:[-29.3, -9.0,137.9,153.6], SA: [-38.2,-25.9,128.9,141.1],
  WA: [-35.2,-13.6,112.8,129.1], TAS:[-43.7,-39.1,143.8,148.6],
  NT: [-26.1,-10.9,128.9,138.1], ACT:[-35.95,-35.1,148.7,149.5]
};
const norm = s => String(s == null ? '' : s).replace(/​/g, '').replace(/\s+/g, ' ').trim();
const stateOf = a => { const m = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/.exec(a || ''); return m ? m[1] : null; };
const inState = (lat, lng, st) => { const b = STATE_BOX[st]; return !b || (lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3]); };
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(v); return isFinite(n) ? n : null; };

// Cache keyed on the normalised name, so trailing spaces and newlines in the
// sheet can no longer make an existing entry invisible.
const cache = {};
for (const it of items) {
  const r = it.json || {};
  const k = norm(r.pharmacyName);
  if (k && !cache[k]) cache[k] = r;
}

return $('Get Pharmacies').all().map(it => {
  const row = it.json;
  const name = norm(row['Pharmacy Name']);
  const address = norm(row['Address']);
  const st = stateOf(address);

  let lat = null, lng = null, source = null;

  // 1. Coordinates typed into the sheet win, if they are plausible.
  const sl = num(row['Latitude']), sg = num(row['Longitude']);
  if (sl !== null && sg !== null && (!st || inState(sl, sg, st))) { lat = sl; lng = sg; source = 'sheet'; }

  // 2. Otherwise the cache, again only if it agrees with the address.
  if (!source) {
    const c = cache[name];
    const cl = c ? num(c.latitude) : null, cg = c ? num(c.longitude) : null;
    if (cl !== null && cg !== null && (!st || inState(cl, cg, st))) { lat = cl; lng = cg; source = 'cache'; }
  }

  return { json: {
    ...row,
    'Pharmacy Name': name,
    'Address': address,
    Latitude: lat, Longitude: lng,
    _state: st, _coordSource: source, _needsGeocode: !source, _newlyGeocoded: false
  } };
});
