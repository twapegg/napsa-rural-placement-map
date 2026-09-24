// Geocode Missing  (Code node, "Run Once for All Items")
// Geocodes rows flagged _needsGeocode, a few per request, one at a time,
// inside the same loop iteration as the row — so a result can never be
// attributed to a different pharmacy. Everything else passes straight through.

const MAX_NEW_PER_REQUEST = 6;   // worst case ~6 x (3 queries x 1.1s) ≈ 20s; the rest heal on later requests
const SPACING_MS = 1100;         // Nominatim usage policy: at most 1 request per second
const UA = 'NAPSA-Rural-Placement-Map/1.0 (locumco.com.au)';

const STATE_BOX = {
  NSW:[-37.6,-28.1,140.9,153.7], VIC:[-39.3,-33.9,140.9,150.1],
  QLD:[-29.3, -9.0,137.9,153.6], SA: [-38.2,-25.9,128.9,141.1],
  WA: [-35.2,-13.6,112.8,129.1], TAS:[-43.7,-39.1,143.8,148.6],
  NT: [-26.1,-10.9,128.9,138.1], ACT:[-35.95,-35.1,148.7,149.5]
};
const inState = (lat, lng, st) => { const b = STATE_BOX[st]; return !b || (lat >= b[0] && lat <= b[1] && lng >= b[2] && lng <= b[3]); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STREET = '(?:St|Street|Rd|Road|Ave|Avenue|Hwy|Highway|Dr|Drive|Pde|Parade|Tce|Terrace|Ln|Lane|Cres|Crescent|Pl|Place|Blvd|Boulevard|Way|Esp|Esplanade|Mall|Cct|Circuit|Ct|Court)';

// Pull "Suburb, STATE, postcode" out of a free-text address. Tolerates the
// usual variations — "Coffs Harbour, NSW 2450", "Tamworth NSW, 2340",
// "Yeppoon QLD 4703" — by locating the state code and reading around it.
function locality(address) {
  const parts = address.split(',').map(s => s.trim()).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const m = /^(.*?)\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b(.*)$/.exec(parts[i]);
    if (!m) continue;
    let suburb = m[1].replace(/[\d\/-]+$/, '').trim();
    if (!suburb && i > 0) suburb = parts[i - 1].replace(/^(shop|unit|suite|lot|level)\s*\S+\s*/i, '').trim();
    const pc = /\b(\d{4})\b/.exec(m[3] + ' ' + (parts[i + 1] || ''));
    if (!suburb) return null;
    return { suburb, state: m[2], postcode: pc ? pc[1] : null };
  }
  return null;
}

// Most to least specific. Shop numbers and centre names are what trip
// Nominatim up, so later forms peel those away: street-number onwards, then
// the street with the locality, then the locality alone — which at least
// puts the pin in the right town.
function candidates(address) {
  const out = [address];
  const loc = locality(address);
  const locStr = loc ? [loc.suburb, loc.state, loc.postcode, 'Australia'].filter(Boolean).join(', ') : null;

  const m = new RegExp('(\\d+[A-Za-z]?(?:\\s*[-\\u2013]\\s*\\d+)?\\s+[^,]*?\\b' + STREET + '\\b[^,]*),?\\s*(.*)$', 'i').exec(address);
  if (m) out.push((m[1] + ', ' + m[2]).replace(/^[ ,]+|[ ,]+$/g, ''));

  if (locStr) {
    const street = address.split(',').map(s => s.trim())
      .find(seg => new RegExp('\\b' + STREET + '\\b', 'i').test(seg) && !/\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/.test(seg));
    if (street) out.push(street.replace(/^(shop|unit|suite|lot|level)\s*\S+\s*/i, '') + ', ' + locStr);
    out.push(locStr);
  }
  return [...new Set(out.map(s => s.trim()).filter(Boolean))];
}

// Nominatim's first result is not always the right one: "Stewart Street,
// Bathurst" comes back with a rural Stewart Street in Evans Plains ranked
// above the one in town. Score each candidate by how many of its own words
// the address actually contains, and penalise words it invents.
const ABBR = [[/\bst\b/g,'street'],[/\brd\b/g,'road'],[/\bave?\b/g,'avenue'],[/\bhwy\b/g,'highway'],[/\bdr\b/g,'drive'],
              [/\bpde\b/g,'parade'],[/\btce\b/g,'terrace'],[/\bcres\b/g,'crescent'],[/\bpl\b/g,'place'],[/\bblvd\b/g,'boulevard'],
              [/\bln\b/g,'lane'],[/\bct\b/g,'court'],[/\bcct\b/g,'circuit'],[/\besp\b/g,'esplanade']];
const GENERIC = new Set(['australia','new','south','wales','queensland','victoria','western','northern','territory','tasmania',
                         'capital','nsw','vic','qld','sa','wa','tas','nt','act','shire','city','council','regional','of','the']);
function tokens(s) {
  let t = String(s || '').toLowerCase();
  for (const [re, full] of ABBR) t = t.replace(re, full);
  return new Set(t.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 1));
}
function score(result, address) {
  const a = tokens(address);
  let s = 0;
  for (const w of tokens(result.display_name)) { if (GENERIC.has(w)) continue; s += a.has(w) ? 1 : -0.5; }
  return s;
}

async function query(q) {
  const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=3&countrycodes=au&q=' + encodeURIComponent(q);
  const res = await this.helpers.httpRequest({
    method: 'GET', url, json: true,
    headers: { 'User-Agent': UA, 'Accept-Language': 'en' }
  });
  return Array.isArray(res) ? res : [];
}

let budget = MAX_NEW_PER_REQUEST;
const out = [];

for (const it of items) {
  const row = it.json;
  if (!row._needsGeocode || budget <= 0) { out.push({ json: row }); continue; }
  budget--;

  let found = null;
  for (const q of candidates(row['Address'])) {
    let results = [];
    try { results = await query.call(this, q); } catch (e) { results = []; }
    await sleep(SPACING_MS);
    // Keep only results inside the right state, then take the best-matching one.
    const valid = results
      .map(r => ({ lat: parseFloat(r.lat), lng: parseFloat(r.lon), s: score(r, row['Address']) }))
      .filter(r => isFinite(r.lat) && isFinite(r.lng) && (!row._state || inState(r.lat, r.lng, row._state)));
    if (valid.length) {
      valid.sort((x, y) => y.s - x.s);
      found = { lat: valid[0].lat, lng: valid[0].lng };
      break;
    }
  }

  out.push({ json: {
    ...row,
    Latitude: found ? found.lat : null,
    Longitude: found ? found.lng : null,
    _coordSource: found ? 'geocoded' : null,
    _needsGeocode: !found,
    _newlyGeocoded: !!found
  } });
}

return out;
