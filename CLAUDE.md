# CLAUDE.md

## Overview

**Nôs Lixu** — a two-sided platform for the *Nôs Lixu* project (company **Cantinho C**
with the **Global Shapers Praia Hub**), supporting a recycling movement in **Praia,
Cabo Verde**:

- **Citizens** register, publish **listings** of value-added waste (materials + quantity
  + zone + photo), and pick which recycler collects.
- **Recyclers** register, keep a profile (accepted materials, service zones, pickup/
  drop-off), browse a filtered board of listings, and **claim** them.
- After a match: contact details are revealed only to the accepted recycler; either
  party **confirms the collection** with per-material weights.
- **Workshops** module (citizen sign-up) and an **Impacto** dashboard computed from
  confirmed collections + workshops.

Interaction model = listing board + directed claim + confirm (à la Cataki/BR,
Wecyclers/NG). UI and code comments are in Portuguese.

Stack: Express 4 + Nunjucks + **`node:sqlite`** (built-in, no native build).
Auth = email + password (`crypto.scrypt`), session in a signed cookie
(`cookie-session`). Photo upload via `multer`. No native modules anywhere.

## Run / dev

```bash
npm install
npm run dev   # nodemon; `npm start` runs plain `node src/server.js` (used in prod)
npm test      # node:test, no dependencies; tests run against an in-memory SQLite
```

- `http://localhost:8001` (`PORT` env overrides). Requires **Node 22.5+**.
- `SESSION_SECRET` env var in production (dev fallback constant otherwise).
- `src/config.js` resolves `DATA_DIR` (default `./var`, git-ignored) → holds
  `database.db` and `uploads/listings/`, both recreated on run. Set `DATA_DIR`
  to a persistent volume in production.
- `server.set("trust proxy", 1)` — needed for `secure` cookies behind Render's proxy.
- `/uploads/*` is served from `<DATA_DIR>/uploads` (mounted before `public/`).
- Deploy: `render.yaml` blueprint (free plan; see README for the persistent-disk upgrade).
- No build / lint. Tests: `node --test`, in `test/`, no test dependencies.
- **Seed accounts** (all password `noslixu123`): `admin@noslixu.cv` (admin);
  `reciclador1@noslixu.cv`…`reciclador4@noslixu.cv` (verified recyclers);
  `ana@exemplo.cv`, `joao@exemplo.cv` (citizens).

## Backend modules (`src/`)

| file | role |
|---|---|
| `server.js` | routes only: parse the request, call a domain module, render |
| `domain/listings.js` | the anúncio lifecycle: `claim`/`accept`/`withdraw`/`expire`/`conclude`/`sweepExpired` |
| `domain/visibility.js` | who may see what on an anúncio (the privacy rule) — `forListing(db, id, viewer)` |
| `domain/match.js` | recycler profile ↔ anúncio matching; owns the CSV storage format |
| `domain/profile.js` | validates the `/perfil` form — coordinate pairing, trims text fields |
| `domain/impacto.js` | the public impact metrics — `metrics(db)` |
| `domain/ratings.js` | mutual avaliações after a recolha — who may rate whom, and the averages |
| `domain/admin.js` | recycler verification + workshop signups for the team |
| `domain/workshops.js` | admin CRUD for workshops, with validation |
| `domain/dashboard.js` | operational overview for `/admin` (no kg/CO₂e — that is `impacto`) |
| `config.js` | resolves `DATA_DIR` → `DB_PATH`, `UPLOADS_DIR`, `LISTINGS_UPLOAD_DIR` |
| `database/db.js` | opens SQLite at `DB_PATH`, applies the schema, seeds when empty |
| `database/schema.js` | `createSchema(db)` — the CREATE TABLEs, apart from opening the file |
| `password.js` | `hashPassword` / `verifyPassword` (scrypt, timing-safe) |
| `auth.js` | `loadUser`, `attachUser`, `requireAuth`, `requireRole(...)`, login throttle |
| `csrf.js` | `csrfToken` (per-session token → `res.locals`), `verifyCsrf` (checks `_csrf`) |
| `uploads.js` | `listingPhoto` multer middleware (image-only, ≤3 MB), `publicPath` |
| `data/praia-zones.js` | Praia zones — dropdowns + validation |
| `data/materials.js` | material list + `co2ePerKg` factors (indicative) |

Middleware order in `server.js`: `trust proxy` → `/uploads` static → `public`
static → urlencoded → cookie-session → `attachUser` → `csrfToken` → template
locals. Multipart routes run `listingPhoto` **before** `verifyCsrf` (so
`req.body._csrf` is populated).

## Schema (`recyclers` table removed; DB is disposable)

- `users` (id, role `cidadao|reciclador|admin`, name, email UNIQUE, phone, zone, password_hash)
- `recycler_profiles` (user_id PK, org_name, **contact_name** (pessoa responsável), description, accepted_items csv, service_zones csv, does_pickup, does_dropoff, hours, image, address, **latitude, longitude** (both nullable — a pair or neither, never one alone), verified_at)
- `listings` (id, citizen_id, items csv, quantity_kg_est, zone, **address** (private), photo_path, note, status `aberta|reservada|recolhida|expirada`, available_until)
- `listings.status` now includes `removida` (admin-removed); `listings.moderation_reason`
  holds why. **Requires a fresh database** — the `CHECK` constraint only
  widens on `CREATE TABLE`, and there is no migration framework (DB is
  disposable, per the run/dev section).
