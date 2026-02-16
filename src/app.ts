import express, { type Request, type Response } from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";

import { db } from "./db/client";
import { bags, brews } from "./db/schema";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import type {
  AnalyticsResponse,
  BagComputedFields,
  BagDetailResponse,
  BagListItemResponse,
  BrewResponse,
  RestingStatus,
  ValidationErrorResponse,
  ValidationIssue,
} from "./types/api";

// Main Express application used by both runtime server and integration tests.
const app = express();

// Basic middleware: CORS, JSON body parsing, and static frontend hosting.
app.use(cors());
app.use(express.json());

// Quick health endpoint to confirm service is up.
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, message: "coffee-tools-api is running" });
});

// Temporary single-user model until auth is added.
const DEV_USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

type SupabaseUser = { id: string };

function isPublicPath(pathname: string) {
  return pathname === "/health" || pathname.startsWith("/app");
}

async function fetchSupabaseUser(accessToken: string): Promise<SupabaseUser | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: SUPABASE_ANON_KEY,
    },
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as SupabaseUser;
  if (!payload?.id) return null;
  return payload;
}

// Exposes non-secret auth config to browser frontend.
app.get("/app/config.js", (_req, res) => {
  res.type("application/javascript").send(
    `window.APP_CONFIG = ${JSON.stringify({
      authRequired: AUTH_REQUIRED,
      supabaseUrl: SUPABASE_URL ?? null,
      supabaseAnonKey: SUPABASE_ANON_KEY ?? null,
    })};`,
  );
});
app.use("/app", express.static(path.resolve(process.cwd(), "web")));

// Auth middleware:
// - AUTH_REQUIRED=false: allow guest fallback to DEV_USER_ID
// - AUTH_REQUIRED=true: require valid Supabase access token on API routes
app.use(async (req, res, next) => {
  if (isPublicPath(req.path)) return next();

  const authHeader = req.header("authorization");
  const token = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : null;

  if (!token) {
    if (!AUTH_REQUIRED) {
      res.locals.userId = DEV_USER_ID;
      return next();
    }
    return res.status(401).json({ error: "Authentication required" });
  }

  const user = await fetchSupabaseUser(token);
  if (!user) {
    if (!AUTH_REQUIRED) {
      res.locals.userId = DEV_USER_ID;
      return next();
    }
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  res.locals.userId = user.id;
  return next();
});

function getRequestUserId(req: Request): string {
  return (req.res?.locals.userId as string | undefined) ?? DEV_USER_ID;
}

// Ensures a bag exists and belongs to the current dev user.
async function getOwnedBagById(bagId: string, userId: string) {
  const rows = await db
    .select()
    .from(bags)
    .where(and(eq(bags.id, bagId), eq(bags.userId, userId)));
  return rows[0] ?? null;
}

// Parses an optional numeric input from request payloads.
// Returns:
// - null when empty
// - NaN when invalid
// - number when valid
function parseOptionalNumber(value: unknown): number | null | typeof NaN {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

// Integer validator used for fields like dose/taste sliders.
function parseOptionalIntegerInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): { value: number | null; issue: ValidationIssue | null } {
  const parsed = parseOptionalNumber(value);
  if (Number.isNaN(parsed)) return { value: null, issue: { field: fieldName, message: "must be a number" } };
  if (parsed === null) return { value: null, issue: null };
  if (!Number.isInteger(parsed)) {
    return { value: null, issue: { field: fieldName, message: "must be an integer" } };
  }
  if (parsed < min || parsed > max) {
    return { value: null, issue: { field: fieldName, message: `must be between ${min} and ${max}` } };
  }
  return { value: parsed, issue: null };
}

// Decimal validator used for fields like rating.
function parseOptionalNumberInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): { value: number | null; issue: ValidationIssue | null } {
  const parsed = parseOptionalNumber(value);
  if (Number.isNaN(parsed)) return { value: null, issue: { field: fieldName, message: "must be a number" } };
  if (parsed === null) return { value: null, issue: null };
  if (parsed < min || parsed > max) {
    return { value: null, issue: { field: fieldName, message: `must be between ${min} and ${max}` } };
  }
  return { value: parsed, issue: null };
}

// Calculates whole-day age from roast date.
function computeRoastAgeDays(roastDate: Date | null): number | null {
  if (!roastDate) return null;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diffMs = Date.now() - roastDate.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / millisecondsPerDay);
}

// Gives user-facing rest status bands from roast age.
function computeRestingStatus(
  roastAgeDays: number | null,
): RestingStatus {
  if (roastAgeDays === null) return "UNKNOWN";
  if (roastAgeDays <= 3) return "RESTING";
  if (roastAgeDays <= 21) return "READY";
  return "PAST_PEAK";
}

