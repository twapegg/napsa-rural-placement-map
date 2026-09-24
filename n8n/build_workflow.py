"""Build the corrected 'NAPSA Map - Get Pharmacies' workflow from the backup.

Keeps Webhook, Get Pharmacies, Get Cached Coords, Format for Map, Respond,
Cache Coordinates. Replaces the three middle nodes (Merge Cached Coords,
Geocode Address, Merge Geocode Result) with two Code nodes whose source lives
in node_attach_cache.js / node_geocode_missing.js, and inserts a filter so
only newly geocoded rows are written back to the cache.

Writes wf_new.json in the shape PUT /api/v1/workflows/{id} accepts.
"""
import json, io, sys, copy

SRC, OUT = sys.argv[1], sys.argv[2]
JS_ATTACH = io.open("node_attach_cache.js", encoding="utf-8").read()
JS_GEOCODE = io.open("node_geocode_missing.js", encoding="utf-8").read()

w = json.load(io.open(SRC, encoding="utf-8"))
by = {n["name"]: n for n in w["nodes"]}

# --- nodes we keep (with tweaks) -------------------------------------------
webhook  = by["Webhook"]
sheets   = by["Get Pharmacies"]
cacheget = copy.deepcopy(by["Get Cached Coords"])
cacheget["executeOnce"] = True          # was running once per sheet row: 68 reads of the whole table
fmt      = copy.deepcopy(by["Format for Map"])
respond  = by["Respond to Webhook"]
cacheput = copy.deepcopy(by["Cache Coordinates"])

# Format for Map: same shape the map already consumes; names/addresses are
# normalised upstream now, and the working fields never leave the workflow.
fmt["parameters"]["jsCode"] = """// Map each sheet row into the JSON shape the MapLibre map expects.
const pharmacies = items.map(item => {
  const row = item.json;
  const num = v => (v === '' || v == null) ? null : (isFinite(parseFloat(v)) ? parseFloat(v) : null);
  return {
    name: row['Pharmacy Name'] || '',
    address: row['Address'] || '',
    lat: num(row['Latitude']),
    lng: num(row['Longitude']),
    mmm: row['MMM'] == null ? '' : String(row['MMM']),
    contactPerson: row['Contact Person'] || '',
    email: row['Email'] || '',
    phone: row['Phone'] == null ? '' : String(row['Phone']),
    services: row['Services & Experience Offered'] || '',
    accommodation: row['Accommodation'] || '',
    internPosition: row['Intern Pharmacist Position'] || ''
  };
});

return [{ json: { pharmacies } }];
"""

# Cache upsert: key on the normalised name that Attach Cached Coords produces.
cacheput["parameters"]["columns"]["value"] = {
    "pharmacyName": "={{ $json['Pharmacy Name'] }}",
    "latitude":     "={{ $json['Latitude'] }}",
    "longitude":    "={{ $json['Longitude'] }}",
    "address":      "={{ $json['Address'] }}",
}
cacheput["parameters"]["filters"]["conditions"] = [
    {"condition": "eq", "keyName": "pharmacyName", "keyValue": "={{ $json['Pharmacy Name'] }}"}
]

# --- new nodes --------------------------------------------------------------
def code_node(name, js, pos):
    return {"parameters": {"jsCode": js}, "id": name.lower().replace(" ", "-"), "name": name,
            "type": "n8n-nodes-base.code", "typeVersion": 2, "position": pos}

attach  = code_node("Attach Cached Coords", JS_ATTACH, [660, 300])
geocode = code_node("Geocode Missing", JS_GEOCODE, [880, 300])
onlynew = code_node("Only New Coordinates",
                    "// Write back only what was geocoded on this request.\nreturn items.filter(i => i.json._newlyGeocoded === true);",
                    [1100, 480])

# tidy positions left to right
webhook["position"]  = [220, 300]
sheets["position"]   = [440, 300]
cacheget["position"] = [440, 480]
fmt["position"]      = [1100, 300]
respond["position"]  = [1320, 300]
cacheput["position"] = [1320, 480]

nodes = [webhook, sheets, cacheget, attach, geocode, fmt, respond, onlynew, cacheput]

connections = {
    "Webhook":               {"main": [[{"node": "Get Pharmacies",       "type": "main", "index": 0}]]},
    "Get Pharmacies":        {"main": [[{"node": "Get Cached Coords",    "type": "main", "index": 0}]]},
    "Get Cached Coords":     {"main": [[{"node": "Attach Cached Coords", "type": "main", "index": 0}]]},
    "Attach Cached Coords":  {"main": [[{"node": "Geocode Missing",      "type": "main", "index": 0}]]},
    "Geocode Missing":       {"main": [[{"node": "Format for Map",       "type": "main", "index": 0},
                                        {"node": "Only New Coordinates", "type": "main", "index": 0}]]},
    "Format for Map":        {"main": [[{"node": "Respond to Webhook",   "type": "main", "index": 0}]]},
    "Only New Coordinates":  {"main": [[{"node": "Cache Coordinates",    "type": "main", "index": 0}]]},
}

payload = {
    "name": w["name"],
    "nodes": nodes,
    "connections": connections,
    "settings": w.get("settings", {}),
    "staticData": w.get("staticData"),
}
json.dump(payload, io.open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print("built", OUT)
print("nodes:", [n["name"] for n in nodes])
print("removed:", sorted(set(by) - {n["name"] for n in nodes}))
print("Get Cached Coords executeOnce:", cacheget.get("executeOnce"))
# sanity: every connection target exists
names = {n["name"] for n in nodes}
bad = [(s, c["node"]) for s, o in connections.items() for lane in o["main"] for c in lane if c["node"] not in names or s not in names]
print("dangling connections:", bad or "none")
