# Sazkara Maintenance

Digital replacement for the paper repair forms and manual Excel entry used to track
cigarette-display-stand repairs for Jti.

Two roles:

- **Technician** — works from a phone in the field: enters a stand UID, sees that stand's
  full history, records replaced/repaired parts, uploads photos, captures both
  signatures, submits.
- **Repair manager** — works from a desktop: imports Jti's order files, watches progress
  live by city, exports the 43-column Jti file and the accounting parts report, generates
  evidence PDFs, runs analytics, approves technician accounts.

Persian (`fa`) is the default locale with full RTL; English (`en`) is available from the
language switcher.

---

## Requirements

- **Node.js 20.9+** (built and tested on 24.19)
- **PostgreSQL 16** — either via Docker (`docker-compose.yml`, below) or a local install
- **Google Chrome or Microsoft Edge** — used headlessly to render the evidence PDFs

---

## Setup

```bash
npm install
```

```bash
cp .env.example .env
```

Then edit `.env` — at minimum set `AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Start PostgreSQL

With Docker:

```bash
npm run db:up
```

That starts Postgres 16 on `localhost:5432` with database/user/password all `sazkara`,
matching the `DATABASE_URL` in `.env.example`.

If you would rather use a PostgreSQL you already have installed, create the role and
database once and leave `DATABASE_URL` pointing at it:

```bash
psql -U postgres -c "CREATE ROLE sazkara LOGIN PASSWORD 'sazkara' CREATEDB;"
```

```bash
psql -U postgres -c "CREATE DATABASE sazkara OWNER sazkara ENCODING 'UTF8' TEMPLATE template0;"
```

### Migrate and seed

```bash
npx prisma migrate deploy
```

```bash
npm run db:seed
```

The seed creates the 30-item part catalogue, six cities (Tehran flagged for the wage
split), starting wage rates, and the first manager account:

| | |
|---|---|
| Phone | `09120000000` |
| Password | `manager1234` |

Both are overridable via `SEED_MANAGER_PHONE` / `SEED_MANAGER_PASSWORD` in `.env`.

### Run

```bash
npm run dev
```

Open <http://localhost:3000> — you will be redirected to `/fa/login`.

Technicians sign up at `/fa/register`; the account is created **pending** and cannot sign
in until the manager approves it under **تکنسین‌ها / Technicians**, which is also when a
technician code is assigned.

---

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Start/stop the Docker Postgres |
| `npm run db:migrate` | Create + apply a migration in development |
| `npm run db:deploy` | Apply existing migrations |
| `npm run db:seed` | Seed catalogue, cities, settings, manager |
| `npm run db:studio` | Prisma Studio |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run smoke` | End-to-end business-rule checks (**wipes transactional data**) |

There is also an end-to-end check of the business rules in `scripts/smoke.ts`. **It wipes
all transactional data**, so only run it against a scratch database:

```bash
npm run smoke
```

(The `--conditions` flag makes the `server-only` guard a no-op outside the Next runtime.)

---

## How the business rules are implemented

Spec section references are in the code comments.

- **§6.1 Repaired vs not.** The outcome is *derived*, never chosen: at least one part
  replaced **or** repaired ⇒ `REPAIRED`. Otherwise `NOT_REPAIRED`, and one of the five
  fixed reasons is mandatory.
- **§6.2 Unknown UIDs.** A technician can file a report for a UID that is not in any
  order; the stand is created with `confirmation = PENDING` and appears under
  **شناسه‌های در انتظار تأیید** until the manager admits it. Manually-added UIDs from the
  manager go through the same gate.
- **Projects and phases.** A project is one Jti campaign, subdivided into phases; an
  order belongs to a phase, and every repair form records the campaign it belongs to.
  One project is *active* and is where stray field-found UIDs and new imports are filed.
  The project is the primary filter on the dashboard, analytics, exports and evidence.