- `claims` (id, listing_id, recycler_id, message, status `pendente|aceite|recusada|retirada`, UNIQUE(listing_id,recycler_id))
- `collection_records` (id, listing_id, recycler_id, citizen_id, weights_json, collected_at)
- `ratings` (id, listing_id, rater_id, rated_id, stars 1-5, comment, UNIQUE(listing_id,rater_id))
- `workshops`, `workshop_signups` (now with nullable `user_id`)

## Routes

Public: `/`, `/projeto`, `/recicladores` (verified profiles, zone filter),
`/workshops`, `/workshops/:id` (+ `POST .../inscrever`), `/impacto`.
Auth: `/registar`, `/entrar`, `POST /sair`.
Citizen (`requireRole('cidadao')`): `/painel`, `/anuncios/novo` (+POST),
`POST /anuncios/:id/expirar`, `POST /anuncios/:id/claims/:claimId/aceitar`.
Recycler (`requireRole('reciclador')`): `/painel`, `/perfil` (+POST),
`/anuncios` (board, `?todos=1`), `POST /anuncios/:id/reivindicar`,
`POST /claims/:id/retirar`.
Shared: `/anuncios/:id` (detail; privacy-gated contact),
`/anuncios/:id/concluir` (+POST → collection_records),
`POST /anuncios/:id/avaliar` (mutual rating, only after a confirmed recolha).
Admin-only, but routed under `/anuncios` since they act on one:
`POST /anuncios/:id/moderar` (aberta → removida, with a required reason),
`POST /anuncios/:id/restaurar` (removida → aberta).
Admin (`requireRole('admin')`): `/admin` (overview + pending/verified recyclers
+ workshop signups — the only place signups are visible),
`POST /admin/recicladores/:userId/verificar|recusar` (both reachable from the UI),
`/admin/workshops/novo` (+`POST /admin/workshops`),
`/admin/workshops/:id/editar` (+`POST /admin/workshops/:id`),
`POST /admin/workshops/:id/eliminar`.

**Rating rule**: only the two parties of a **concluded** recolha may rate, each
rates the other, once per anúncio. `domain/ratings.js` derives rater and rated —
never trust a form field for either.

**Privacy rule**: `listings.address` + citizen phone are revealed only to the
owner and the accepted recycler. This lives entirely in `domain/visibility.js`
(`forListing`), which also decides the WhatsApp links and `canConclude`. Handlers
must never re-derive it — ask the module.

## Conventions

- JS: 4-space indent, double quotes, no semicolons.
- All SQL uses bound `?` params. Every state-changing POST form includes
  `{% include "partials/csrf.html" %}` and the route uses `verifyCsrf`.
- Every mutation re-checks ownership — inside the domain module, not the handler.
- Domain modules take `db` as their first argument (they never require it). That
  is the seam: production passes the SQLite file, tests pass `:memory:` built
  with `createSchema`. Keep it that way.
- Domain operations return `{ ok: true, ... }` or `{ ok: false, status, message }`;
  handlers translate that with `renderFail(res, result)`.
- Geo values validated against `data/praia-zones.js`; materials against `data/materials.js`.
- Views extend `layout.html`; interior pages `{% include "partials/nav.html" %}`.
- **Every form uses `class="auth-form"`**, styled once in `public/styles/forms.css`
  — labels, inputs, `fieldset`/`legend`, the `.checklist` grid for checkbox lists,
  focus rings, `.form-errors`. Never write form-specific CSS in another
  stylesheet (`content-page.css`, `painel.css`) or on a per-page basis — extend
  `forms.css` instead. A page with a form **must** link `forms.css`, even if it
  also loads `painel.css`; forgetting this was a real, long-standing bug (see
  Notes below) — nothing catches it automatically.
- **Every submit button and action link uses `class="btn"` (primary) or
  `class="btn btn-ghost"` (secondary)** — defined once in `main.css`, since it
  is used both inside and outside forms and must be available on every page,
  including the two (`entrar`, `registar`) that don't load `painel.css`. Never
  leave a `<button type="submit">` unclassed.
- Required fields get `<span class="req" aria-hidden="true">*</span>` after the
  label text, alongside the native `required` attribute — the attribute is
  what assistive tech and browser validation actually use; the span is purely
  visual, hence `aria-hidden`.

## Notes / caveats

- Fixed in earlier refactor: SQL injection, missing CREATE TABLE, filename casing,
  viewport typo, hanging DB errors, unbuildable `sqlite3@4` (→ `node:sqlite`).
- `node:sqlite` prints an `ExperimentalWarning` on start — expected.
- Login throttle is in-memory (per process). CO₂e factors in `materials.js` are
  placeholders. No email/SMS — WhatsApp links and avaliações are done; what is
  left of **Phase B** is automatic notification.
