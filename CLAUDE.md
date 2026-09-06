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
| `domain/impacto.js` | the public impact metrics — `metrics(db)` |
| `domain/ratings.js` | mutual avaliações after a recolha — who may rate whom, and the averages |
| `domain/admin.js` | recycler verification + workshop signups for the team |
| `domain/workshops.js` | admin CRUD for workshops, with validation |
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
- `recycler_profiles` (user_id PK, org_name, description, accepted_items csv, service_zones csv, does_pickup, does_dropoff, hours, image, address, verified_at)
- `listings` (id, citizen_id, items csv, quantity_kg_est, zone, **address** (private), photo_path, note, status `aberta|reservada|recolhida|expirada`, available_until)
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
Admin (`requireRole('admin')`): `/admin` (pending + verified recyclers, and
workshop signups — the only place they are visible),
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

## Notes / caveats

- Fixed in earlier refactor: SQL injection, missing CREATE TABLE, filename casing,
  viewport typo, hanging DB errors, unbuildable `sqlite3@4` (→ `node:sqlite`).
- `node:sqlite` prints an `ExperimentalWarning` on start — expected.
- Login throttle is in-memory (per process). CO₂e factors in `materials.js` are
  placeholders. No email/SMS — WhatsApp links and avaliações are done; what is
  left of **Phase B** is automatic notification.
- Workshop dates are stored as `"YYYY-MM-DD HH:MM"` because `/workshops`
  string-compares them against `now()` to split upcoming from past. A
  `datetime-local` input sends `"…T…"`, so `domain/workshops.js` normalises it —
  do not bypass that or the public listing mis-sorts.
- Deleting a workshop cascades to its `workshop_signups`; `remove()` returns
  `deletedSignups` so the confirmation can say how many are lost.
- Destructive admin forms carry `data-confirm="…"`; `public/scripts/confirm.js`
  turns that into a confirmation prompt (no inline handlers).
- `impacto.citizens` needs `CAST(citizen_id AS TEXT)`: in a SQLite `UNION` the
  integer `6` and the text `"6"` are different values, so anyone who both
  donated and signed up for a workshop would be counted twice.
- Nunjucks does **not** repeat strings (`"★" * n` is Jinja and yields `NaN`).
  Stars are drawn with the `estrelas` filter registered in `server.js`.
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
