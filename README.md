# Munch

A meal, inventory and shopping planner built as an installable PWA for iPhone.

Three things feed into each other:

- **Stock** — what you actually have in, with use-by dates and a location split
  between home and work, so a work lunch is never planned around something sat
  in the fridge at home.
- **Plan** — breakfast, lunch and dinner for each day of the week. Each meal is
  tagged home or work, and every ingredient either draws on something in stock
  or is flagged to buy.
- **Shop** — the list. Everything flagged to buy across the planned week, merged
  by name and grouped by aisle, alongside anything you add by hand.

Buy something and put it away and the plan updates: those ingredients switch from
"to buy" to "from stock". Log a meal as eaten and the amounts it used come off
the inventory.

No accounts, no server, no network calls. Everything lives in the browser's local
storage on the device.

## Live site

The app is deployed to GitHub Pages from `main` by
[`.github/workflows/pages.yml`](.github/workflows/pages.yml). To turn it on:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. Push to `main` (or run the workflow manually from the Actions tab).

The published URL is `https://<owner>.github.io/<repo>/`. Everything is
path-relative — the service worker scope, the manifest `start_url` and every
asset — so it works from a subdirectory without configuration.

The workflow stages only the app itself (`index.html`, `css/`, `js/`, `icons/`,
`sw.js`, `manifest.webmanifest`). The tests, the icon generator and this README
stay in the repo rather than being served from the live site.

## Installing on an iPhone

1. Open the site in **Safari** — the Add to Home Screen flow only exists there.
2. Share → **Add to Home Screen** → Add.

It then launches full screen with no browser chrome, works offline via the
service worker, and gets long-press shortcuts straight to the list, the plan and
your stock.

## Running it locally

There is no build step — plain ES modules and one stylesheet. It does need to be
served over HTTP rather than opened from the filesystem, because ES modules and
service workers are both blocked on `file:` URLs.

```sh
python3 -m http.server 8765
# then open http://127.0.0.1:8765/
```

## Layout

```
index.html              app shell — top bar, viewport, tab bar, sheet host
css/app.css             design system: tokens, components, light and dark
manifest.webmanifest    install metadata and home-screen shortcuts
sw.js                   offline cache (network-first for navigations)
js/
  app.js                routing, tab bar, settings, service-worker registration
  store.js              state, persistence, and every mutation
  ui.js                 bottom sheet, toaster, form fragments
  util.js               dates, formatting, small DOM helpers
  icons.js              inline SVG icon set
  views/                today, plan, inventory, shop
  editors/              the sheets: meal, inventory item, shopping line
icons/                  generated PNG and SVG app icons
tools/make-icons.py     regenerates icons/ from the vector definition
tests/                  Playwright checks (see below)
```

`store.js` is the only thing that touches persisted state. Views render from it
and call `ctx.refresh()`; they never hold their own copy of the data.

## Icons

`icons/` is generated, not hand-drawn. There is no image library in the toolchain,
so `tools/make-icons.py` rasterises the mark from signed distance fields and
writes the PNGs directly. Change the geometry constants at the top of that file
and re-run:

```sh
python3 tools/make-icons.py
```

## Tests

Two Playwright scripts. `logic.mjs` drives the real store module in the browser
and asserts on the data model — merging, drawing down stock, undo, the buy →
put away → re-point flow, the horizon, home/work separation. `smoke.mjs` walks
the UI at iPhone dimensions, screenshots every view in both colour schemes, and
fails on any console error or horizontal overflow.

```sh
npm i -D playwright
python3 -m http.server 8765 &
node tests/logic.mjs
SHOT_DIR=./shots node tests/smoke.mjs
```

`CHROMIUM` overrides the browser binary and `BASE` the URL under test.
