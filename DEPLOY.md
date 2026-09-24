# Putting the map on napsa.org.au

The map is a single self-contained page. It reads its listings from the
LocumCo webhook every time someone opens it, so once it is embedded you never
have to touch it again to publish a new pharmacy — adding a row at the source
is enough.

## Where it is hosted

GitHub Pages, already switched on for this repo:

**https://twapegg.github.io/napsa-rural-placement-map/**

Pushing to `main` republishes it within a minute or so. Nothing needs to be
uploaded to WordPress.

## The embed

In WordPress, edit the page → add an **HTML** widget (Elementor: search
"HTML"; block editor: "Custom HTML") → paste:

```html
<div style="position:relative;width:100%;height:720px;max-height:85vh;
            border:1px solid #E0E4F2;border-radius:10px;overflow:hidden">
  <iframe
    src="https://twapegg.github.io/napsa-rural-placement-map/"
    title="NAPSA Rural Placement Map"
    loading="lazy"
    style="position:absolute;inset:0;width:100%;height:100%;border:0"></iframe>
</div>
```

Publish, then open the page on a phone as well as a desktop.

Notes:

- **Height has to be explicit.** An iframe has no natural height, and a map
  with no height collapses to nothing. `720px` suits a desktop; the
  `max-height:85vh` stops it overflowing a laptop or phone screen. Raise or
  lower `720px` to taste — below about 480px the map gets cramped.
- The map handles its own responsive behaviour inside the frame: below 560px
  wide it shortens its labels, collapses the legend and switches the detail
  panel to full width.
- Only an Administrator can save an `<iframe>` in WordPress. Editors and
  Authors have it stripped out on save by WordPress's content filtering, which
  looks like the widget silently emptying itself. If that happens, the person
  editing needs an admin to paste it, or the `unfiltered_html` capability.
- `embed-demo.html` in this repo is a mock NAPSA page with the map framed in
  it, for checking the fit before touching the live site.

## The alternative: host it on napsa.org.au instead

Only worth doing if NAPSA would rather not depend on a github.io address.

1. Upload `index.html` and `locumco-logo.png` — keep them together in one
   folder — to the site via cPanel File Manager or SFTP, e.g.
   `/wp-content/uploads/rural-placement-map/`.
   (The WordPress Media Library will not accept `.html`, so this has to be
   done at the file level.)
2. Point the iframe `src` at
   `https://www.napsa.org.au/wp-content/uploads/rural-placement-map/index.html`.

The trade-off is that every future change then has to be re-uploaded by hand,
rather than following from a push.

## Publishing a new pharmacy

Add the row at the source. The map picks it up on the next page load — there
is no cache to clear and no republish step. Verified live: the feed went from
13 to 14 listings and the new pharmacy appeared with the correct remoteness
band and contact details, with no change to the map.

For a row to appear it needs:

| Field | Requirement |
|---|---|
| `lat` / `lng` | Not typed in — the feed geocodes each address itself (see `n8n/README.md`) and only accepts a result inside the address's state. A row it cannot place is still listed, behind the amber "not on map" button, tagged "No coordinates". |
| `address` | Must name the state. The state is what the state filter uses, what the geocoder is checked against, and the key to a good pin: "Shop 3, Some Plaza, 12 High St, Town QLD 4000" works; a centre name with no street or state usually will not. |
| `internPosition` | `Yes` gives a solid pin and a "Taking interns" badge, and keeps the row visible when someone switches on the "Taking interns only" filter. `No` gives a hollow pin marked "Not currently taking interns". **Blank is shown as "not stated"**, not as a No. The map opens with no filters set, so every row shows by default. |
| `phone` | Keep the column formatted as text. A number-typed column drops the leading zero; the map restores it when it sees nine digits, but that is a guess. |
| `mmm` | 1–7. Sets the pin colour and the remoteness label. Missing, and it reads "Remoteness not recorded". |

`accommodation` may be left empty — the panel then says "Not listed — ask the
contact below."

### If a pin looks wrong

The map checks every row's coordinates against the state written in its own
address. A row whose coordinates land in a different state is **not** pinned;
it appears instead behind the amber "N not on map" button in the filter bar,
with its contact details still readable. That is deliberate: a pin in the
wrong state sends an intern to the wrong end of the country.

Two rows currently trip this and are corrected in the map as a stopgap —
TerryWhite Chemmart Bathurst and Sarina Discount Drug Store have each other's
coordinates. The repairs are in `COORD_FIXES` in `index.html`, they only apply
to a row that actually fails the check, and they stop applying by themselves
once the source rows are fixed. **They still need fixing at the source.**

Open the browser console on the map to see a named warning for every row that
was repaired or rejected.
