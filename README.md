# Coffee Tools API

Backend-first coffee brewing tracker for home brewers.

It supports two modes:

- guest/dev mode via `DEV_USER_ID`
- authenticated mode via Supabase token verification

Core workflow:

- create coffee bags
- log brews against a bag
- review brew history
- mark a best brew recipe
- view bag analytics
- archive/unarchive bags

A lightweight browser UI is also included at `/app` for end-to-end manual testing.

## Tech Stack

- Node.js + TypeScript
- Express
- Drizzle ORM
- PostgreSQL (Docker)
- Supabase Auth (email magic link + Google OAuth in `/app`)
- Vitest (integration flow tests)

## Features

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

## Data Model Notes

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

## Performance Indexes

- `bags_user_status_updated_at_idx` on `(user_id, status, updated_at)`
- `brews_bag_created_at_idx` on `(bag_id, created_at)`

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

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

### 3. Start Postgres

```bash
docker compose up -d
```

### 4. Apply DB schema

```bash
npm run db:push
```

### 5. Run API server

```bash
npm run dev
```

API: <http://localhost:3000>

### 6. Open built-in test UI

Open:

- <http://localhost:3000/app/>

This UI lets you create bags, log brews via sliders, mark best brew, archive/unarchive, edit bags, and view analytics.
It also includes auth controls in the header:

- email magic link
- Google login
- logout

## Auth Setup (Supabase)

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

## Production Build / Run

Build TypeScript:

```bash
npm run build
```

Run compiled server:

```bash
npm run start
```

Useful for hosting platforms (Render/Railway/etc.).

## Testing

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

## Project Structure

- `src/app.ts` - Express app and route logic
- `src/server.ts` - runtime entrypoint (`app.listen`)
- `src/db/schema.ts` - Drizzle schema
- `src/types/api.ts` - response/error DTO types
- `src/full-flow.test.ts` - integration test
- `web/` - static frontend for manual workflow testing
- `drizzle/` - SQL migrations and metadata