- **§6.3 Re-repair — scoped to the project.** The same stand repaired **twice inside one
  project** is a re-repair, however far apart the two visits fall. The same stand
  repaired in a **later** project is ordinary recurring work and is *not* a re-repair —
  it stays in the main export, marked `hasPreviousProjectHistory` so the manager can pick
  it out (a tinted row in the workbook, since the sheet must stay exactly 43 columns).
  Re-repairs are **excluded from the "stands repaired" count**, get their own Excel and
  evidence pack, but their parts **do** count toward usage totals.
  The 14-day window survives only as `isQuickReRepair`, a severity flag on the re-repair
  page: a stand that failed again that fast is a different problem from one that lasted
  the whole campaign.
- **§6.4 Duplicate orders.** Every incoming UID is cross-checked against all stands ever
  repaired, in any batch or year. Matches are shown in the import review with the date,
  city and form code, and default to *excluded* — but nothing is dropped or admitted
  without the manager ticking a box. Excluded rows are stored as `EXCLUDED`, not deleted.
- **§6.6 Multi-stand stores.** The wage tier is derived from the order stands were
  actually serviced in, per technician / store / Tehran-local day: the first stand earns
  the city rate (Tehran has its own), the second earns `secondStandRate`, the third and
  beyond `thirdPlusStandRate`. Returning to a stand already serviced that day does not
  push it into a lower tier. All rates are editable in Settings; none are hardcoded.
  Each form snapshots the wage it was paid, so editing a rate never rewrites history.
- **Unsuccessful visits are paid.** Every visit that produced no repair earns the flat
  `unrepairedVisitRate` the manager sets, whatever the reason — the technician travelled
  either way. A call-out does **not** consume a wage tier, so a wasted trip can never
  demote a stand repaired later at the same store to the reduced second-stand rate. If a
  temporarily-closed store is revisited and the stand is then repaired, that visit is
  priced normally by the tier rules.
- **Part units.** Everything is counted in pieces except the two SMD strips, which are
  cut to length and recorded in **centimetres in 50 cm steps** (50, 100, 150 …). The unit
  lives on the catalogue item, so the technician's picker, the analytics and export
  column all agree; the server rejects a quantity that is not a whole step rather than
  silently rounding a number that ends up on a parts bill.
- **The UID identifies a STORE, not a stand.** A location has one Jti uid, and the 1, 2 or
  3 stands standing in it all share it — the technician enters a single uid and reports on
  each stand in the same visit. So `Store.uid` is the unique key and a stand is identified
  by `(store, standIndexAtStore)`. Re-repair detection keys on that stand position.
- **§6.7 Per-UID history.** History belongs to the location: every form ever filed at that
  uid, across all of its stands, is one query — independent of which order batch it
  arrived in.
- **§6.8 Parts for accounting.** Only **replaced** parts count as consumed inventory;
  parts repaired in place are excluded from the totals and appear only in the description
  column. Prices don't vary by city, so the accounting figure is a straight sum across all
  cities, broken down per part.

---

## Export assumptions

These were judgement calls where the spec left room. They are stated here because they
affect what Jti receives.

1. **One row per stand, and unsuccessful visits are included.** A location with three
   stands produces three rows carrying the same شناسه, because parts and quality are
   per-stand facts. Visits that produced no repair appear too. Rows are colour-coded, with
   the most consequential winning: **red** = not repaired, **blue** = one of several
   stands at the same uid, **cream** = this uid was also repaired in an earlier project.
   The workbook carries a legend sheet explaining the colours.
2. **Columns 5–34 hold replaced quantities only.** Repaired-in-place parts export as `0`
   there and are described in column 37 instead, so the information is not lost.
3. **The export is split in two.** *Main* carries every stand repaired in the range
   except within-project re-repairs, including stands that were also repaired in earlier
   projects (those are legitimate recurring work, tinted rather than removed).
   *Re-repairs* is a separate workbook, reachable from the re-repair page along with its
   own evidence pack. A combined option is available for a manager who wants one sheet.
4. **Column 2 uses the Jalali calendar** (e.g. `1405/06/13`), per the client's decision.
   Timestamps are stored as UTC and converted only at export/display time. The app UI
   shows Jalali under `fa` and Gregorian under `en`.
5. **Column 37 (`Maintenance detail`)** is free text, formatted as
   `تعویض: <part> (<qty>)، … | تعمیر: <part> (<qty>)، … | توضیحات: <notes>`.