// Shared computed bag metadata returned by multiple endpoints.
function buildBagComputedFields(roastDate: Date | null): BagComputedFields {
  const roastAgeDays = computeRoastAgeDays(roastDate);
  const restingStatus = computeRestingStatus(roastAgeDays);
  return { roastAgeDays, restingStatus };
}

// Standardizes validation error response shape.
function sendValidationError(
  res: Response,
  issues: ValidationIssue[],
  status = 400,
) {
  const payload: ValidationErrorResponse = { errors: issues };
  return res.status(status).json(payload);
}

// Maps DB bag row to API detail DTO.
function toBagDetailResponse(row: typeof bags.$inferSelect): BagDetailResponse {
  return {
    ...row,
    ...buildBagComputedFields(row.roastDate),
  };
}

// Maps DB bag row to API list DTO with brewCount aggregate.
function toBagListItemResponse(
  row: typeof bags.$inferSelect,
  brewCount: number,
  averageRating: number | null,
): BagListItemResponse {
  return {
    ...row,
    brewCount,
    averageRating,
    ...buildBagComputedFields(row.roastDate),
  };
}

// POST /bags
// Creates a new active bag for DEV_USER_ID.
app.post("/bags", async (req, res) => {
  const userId = getRequestUserId(req);
  const { coffeeName, roaster, origin, process, roastDate, notes } = req.body ?? {};

  // Collect all validation issues so frontend can show field-level feedback.
  const issues: ValidationIssue[] = [];
  if (!coffeeName) issues.push({ field: "coffeeName", message: "is required" });
  if (!roaster) issues.push({ field: "roaster", message: "is required" });
  if (!roastDate) issues.push({ field: "roastDate", message: "is required" });
  if (issues.length) return sendValidationError(res, issues);

  // Application-side UUID generation for explicit IDs.
  const id = randomUUID();

  // Keep roastDate parsing strict so age/resting logic remains reliable.
  const parsedRoastDate = new Date(roastDate);
  if (Number.isNaN(parsedRoastDate.getTime())) {
    return sendValidationError(res, [{ field: "roastDate", message: "must be a valid date" }]);
  }

  // Insert and return created row in one query.
  const inserted = await db
    .insert(bags)
    .values({
      id,
      userId,
      coffeeName,
      roaster,
      origin: origin ?? null,
      process: process ?? null,
      roastDate: parsedRoastDate,
      notes: notes ?? null,
      status: "ACTIVE",
    })
    .returning();

  const createdBag = inserted[0];
  if (!createdBag) return res.status(500).json({ error: "Failed to create bag" });
  const payload: BagDetailResponse = toBagDetailResponse(createdBag);
  res.status(201).json(payload);
});

// GET /bags?status=ACTIVE|ARCHIVED
// Returns user's bags with brew counts and computed roast metadata.
app.get("/bags", async (req, res) => {
  const userId = getRequestUserId(req);
  const status = (req.query.status as string | undefined) ?? "ACTIVE";
  if (status !== "ACTIVE" && status !== "ARCHIVED") {
    return sendValidationError(res, [{ field: "status", message: "must be ACTIVE or ARCHIVED" }]);
  }

  const rows = await db
    .select()
    .from(bags)
    .where(and(eq(bags.userId, userId), eq(bags.status, status)))
    .orderBy(bags.updatedAt);

  if (!rows.length) return res.json([]);

  // Aggregate brew counts in one grouped query to avoid N+1 queries.
  const bagIds = rows.map((row) => row.id);
  const brewCounts = await db
    .select({
      bagId: brews.bagId,
      count: sql<number>`count(*)::int`,
      averageRating: sql<number | null>`round(avg(${brews.rating})::numeric, 2)::float`,
    })
    .from(brews)
    .where(inArray(brews.bagId, bagIds))
    .groupBy(brews.bagId);

  const bagStatsByBagId = new Map(
    brewCounts.map((row) => [row.bagId, { brewCount: row.count, averageRating: row.averageRating }]),
  );
  const payload: BagListItemResponse[] = rows.map((row) =>
    toBagListItemResponse(
      row,
      bagStatsByBagId.get(row.id)?.brewCount ?? 0,
      bagStatsByBagId.get(row.id)?.averageRating ?? null,
    ),
  );
  res.json(payload);
});

