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

## Look

Dark only, and deliberately so: pastel mint, pink and amber on true black, with
oversized numerals, generous radii, separated pill rows and a floating tab bar.
A light theme cannot carry that palette, so there isn't one — the app ignores the
system light/dark setting rather than shipping a washed-out second skin.

Type is `ui-rounded`, which resolves to SF Pro Rounded on Apple hardware. It is
the geometric, friendly cut the layout is drawn for and costs no download, which
matters for an app that has to work offline.

The three figures — Today's stat tiles, Plan's column chart, Shop's donut — are
hand-built SVG and CSS in `js/charts.js`. No chart library.

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

### Why the worker tags every request with a build

GitHub Pages serves assets with `Cache-Control: max-age=600` and does not let you
configure that. A service worker cannot get around it either: inside a worker,
`fetch(url, { cache: 'reload' })` is silently ignored in Chromium, so for ten
minutes after a deploy "go to the network" hands back the previous file and an
installed app keeps booting the old version — which looks exactly like a failed
deploy.

The way through is to request a URL the HTTP cache has never seen. `sw.js` appends
`?b=<build>` to every request and stores the response under the original URL, so
the page never sees the tag. The staging step stamps `BUILD` with the commit SHA,
which is what makes each deploy's first request a guaranteed cache miss. **If you
ever change how the site is staged, keep that stamp** — `tests/deploy.mjs` fails
without it.

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
css/app.css             design system: tokens and components (dark only)
manifest.webmanifest    install metadata and home-screen shortcuts
sw.js                   offline cache (network-first for navigations)
js/
  app.js                routing, tab bar, settings, service-worker registration
  store.js              state, persistence, and every mutation
  ui.js                 bottom sheet, toaster, form fragments
  util.js               dates, formatting, small DOM helpers
  icons.js              inline SVG icon set
  charts.js             donut, column chart, stat bars — hand-built SVG
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

Three scripts, cheapest first.

`syntax.mjs` parses every JS file as an ES module. It needs no browser and no
dependencies. **Do not replace it with `node --check foo.js`** — for a `.js` file
Node parses as CommonJS, whose body is function-wrapped, so things that are
illegal in a module (a stray top-level `return`, say) pass silently. It copies
each file to `.mjs` first to force module parsing, which is how the browser reads
them.

`logic.mjs` drives the real store module in the browser and asserts on the data
model — merging, drawing down stock, undo, the buy → put away → re-point flow,
the horizon, home/work separation, persistence across a reload.

`deploy.mjs` is the one that matters when the live site looks wrong. It serves a
staged copy with GitHub Pages' own `Cache-Control: max-age=600`, lets the service
worker install and take control, then edits the copy and re-stamps the build the
way the workflow does — and requires the change to reach the running app. It also
checks the app still boots with the network off. It starts its own server, so it
needs no `python3 -m http.server`.

`smoke.mjs` walks the UI at iPhone dimensions and screenshots every view. It
fails fast if the app does not boot, then checks each view for layout width and a
tappable tab bar. Note what it does *not* do: compare `scrollWidth` to
`innerWidth`. Under mobile emulation Chromium widens the layout viewport to
swallow overflowing content and scales the page down, so both numbers grow
together — the check passes while the real page is zoomed out and the fixed tab
bar has been pushed off screen. Comparing `innerWidth` to the device width
catches it.

```sh
node tests/syntax.mjs

npm i -D playwright
node tests/deploy.mjs

python3 -m http.server 8765 &
node tests/logic.mjs
SHOT_DIR=./shots node tests/smoke.mjs
```

`CHROMIUM` overrides the browser binary and `BASE` the URL under test.
