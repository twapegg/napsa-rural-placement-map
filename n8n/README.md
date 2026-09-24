# The data feed behind the map

The map reads `https://locumco.awesomate.io/webhook/napsa-pharmacies`, served by
the n8n workflow **NAPSA Map - Get Pharmacies** on the LocumCo n8n instance.
This folder holds its definition so the map and its feed are versioned together.

| File | What it is |
|---|---|
| `NAPSA-Map-Get-Pharmacies.json` | The workflow as deployed on 2026-09-24 (`PUT /api/v1/workflows/j1EU9yr91m7iD7Jl`) |
| `NAPSA-Map-Get-Pharmacies.before-2026-09-24.json` | The previous version, kept for rollback |
| `node_attach_cache.js`, `node_geocode_missing.js` | Source of the two Code nodes, readable on their own |
| `build_workflow.py` | Assembles the workflow JSON from the previous version plus the two `.js` files |

## How it works

```
Webhook → Get Pharmacies (Google Sheet, every row)
        → Get Cached Coords (Data Table `napsa_pharmacies`, runs once)
        → Attach Cached Coords     use a cached coordinate only if it lies in the state the address names
        → Geocode Missing          geocode what is left — at most 6 rows per request, 1 request/second
              ├→ Format for Map → Respond to Webhook
              └→ Only New Coordinates → Cache Coordinates (upsert, keyed on the normalised name)
```

Geocoding uses Nominatim with `countrycodes=au`, tries the full address, then
the street-number onwards, then suburb + state + postcode, scores the top three
results by how many of their words the address actually contains, and accepts a
result **only if it falls inside the address's state**. A row that cannot be
placed is returned with `lat`/`lng` = `null`; the map lists it under "not on map".

With a warm cache a request takes 1–2 s. A request that has to geocode new rows
takes up to ~20 s more, then those rows are cached.

## Why it was rebuilt

The previous version fired every row at Nominatim on every request with no
spacing. Nominatim answered every call with HTTP 429, so all coordinates came
from a retry loop that mapped results back to rows by list index — and when a
row got no result, the indexes shifted and a pharmacy received the *next* row's
coordinates. The cache then kept the mistake, keyed on the raw name (trailing
spaces made real entries unfindable). At 68 rows this took ~80 s per request and
47 of 68 cached coordinates were wrong, 9 points shared by two pharmacies.

## Operating it

- **A wrong pin.** Fix the address in the sheet, then delete that pharmacy's row
  from the `napsa_pharmacies` Data Table in n8n (Data Tables → napsa_pharmacies).
  It is re-geocoded on the next request. A cached coordinate is otherwise trusted
  as long as it sits in the right state, so an address fix alone does not move a
  pin that is merely imprecise.
- **A pin in the wrong state** cannot happen from geocoding any more — such a
  result is rejected — but one can still be *typed* in if the sheet ever gains
  `Latitude`/`Longitude` columns; those are given precedence when present and
  pass the same state check.
- **Rollback.** `PUT` the `before-` file to the same workflow id. The Data Table
  contents from before the rebuild are held by LocumCo (dated backup taken at
  deploy time); the table is fully reconstructible from the sheet either way.
- **Changing the Code nodes.** Edit the `.js`, run
  `python build_workflow.py NAPSA-Map-Get-Pharmacies.before-2026-09-24.json out.json`,
  and `PUT` the result. The build strips read-only fields the API rejects.

Two limitations sit in the data, not the workflow: rows whose address does not
name a state cannot be validated, and rows entered twice under different
spellings (e.g. "Mission Beach" / "Mission Beach" with a typo) will show as two
pins on one spot.