6. **Quantities are in the part's own unit.** Columns 25 and 26 (the SMD strips) carry
   centimetres, not piece counts; every other part column is a piece count.
7. **The sheet is 44 columns, not 43.** Column 44 (`Repair status`) states in words
   whether the visit ended in a repair and, when it did not, which of the five fixed
   reasons applied — colour alone does not survive a copy-paste. Columns 1–43 are
   unchanged, so archives exported before this column existed still import correctly.
7. **Historical imports carry no wage.** The rates in effect before this system existed
   are unknown, and inventing them would corrupt payroll reporting, so those rows record
   `0` and are attributed to a dedicated non-login "legacy" account.

Day boundaries — the daily evidence PDF, "today" on the dashboard, date-range exports —
are **Tehran-local** (`APP_TIMEZONE`), not UTC.

---

## Project layout

```
app/
  [locale]/            Pages. fa/en, RTL/LTR.
    technician/        Mobile-first field flow
    manager/           Desktop-first dashboard
  actions/             Server actions (auth, forms, imports, exports, evidence)
  api/                 Route handlers: file serving and file downloads
components/            UI: part picker, signature pad, charts, import wizard…
i18n/                  next-intl routing, request config, navigation helpers
lib/
  repair-forms.ts      §6.1/6.2/6.3/6.6 — form submission, the heart of the app
  imports.ts           §5/§6.4 — Excel parsing, column mapping, duplicate detection
  wages.ts             §6.6 — wage tiers
  projects.ts          campaigns, phases, and the re-repair scope
  analytics.ts         §7/§10 — dashboard aggregates, part rates, forecasting
  exports/jti.ts       §8 — the 43-column file
  exports/parts-usage.ts §6.8 — accounting report
  pdf/evidence.ts      §9 — daily per-city evidence PDF
  historical.ts        §7 — importing pre-system Jti exports
  storage/             Storage adapter (see below)
  dates.ts             Jalali/Gregorian + Tehran-local day boundaries
prisma/                Schema, migrations, seed
messages/              fa.json, en.json
```

---

## Notes for extending this later

**File storage.** Photos, signatures, uploaded workbooks and generated PDFs go through
the `StorageAdapter` interface in `lib/storage/index.ts`; only an opaque `ref` string is
stored in the database. Moving to S3-compatible object storage means adding one
implementation and one line in `getStorage()` — no call sites change. Uploads live
*outside* `public/` and are served by `/api/files/[...ref]`, which requires a session;
they are commercially sensitive and must not become world-readable by URL.

**Auth.** Sessions are a signed JWT in an httpOnly cookie (`jose`), verified in both
`proxy.ts` and server components. `proxy.ts` is only an optimistic gate — every page and
API route re-checks the session against the database, so a revoked account stops working
immediately rather than when the cookie expires. Adding SMS OTP means adding a step to
`app/actions/auth.ts`; nothing else needs to know.

**Locales.** Add the code to `i18n/routing.ts` and a file in `messages/`. Layout
direction comes from `directionOf()`; the UI uses CSS logical properties throughout, so
no component branches on direction.

**The part catalogue is load-bearing.** The order of `PART_CATALOG` in `lib/parts.ts`
*is* the layout of export columns 5–34, and `exportColumnKey` freezes that relationship.
The manager's catalogue screen is deliberately read-only: reordering or removing a part
would silently change the shape of every future Jti file. Adding one is a code change
plus a migration.

**PDF rendering.** `puppeteer-core` drives an installed Chrome/Edge rather than bundling
Chromium — the reason is Persian, not size: correct RTL output needs real bidirectional
layout and Arabic-script glyph shaping, which the pure-JS PDF builders do not do. Set
`CHROME_PATH` if auto-detection fails.

---

## Known limitations

- Date range pickers are native `<input type="date">`, which always speak Gregorian ISO.
  The manager is choosing a reporting window rather than reading a date, and the output
  is converted to Jalali; a Persian calendar widget would be the next polish step.
- The dashboard refreshes by polling every 20 seconds (paused while the tab is hidden)
  rather than over a socket, which keeps the deployment to a single Next process.
- Editing an already-submitted repair form is not implemented; forms are append-only.
- Part-catalogue editing is view-only, as described above.
