# CLAUDE.md

## Overview

**My Waste** — a two-sided platform for the *My Waste* project (company **Cantinho C**
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
npm start   # nodemon src/server.js
```

- `http://localhost:8001` (`PORT` env overrides). Requires **Node 22.5+**.
- `SESSION_SECRET` env var in production (dev fallback constant otherwise).
- No tests / build / lint. `src/database/database.db` and `public/uploads/` are
  git-ignored and recreated on run.
- **Seed accounts** (all password `mywaste123`): `admin@mywaste.cv` (admin);
  `reciclador1@mywaste.cv`…`reciclador4@mywaste.cv` (verified recyclers);
  `ana@exemplo.cv`, `joao@exemplo.cv` (citizens).

## Backend modules (`src/`)

| file | role |
|---|---|
| `server.js` | all routes + inline `db.prepare()` queries (synchronous) |
| `database/db.js` | opens SQLite, creates schema, seeds when empty |
| `password.js` | `hashPassword` / `verifyPassword` (scrypt, timing-safe) |
| `auth.js` | `loadUser`, `attachUser`, `requireAuth`, `requireRole(...)`, login throttle |
| `csrf.js` | `csrfToken` (per-session token → `res.locals`), `verifyCsrf` (checks `_csrf`) |
| `uploads.js` | `listingPhoto` multer middleware (image-only, ≤3 MB), `publicPath` |
| `data/praia-zones.js` | Praia zones — dropdowns + validation |
| `data/materials.js` | material list + `co2ePerKg` factors (indicative) |

Middleware order in `server.js`: static → urlencoded → cookie-session →
`attachUser` → `csrfToken` → template locals. Multipart routes run
`listingPhoto` **before** `verifyCsrf` (so `req.body._csrf` is populated).

## Schema (`recyclers` table removed; DB is disposable)

- `users` (id, role `cidadao|reciclador|admin`, name, email UNIQUE, phone, zone, password_hash)
- `recycler_profiles` (user_id PK, org_name, description, accepted_items csv, service_zones csv, does_pickup, does_dropoff, hours, image, address, verified_at)
- `listings` (id, citizen_id, items csv, quantity_kg_est, zone, **address** (private), photo_path, note, status `aberta|reservada|recolhida|expirada`, available_until)
- `claims` (id, listing_id, recycler_id, message, status `pendente|aceite|recusada|retirada`, UNIQUE(listing_id,recycler_id))
- `collection_records` (id, listing_id, recycler_id, citizen_id, weights_json, collected_at)
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
`/anuncios/:id/concluir` (+POST → collection_records).
Admin (`requireRole('admin')`): `/admin`, `POST /admin/recicladores/:userId/verificar|recusar`.

**Privacy rule**: `listings.address` + citizen phone are nulled in the
`/anuncios/:id` handler unless the viewer is the owner or the accepted recycler.

## Conventions

- JS: 4-space indent, double quotes, no semicolons.
- All SQL uses bound `?` params. Every state-changing POST form includes
  `{% include "partials/csrf.html" %}` and the route uses `verifyCsrf`.
- Every mutation re-checks ownership (`listing.citizen_id`, `claim.recycler_id`).
- Geo values validated against `data/praia-zones.js`; materials against `data/materials.js`.
- Views extend `layout.html`; interior pages `{% include "partials/nav.html" %}`.

## Notes / caveats

- Fixed in earlier refactor: SQL injection, missing CREATE TABLE, filename casing,
  viewport typo, hanging DB errors, unbuildable `sqlite3@4` (→ `node:sqlite`).
- `node:sqlite` prints an `ExperimentalWarning` on start — expected.
- Login throttle is in-memory (per process). CO₂e factors in `materials.js` are
  placeholders. No email/SMS — match notifications & ratings are **Phase B**.
- Seed weights/collections make `/impacto` non-zero out of the box.