// POST /bags/:id/brews
// Adds a brew entry linked to an owned bag.
app.post("/bags/:id/brews", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;
  const bag = await getOwnedBagById(bagId, userId);
  if (!bag) return res.status(404).json({ error: "Bag not found" });

  const {
    method,
    brewer,
    grinder,
    dose,
    grindSetting,
    waterAmount,
    rating,
    nutty,
    acidity,
    fruity,
    floral,
    sweetness,
    chocolate,
    flavourNotes,
  } = req.body ?? {};

  // Frontend consumes all field issues in one response.
  const issues: ValidationIssue[] = [];
  if (!method || typeof method !== "string") {
    issues.push({ field: "method", message: "is required" });
  }

  const parsedDose = parseOptionalIntegerInRange(dose, "dose", 0, 1000);
  const parsedGrindSetting = parseOptionalIntegerInRange(grindSetting, "grindSetting", 0, 1000);
  const parsedWaterAmount = parseOptionalIntegerInRange(waterAmount, "waterAmount", 0, 5000);
  const parsedRating = parseOptionalNumberInRange(rating, "rating", 0, 5);
  const parsedNutty = parseOptionalIntegerInRange(nutty, "nutty", 0, 5);
  const parsedAcidity = parseOptionalIntegerInRange(acidity, "acidity", 0, 5);
  const parsedFruity = parseOptionalIntegerInRange(fruity, "fruity", 0, 5);
  const parsedFloral = parseOptionalIntegerInRange(floral, "floral", 0, 5);
  const parsedSweetness = parseOptionalIntegerInRange(sweetness, "sweetness", 0, 5);
  const parsedChocolate = parseOptionalIntegerInRange(chocolate, "chocolate", 0, 5);

  const parsedIssues = [
    parsedDose.issue,
    parsedGrindSetting.issue,
    parsedWaterAmount.issue,
    parsedRating.issue,
    parsedNutty.issue,
    parsedAcidity.issue,
    parsedFruity.issue,
    parsedFloral.issue,
    parsedSweetness.issue,
    parsedChocolate.issue,
  ].filter((issue): issue is ValidationIssue => issue !== null);

  if (parsedIssues.length) issues.push(...parsedIssues);
  if (issues.length) return sendValidationError(res, issues);

  // Insert brew and return created row.
  const inserted = await db
    .insert(brews)
    .values({
      id: randomUUID(),
      bagId,
      method,
      brewer: brewer ?? null,
      grinder: grinder ?? null,
      dose: parsedDose.value,
      grindSetting: parsedGrindSetting.value,
      waterAmount: parsedWaterAmount.value,
      rating: parsedRating.value,
      nutty: parsedNutty.value,
      acidity: parsedAcidity.value,
      fruity: parsedFruity.value,
      floral: parsedFloral.value,
      sweetness: parsedSweetness.value,
      chocolate: parsedChocolate.value,
      isBest: false,
      flavourNotes: flavourNotes ?? null,
    })
    .returning();

  const createdBrew = inserted[0];
  if (!createdBrew) return res.status(500).json({ error: "Failed to create brew" });
  const payload: BrewResponse = createdBrew;
  res.status(201).json(payload);
});

// GET /bags/:id/brews
// Brew history is returned newest first for bag detail UI.
app.get("/bags/:id/brews", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;
  const bag = await getOwnedBagById(bagId, userId);
  if (!bag) return res.status(404).json({ error: "Bag not found" });

  const rows = await db
    .select()
    .from(brews)
    .where(eq(brews.bagId, bagId))
    .orderBy(desc(brews.createdAt));

  const payload: BrewResponse[] = rows;
  res.json(payload);
});

// GET /bags/:id/analytics
// Computes bag-level aggregates used by charts/cards in analytics screen.
app.get("/bags/:id/analytics", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;
  const bag = await getOwnedBagById(bagId, userId);
  if (!bag) return res.status(404).json({ error: "Bag not found" });

  const rows = await db
    .select()
    .from(brews)
    .where(eq(brews.bagId, bagId))
    .orderBy(brews.createdAt);

  const totalBrews = rows.length;

  // Reusable average helper for ratings and taste dimensions.
  const average = (values: number[]) =>
    values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;

  const ratings = rows.map((row) => row.rating).filter((value): value is number => value !== null);
  const averageRating = average(ratings);

  const averageTasteProfile = {
    nutty: average(rows.map((row) => row.nutty).filter((value): value is number => value !== null)),
    acidity: average(rows.map((row) => row.acidity).filter((value): value is number => value !== null)),
    fruity: average(rows.map((row) => row.fruity).filter((value): value is number => value !== null)),
    floral: average(rows.map((row) => row.floral).filter((value): value is number => value !== null)),
    sweetness: average(rows.map((row) => row.sweetness).filter((value): value is number => value !== null)),
    chocolate: average(rows.map((row) => row.chocolate).filter((value): value is number => value !== null)),
  };

  // Count method frequencies for bar chart.
  const brewMethodMap = new Map<string, number>();
  for (const row of rows) {
    brewMethodMap.set(row.method, (brewMethodMap.get(row.method) ?? 0) + 1);
  }

  const brewMethods = Array.from(brewMethodMap.entries()).map(([method, count]) => ({ method, count }));

  // Keep chronological order for trend chart.
  const ratingTrend = rows
    .filter((row) => row.rating !== null)
    .map((row, index) => ({
      brewNumber: index + 1,
      rating: row.rating as number,
      createdAt: row.createdAt,
    }));

  const bestBrew =
    rows.find((row) => row.isBest) ??
    rows
      .filter((row) => row.rating !== null)
      .sort((a, b) => {
        if ((b.rating ?? 0) !== (a.rating ?? 0)) return (b.rating ?? 0) - (a.rating ?? 0);
        return b.createdAt.getTime() - a.createdAt.getTime();
      })[0] ??
    null;

  const payload: AnalyticsResponse = {
    bagId,
    ...buildBagComputedFields(bag.roastDate),
    totalBrews,
    averageRating,
    averageTasteProfile,
    brewMethods,
    ratingTrend,
    bestBrew,
  };

  res.json(payload);
});

