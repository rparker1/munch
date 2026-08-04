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

## Storage

The device's own copy is always the working copy, so the app opens and edits
instantly with no connection — in a shop with no signal, or on the Tube.

Signed out, that is all there is: everything stays in the browser on that device.
Sign in with an emailed link and the same data also syncs to Supabase, so a phone
and a laptop stay in step. Conflicts resolve last-write-wins per record: two
devices editing different items both keep their edit; two editing the *same* item
inside one sync window means one of the two is dropped.

Signing in never merges the two together. Each account gets its own workspace and
starts empty, and signing out hands back exactly what was on the device before.

## Look

Dark only, and deliberately so: pastel mint, pink and amber on true black, with
oversized numerals, generous radii, separated pill rows and a floating tab bar.
A light theme cannot carry that palette, so there isn't one — the app ignores the
system light/dark setting rather than shipping a washed-out second skin.

Type is Plus Jakarta Sans — geometric and tight, with just enough humanist cut to
avoid reading as generic. One variable file covers the whole 200–800 weight axis in
27 kB, vendored into `fonts/` and precached, so nothing is fetched from a CDN and it
works offline like everything else. `fonts/` has to be in the workflow's staging
list; the step now fails the build if the file is missing rather than shipping a
site that silently falls back.

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
  config.js             Supabase URL and publishable key (blank = device only)
  cloud.js              Supabase auth and REST, no SDK
  sync.js               push/pull, scheduling, status
  views/                today, plan, inventory, shop
  editors/              the sheets: meal, inventory item, shopping line