- `domain/dashboard.js` answers "what needs attention": claims a citizen has not
  answered (waiting measured from the **claim**, not the anúncio), open listings
  with no claims after `STALE_AFTER_DAYS`, and recent collections. It
  deliberately carries no kg/CO₂e so it does not drift from `/impacto`.
- Workshop dates are stored as `"YYYY-MM-DD HH:MM"` because `/workshops`
  string-compares them against `now()` to split upcoming from past. A
  `datetime-local` input sends `"…T…"`, so `domain/workshops.js` normalises it —
  do not bypass that or the public listing mis-sorts.
- Deleting a workshop cascades to its `workshop_signups`; `remove()` returns
  `deletedSignups` so the confirmation can say how many are lost.
- Moderation only applies to an **aberta** anúncio — a `reservada` one has a
  claim already in play and is out of scope for this action. The form lives
  on `/anuncios/:id` itself (admins can already view any anúncio there), not
  a separate admin page; `admin.moderatedListings(db)` is the read side, for
  the "Anúncios removidos" table on `/admin`.
- A recycler's sede location is manual `latitude`/`longitude` inputs, not a
  geocoding service — the project has no external-API dependencies and this
  keeps it that way. `public/scripts/geolocate.js` offers a "use my current
  location" button via the browser's own Geolocation API; nothing is sent to
  a third party. `domain/profile.js` requires both coordinates or neither —
  never validate one without the other.
- Destructive admin forms carry `data-confirm="…"`; `public/scripts/confirm.js`
  turns that into a confirmation prompt (no inline handlers).
- `impacto.citizens` needs `CAST(citizen_id AS TEXT)`: in a SQLite `UNION` the
  integer `6` and the text `"6"` are different values, so anyone who both
  donated and signed up for a workshop would be counted twice.
- Nunjucks does **not** repeat strings (`"★" * n` is Jinja and yields `NaN`).
  Stars are drawn with the `estrelas` filter registered in `server.js`.
- `forms.css` was `auth.css` until it was found that four pages
  (`anuncio-novo`, `coleta-confirmar`, `perfil-reciclador`, the claim form on
  `anuncio`) used `class="auth-form"` but never linked the stylesheet that
  styles it — the name "auth" read as login/register-only, so nobody noticed
  those pages needed it too. They rendered with bare, unstyled browser
  controls in production. Same root cause left most primary submit buttons
  app-wide unclassed (`.btn` lived only in `painel.css`, which two of the
  affected pages don't even load). Fixed by renaming the file to what it
  actually does, moving `.btn`/`.btn-ghost`/`.btn-wa` to `main.css` (loaded by
  every page), and auditing every `<form>` and `<button type="submit">` in the
  app. If a form ever looks unstyled again, check its `{% block styles %}`
  for `forms.css` before anything else.
- **Mobile**: the homepage (`index.html`) has its own bespoke header/nav —
  it does not use `partials/nav.html` — and `responsive.css`'s
  `@media (max-width: 900px)` block used to absolutely-position every link
  inside it to the same spot, so on any phone all five nav links stacked
  invisibly on top of each other and only the last (the "Entrar"/"Painel"
  pill) was clickable. Fixed by deleting that rule — `#page-home header`
  already has `flex-wrap: wrap`, so it wraps correctly on its own. Don't
  reintroduce `position: absolute` there; if the home header ever needs
  different mobile behaviour, add it to `@media (max-width: 600px)` instead.
- **Mobile**: any `<table class="data-table">` must be wrapped in
  `<div class="table-wrap">` (defined in `painel.css`, next to `.data-table`)
  — without it, a table wider than the viewport pushes the whole page wider
  and the columns run off both silently and unrecoverably (no way to scroll
  back and see them). `.table-wrap` gives the table its own horizontal
  scrollbar and a `min-width` so columns don't get squeezed illegibly first.
- The seed creates 4 concluded collections (49 kg, 5 flows across 3 recyclers)
  so `/impacto` is non-zero out of the box, plus 3 open listings chosen so that
  `reciclador1` and `reciclador2` each match one under the default board filter.
- Two housekeeping sweeps, both cheap and synchronous, no scheduler:
  `sweepExpired()` (server.js) marks past-`available_until` open listings
  `expirada` — runs at startup and at the top of `/painel`, `/anuncios`,
  `/anuncios/:id`; `sweepOrphans()` (uploads.js) deletes upload files no listing
  references — runs at startup only.
- Multer writes the file before `verifyCsrf` runs. Rather than remembering
  `removeUpload` on every failure path, `POST /anuncios/novo` runs its work
  inside `withStagedPhoto(diskStore, req.file, ...)`, which discards the file
  unless the callback returns `{ ok: true }`. `sweepOrphans()` is now a backstop,
  not the mechanism.
- Listing photos are downscaled **client-side** (`public/scripts/photo-resize.js`,
  max 1600px / JPEG q0.82) — deliberately not server-side, since every image
  library is a native module and the project has none.