// GET /bags/:id
// Returns single owned bag with computed roast metadata.
app.get("/bags/:id", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;

  const rows = await db
    .select()
    .from(bags)
    .where(and(eq(bags.id, bagId), eq(bags.userId, userId)));

  if (!rows[0]) return res.status(404).json({ error: "Bag not found" });
  const payload: BagDetailResponse = toBagDetailResponse(rows[0]);
  res.json(payload);
});

// PATCH /bags/:id/archive
// Marks bag as archived; archived bags are hidden from ACTIVE list.
app.patch("/bags/:id/archive", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;

  const updated = await db
    .update(bags)
    .set({
      status: "ARCHIVED",
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(bags.id, bagId), eq(bags.userId, userId)))
    .returning();

  if (!updated[0]) return res.status(404).json({ error: "Bag not found" });
  res.json(updated[0]);
});

// PATCH /bags/:id/unarchive
// Moves an archived bag back to active inventory.
app.patch("/bags/:id/unarchive", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;

  const updated = await db
    .update(bags)
    .set({
      status: "ACTIVE",
      archivedAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(bags.id, bagId), eq(bags.userId, userId)))
    .returning();

  if (!updated[0]) return res.status(404).json({ error: "Bag not found" });
  res.json(updated[0]);
});

// PATCH /bags/:id
// Allows editing bag metadata for future corrections and archived bag maintenance.
app.patch("/bags/:id", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.id;
  const existing = await getOwnedBagById(bagId, userId);
  if (!existing) return res.status(404).json({ error: "Bag not found" });

  const { coffeeName, roaster, origin, process, roastDate, notes } = req.body ?? {};
  const updates: Partial<typeof bags.$inferInsert> = { updatedAt: new Date() };

  if (coffeeName !== undefined) updates.coffeeName = coffeeName || existing.coffeeName;
  if (roaster !== undefined) updates.roaster = roaster || existing.roaster;
  if (origin !== undefined) updates.origin = origin || null;
  if (process !== undefined) updates.process = process || null;
  if (notes !== undefined) updates.notes = notes || null;
  if (roastDate !== undefined) {
    const parsedRoastDate = new Date(roastDate);
    if (Number.isNaN(parsedRoastDate.getTime())) {
      return sendValidationError(res, [{ field: "roastDate", message: "must be a valid date" }]);
    }
    updates.roastDate = parsedRoastDate;
  }

  const updated = await db
    .update(bags)
    .set(updates)
    .where(and(eq(bags.id, bagId), eq(bags.userId, userId)))
    .returning();

  if (!updated[0]) return res.status(404).json({ error: "Bag not found" });
  const payload: BagDetailResponse = toBagDetailResponse(updated[0]);
  res.json(payload);
});

// PATCH /bags/:bagId/brews/:brewId/best
// Keeps exactly one "best" brew per bag by clearing previous flags first.
app.patch("/bags/:bagId/brews/:brewId/best", async (req, res) => {
  const userId = getRequestUserId(req);
  const bagId = req.params.bagId;
  const brewId = req.params.brewId;

  const bag = await getOwnedBagById(bagId, userId);
  if (!bag) return res.status(404).json({ error: "Bag not found" });

  const updated = await db.transaction(async (tx) => {
    await tx
      .update(brews)
      .set({ isBest: false })
      .where(eq(brews.bagId, bagId));

    const rows = await tx
      .update(brews)
      .set({ isBest: true })
      .where(and(eq(brews.id, brewId), eq(brews.bagId, bagId)))
      .returning();

    return rows[0] ?? null;
  });

  if (!updated) return res.status(404).json({ error: "Brew not found" });
  res.json(updated);
});

// Export app for runtime and tests.
export default app;