supabase/schema.sql     the one table, its trigger and its RLS policies
icons/                  generated PNG and SVG app icons
tools/make-icons.py     regenerates icons/ from the vector definition
tests/                  Playwright checks (see below)
```

`store.js` is the only thing that touches persisted state. Views render from it
and call `ctx.refresh()`; they never hold their own copy of the data.

Sync needs to know which records changed, and rather than stamping a clock inside
each of the twenty-odd mutation functions — and eventually forgetting one —
`commit()` diffs the record view of state against the last one it saw and stamps
whatever moved. Adding a mutation needs no sync code at all.

`cloud.js` deliberately does not use `@supabase/supabase-js`. The app has no
dependencies and no build step, and the SDK would have to come from a CDN, which
an offline-capable PWA cannot rely on. Auth is GoTrue and the data API is
PostgREST; both are ordinary REST and only a handful of calls are needed.

## Supabase

`supabase/schema.sql` is already applied to the project in `js/config.js`. One
table, `munch_records`, holding a keyed bag of documents the client pulls
incrementally — which is all last-write-wins-per-record needs, and avoids a table
and a mapping layer for each of stock, meals, list, aisles and settings.

The publishable key in `config.js` is meant to be handed to browsers and is safe to
commit. What keeps the data private is row-level security, verified on this project
by impersonating two users inside a rolled-back transaction:

| check | result |
| --- | --- |
| a user can upsert and read their own rows | yes |
| a user can write a row belonging to someone else | refused |
| another signed-in user can see those rows | no |
| a caller holding only the publishable key can see anything | no |

The `service_role` key has none of those protections and must never be committed.

### Signing in on iOS

**A tapped magic link cannot sign an installed app in.** A Home Screen web app keeps
its own storage, separate from Safari, and iOS will not open an emailed URL into it
— so following the link always signs the browser in, never the bookmark. No redirect
setting changes this. The token has to be exchanged *inside* the app, which is why
there are three routes and none of them is "tap the link":

| route | when to use it |
| --- | --- |
| **transfer code** | Fastest, and needs no email. On a device already signed in, Settings → *Copy transfer code*, then paste it into Settings on the other one. It carries a refresh token, so treat it like a password; redeeming it may sign the first device out, which is usually the point. |
| **six-digit code** | Type the code from the email. Needs `{{ .Token }}` in the Magic Link template (Authentication → Emails), or the email only contains a link. |
| **pasted link** | Copy the link out of the email rather than tapping it, and paste it in. Works with the default email template. |

Today's top strip says plainly whether you are signed in, so it never has to be
guessed at.

**Supabase's built-in email is limited to a couple of messages an hour** and is not
meant for real use. Set up custom SMTP (Authentication → Emails → SMTP Settings —
Resend, Postmark and the like all have free tiers) to lift that. The transfer code
exists partly so that hitting the limit does not block you.

**One manual step remains.** Sign-in links will not return to the app until the
site is on the allow-list: Supabase dashboard → Authentication → URL Configuration
→ Redirect URLs, add

```
https://rparker1.github.io/munch/
http://127.0.0.1:8765/
```

(the second only if you want sign-in to work locally). There is no API for this
setting, so it cannot be scripted.

## Icons

`icons/` is generated, not hand-drawn. There is no image library in the toolchain,
so `tools/make-icons.py` rasterises the mark from signed distance fields and
writes the PNGs directly. Change the geometry constants at the top of that file
and re-run:

```sh
python3 tools/make-icons.py
```

## Tests

The scripts, cheapest first.

`syntax.mjs` parses every JS file as an ES module. It needs no browser and no
dependencies. **Do not replace it with `node --check foo.js`** — for a `.js` file
Node parses as CommonJS, whose body is function-wrapped, so things that are
illegal in a module (a stray top-level `return`, say) pass silently. It copies
each file to `.mjs` first to force module parsing, which is how the browser reads
them.

`sync.mjs` covers the sync bookkeeping without needing a Supabase project at all:
it drives the store and plays the part of the server by hand. It checks a change is
queued exactly once, that last-write-wins picks the right side, that a deletion
propagates as a tombstone instead of reappearing, that signing in and out never
mixes two workspaces, and — the point of local-first — that a signed-in device with
an unreachable server still boots, still takes edits, and queues them.

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

`deployed.mjs` is the one to run *after* a deploy, and it needs nothing installed —
plain `fetch`, no browser. Everything above tests the code; this tests that the
published site is the code. `deploy.mjs` proves the cache-busting mechanism works,
but it serves its own staged copy, so it cannot tell that production is not wired
to use it — which is exactly what happened here. Pages was set to deploy from a
branch rather than from the workflow, so the raw tree went out: `sw.js` shipped
with `BUILD = 'dev'`, the `?b=` tag never changed between deploys, and an installed
app could keep booting the previous version for ten minutes while every workflow
run reported success. The two symptoms are the unchanged stamp and repo furniture
being publicly reachable, and this checks for both.

`recipe-fn.mjs` checks the recipe Edge Function, and most of it is the SSRF guards
rather than the parsing — the function fetches arbitrary URLs on request, so
"refuses to fetch the metadata endpoint" matters more than anything about
ingredients. It also confirms a real recipe page yields ingredient lines and that
no raw HTML is ever returned. Plain `fetch`, nothing to install. `FN` overrides the
endpoint and `RECIPE_URL` the page it tries.

Two gaps worth stating rather than leaving implied. The 2 MB cap has no automated
case: it needs a third-party page reliably over that size, and pinning the suite to
someone else's page weight makes it flaky for reasons unrelated to this code. And
the link-local case asserts refusal only — Cloudflare, in front of `supabase.co`,
rejects any request carrying a `169.254.x.x` address in its query string before the
function sees it, so that check cannot exercise our own guard. That guard still
matters: a *redirect* to a link-local address never appears in a query string.

```sh
node tests/syntax.mjs

npm i -D playwright
node tests/deploy.mjs

python3 -m http.server 8765 &
node tests/logic.mjs
node tests/sync.mjs
SHOT_DIR=./shots node tests/smoke.mjs

# after a deploy
node tests/deployed.mjs

# the recipe Edge Function, once deployed
node tests/recipe-fn.mjs
```

`CHROMIUM` overrides the browser binary and `BASE` the URL under test. `LIVE`
overrides the deployed URL `deployed.mjs` checks.
