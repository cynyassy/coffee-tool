# Coffee Tools API
## Motivation
# ☕ Coffee Tools API

I built Coffee Tools as a backend-first brewing tracker designed for home coffee enthusiasts who dial in multiple brews from a single bag of beans. The goal was to explore how thoughtful data modelling and API design can support real-world workflows rather than just CRUD-style demos.

The system models the lifecycle of a coffee bag — from creation to experimentation to archival — allowing users to log brews, compare outcomes, mark a “best brew”, and review analytics over time. A lightweight browser UI at /app acts as an internal client for end-to-end testing and iteration.

This project helped me deepen my understanding of backend architecture, request lifecycle design, and how UX decisions influence data structure.

Tech stack

Node.js + TypeScript

Express

Drizzle ORM

PostgreSQL (Docker)

Supabase Auth (magic link + Google OAuth)

Vitest (integration flow testing)
## Quick Start
### Local Setup

#### 1. Install dependencies

```bash
npm install
```

#### 2. Configure environment

Create `.env` in project root:

```env
DATABASE_URL=postgres://coffee:coffee@localhost:5432/coffee_tools
PORT=3000
DEV_USER_ID=00000000-0000-0000-0000-000000000001
AUTH_REQUIRED=false
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Auth behavior:

- `AUTH_REQUIRED=false`: API works without login (falls back to `DEV_USER_ID`).
- `AUTH_REQUIRED=true`: API requires Bearer token verified against Supabase.

#### 3. Start Postgres

```bash
docker compose up -d
```

#### 4. Apply DB schema

```bash
npm run db:push
```

#### 5. Run API server

```bash
npm run dev
```

API: <http://localhost:3000>

#### 6. Open built-in test UI

Open:

- <http://localhost:3000/app/>

## Usage
### Live URL

- App: <https://coffee-tools-api.onrender.com/app/>
- Health: <https://coffee-tools-api.onrender.com/health>

### Features

### Bag lifecycle

- `POST /bags`
- `GET /bags?status=ACTIVE|ARCHIVED`
- `GET /bags/:id`
- `PATCH /bags/:id`
- `PATCH /bags/:id/archive`
- `PATCH /bags/:id/unarchive`

### Brew logging

- `POST /bags/:id/brews`
- `GET /bags/:id/brews`
- `PATCH /bags/:bagId/brews/:brewId/best`

### Analytics

- `GET /bags/:id/analytics`

Analytics includes:

- total brews
- average rating
- average taste profile (`nutty`, `acidity`, `fruity`, `floral`, `sweetness`, `chocolate`)
- brew method counts
- rating trend
- best brew
- roast age and resting status

### Validation

Field validation returns structured errors:

```json
{
  "errors": [
    { "field": "roastDate", "message": "is required" }
  ]
}
```
### Data Model Notes

### Bags

- `roastDate` is required
- `origin` and `process` are optional
- computed fields returned by API:
  - `roastAgeDays`
  - `restingStatus` (`RESTING`, `READY`, `PAST_PEAK`, `UNKNOWN`)

### Brews

- numeric taste profile fields are `0..5`
- rating supports decimals (`0..5`)
- `isBest` marks one best recipe per bag

### Performance Indexes

- `bags_user_status_updated_at_idx` on `(user_id, status, updated_at)`
- `brews_bag_created_at_idx` on `(bag_id, created_at)`
### Built-in UI

The `/app` UI lets you create bags, log brews via sliders, mark best brew, archive/unarchive, edit bags, and view analytics.
It includes auth controls in the header:

- email magic link
- Google login
- logout

### Auth Setup (Supabase)

1. Create Supabase project.
2. In Auth providers:
   - enable Email (OTP/magic link)
   - optionally enable Google OAuth
3. Add app URL and redirect URL:
   - `http://localhost:3000/app/` for local
   - your deployed `/app/` URL for production
4. Put these env vars in `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
5. Set `AUTH_REQUIRED=true` when you want mandatory login.

### Production Build / Run

Build TypeScript:

```bash
npm run build
```

Run compiled server:

```bash
npm run start
```

Useful for hosting platforms (Render/Railway/etc.).

### Deploy on Render Free

This repo includes a Render blueprint config:

- `render.yaml`

It creates:

- one free Node web service
- one free PostgreSQL instance

#### 1. Create from Blueprint

1. Push latest code to GitHub.
2. In Render dashboard: **New +** -> **Blueprint**.
3. Select this repo.
4. Render reads `render.yaml` and proposes:
   - `coffee-tools-api` web service
   - `coffee-tools-db` postgres
5. Click **Apply**.

#### 2. Run DB schema migration once

If Render shell is unavailable on your plan, run migration locally against Render Postgres:

1. In Render DB service, copy **External Database URL**.
2. Append SSL mode (`?sslmode=require`).
3. Run locally:

```bash
DATABASE_URL='postgresql://...render.com/coffee_tools?sslmode=require' npm run db:push
```

Do this again whenever schema/migration files change.

#### 3. Open app

- API health: `https://<your-render-domain>/health`
- UI: `https://<your-render-domain>/app/`

#### 4. Later: enable auth

When ready for login:

1. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Render env vars.
2. Change `AUTH_REQUIRED` from `false` to `true`.
3. Redeploy.

#### 5. Supabase email login values (Render env)

- `SUPABASE_URL`: `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY`: Supabase publishable key (`sb_publishable_...`)
- Never use `service_role` or secret key in frontend/browser flow.

#### Render free tier caveats

- Web service may sleep after inactivity (cold starts).
- Free Postgres is for testing and has expiry limits on free plan.
### Testing

Run integration tests:

```bash
npm test
```

Current suite covers full flow:

- create bag
- add brews
- set best brew
- verify analytics
- archive and unarchive bag

### Project Structure

- `src/app.ts` - Express app and route logic
- `src/server.ts` - runtime entrypoint (`app.listen`)
- `src/db/schema.ts` - Drizzle schema
- `src/types/api.ts` - response/error DTO types
- `src/full-flow.test.ts` - integration test
- `web/` - static frontend for manual workflow testing
- `drizzle/` - SQL migrations and metadata

## Contributing
- Create a feature branch from `main`.
- Keep changes scoped and include tests where possible.
- Run checks before opening PR:
  - `npm run build`
  - `npm test`
- Do not commit secrets (`.env`, database URLs, private keys).
