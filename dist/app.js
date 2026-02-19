"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
require("dotenv/config");
const path_1 = __importDefault(require("path"));
const client_1 = require("./db/client");
const schema_1 = require("./db/schema");
const drizzle_orm_1 = require("drizzle-orm");
const crypto_1 = require("crypto");
// Main Express application used by both runtime server and integration tests.
const app = (0, express_1.default)();
// Basic middleware: CORS, JSON body parsing, and static frontend hosting.
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Quick health endpoint to confirm service is up.
app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true, message: "coffee-tools-api is running" });
});
// Temporary single-user model until auth is added.
const DEV_USER_ID = process.env.DEV_USER_ID ?? "00000000-0000-0000-0000-000000000001";
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
function isPublicPath(pathname) {
    return pathname === "/health" || pathname.startsWith("/app");
}
async function fetchSupabaseUser(accessToken) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY)
        return null;
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
        },
    });
    if (!response.ok)
        return null;
    const payload = (await response.json());
    if (!payload?.id)
        return null;
    return payload;
}
// Exposes non-secret auth config to browser frontend.
app.get("/app/config.js", (_req, res) => {
    res.type("application/javascript").send(`window.APP_CONFIG = ${JSON.stringify({
        authRequired: AUTH_REQUIRED,
        supabaseUrl: SUPABASE_URL ?? null,
        supabaseAnonKey: SUPABASE_ANON_KEY ?? null,
    })};`);
});
app.use("/app", express_1.default.static(path_1.default.resolve(process.cwd(), "web")));
// Auth middleware:
// - AUTH_REQUIRED=false: allow guest fallback to DEV_USER_ID
// - AUTH_REQUIRED=true: require valid Supabase access token on API routes
app.use(async (req, res, next) => {
    if (isPublicPath(req.path))
        return next();
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
function getRequestUserId(req) {
    return req.res?.locals.userId ?? DEV_USER_ID;
}
// Ensures a bag exists and belongs to the current dev user.
async function getOwnedBagById(bagId, userId) {
    const rows = await client_1.db
        .select()
        .from(schema_1.bags)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.id, bagId), (0, drizzle_orm_1.eq)(schema_1.bags.userId, userId)));
    return rows[0] ?? null;
}
// Parses an optional numeric input from request payloads.
// Returns:
// - null when empty
// - NaN when invalid
// - number when valid
function parseOptionalNumber(value) {
    if (value === null || value === undefined || value === "")
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
}
// Integer validator used for fields like dose/taste sliders.
function parseOptionalIntegerInRange(value, fieldName, min, max) {
    const parsed = parseOptionalNumber(value);
    if (Number.isNaN(parsed))
        return { value: null, issue: { field: fieldName, message: "must be a number" } };
    if (parsed === null)
        return { value: null, issue: null };
    if (!Number.isInteger(parsed)) {
        return { value: null, issue: { field: fieldName, message: "must be an integer" } };
    }
    if (parsed < min || parsed > max) {
        return { value: null, issue: { field: fieldName, message: `must be between ${min} and ${max}` } };
    }
    return { value: parsed, issue: null };
}
// Decimal validator used for fields like rating.
function parseOptionalNumberInRange(value, fieldName, min, max) {
    const parsed = parseOptionalNumber(value);
    if (Number.isNaN(parsed))
        return { value: null, issue: { field: fieldName, message: "must be a number" } };
    if (parsed === null)
        return { value: null, issue: null };
    if (parsed < min || parsed > max) {
        return { value: null, issue: { field: fieldName, message: `must be between ${min} and ${max}` } };
    }
    return { value: parsed, issue: null };
}
// Calculates whole-day age from roast date.
function computeRoastAgeDays(roastDate) {
    if (!roastDate)
        return null;
    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const diffMs = Date.now() - roastDate.getTime();
    if (diffMs < 0)
        return 0;
    return Math.floor(diffMs / millisecondsPerDay);
}
// Gives user-facing rest status bands from roast age.
function computeRestingStatus(roastAgeDays) {
    if (roastAgeDays === null)
        return "UNKNOWN";
    if (roastAgeDays <= 3)
        return "RESTING";
    if (roastAgeDays <= 21)
        return "READY";
    return "PAST_PEAK";
}
// Shared computed bag metadata returned by multiple endpoints.
function buildBagComputedFields(roastDate) {
    const roastAgeDays = computeRoastAgeDays(roastDate);
    const restingStatus = computeRestingStatus(roastAgeDays);
    return { roastAgeDays, restingStatus };
}
// Standardizes validation error response shape.
function sendValidationError(res, issues, status = 400) {
    const payload = { errors: issues };
    return res.status(status).json(payload);
}
// Maps DB bag row to API detail DTO.
function toBagDetailResponse(row) {
    return {
        ...row,
        ...buildBagComputedFields(row.roastDate),
    };
}
// Maps DB bag row to API list DTO with brewCount aggregate.
function toBagListItemResponse(row, brewCount, averageRating) {
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
    const issues = [];
    if (!coffeeName)
        issues.push({ field: "coffeeName", message: "is required" });
    if (!roaster)
        issues.push({ field: "roaster", message: "is required" });
    if (!roastDate)
        issues.push({ field: "roastDate", message: "is required" });
    if (issues.length)
        return sendValidationError(res, issues);
    // Application-side UUID generation for explicit IDs.
    const id = (0, crypto_1.randomUUID)();
    // Keep roastDate parsing strict so age/resting logic remains reliable.
    const parsedRoastDate = new Date(roastDate);
    if (Number.isNaN(parsedRoastDate.getTime())) {
        return sendValidationError(res, [{ field: "roastDate", message: "must be a valid date" }]);
    }
    // Insert and return created row in one query.
    const inserted = await client_1.db
        .insert(schema_1.bags)
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
    if (!createdBag)
        return res.status(500).json({ error: "Failed to create bag" });
    const payload = toBagDetailResponse(createdBag);
    res.status(201).json(payload);
});
// GET /bags?status=ACTIVE|ARCHIVED
// Returns user's bags with brew counts and computed roast metadata.
app.get("/bags", async (req, res) => {
    const userId = getRequestUserId(req);
    const status = req.query.status ?? "ACTIVE";
    if (status !== "ACTIVE" && status !== "ARCHIVED") {
        return sendValidationError(res, [{ field: "status", message: "must be ACTIVE or ARCHIVED" }]);
    }
    const rows = await client_1.db
        .select()
        .from(schema_1.bags)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.userId, userId), (0, drizzle_orm_1.eq)(schema_1.bags.status, status)))
        .orderBy(schema_1.bags.updatedAt);
    if (!rows.length)
        return res.json([]);
    // Aggregate brew counts in one grouped query to avoid N+1 queries.
    const bagIds = rows.map((row) => row.id);
    const brewCounts = await client_1.db
        .select({
        bagId: schema_1.brews.bagId,
        count: (0, drizzle_orm_1.sql) `count(*)::int`,
        averageRating: (0, drizzle_orm_1.sql) `round(avg(${schema_1.brews.rating})::numeric, 2)::float`,
    })
        .from(schema_1.brews)
        .where((0, drizzle_orm_1.inArray)(schema_1.brews.bagId, bagIds))
        .groupBy(schema_1.brews.bagId);
    const bagStatsByBagId = new Map(brewCounts.map((row) => [row.bagId, { brewCount: row.count, averageRating: row.averageRating }]));
    const payload = rows.map((row) => toBagListItemResponse(row, bagStatsByBagId.get(row.id)?.brewCount ?? 0, bagStatsByBagId.get(row.id)?.averageRating ?? null));
    res.json(payload);
});
// GET /feed/brews?limit=50
// Global activity feed across all users, newest brew first.
app.get("/feed/brews", async (req, res) => {
    const limitRaw = req.query.limit;
    const parsedLimit = limitRaw ? Number(limitRaw) : 50;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
        return sendValidationError(res, [{ field: "limit", message: "must be an integer between 1 and 200" }]);
    }
    // Single query join gives enough context to render a social timeline item.
    const rows = await client_1.db
        .select({
        brewId: schema_1.brews.id,
        bagId: schema_1.brews.bagId,
        userId: schema_1.bags.userId,
        coffeeName: schema_1.bags.coffeeName,
        roaster: schema_1.bags.roaster,
        method: schema_1.brews.method,
        brewer: schema_1.brews.brewer,
        grinder: schema_1.brews.grinder,
        dose: schema_1.brews.dose,
        grindSetting: schema_1.brews.grindSetting,
        waterAmount: schema_1.brews.waterAmount,
        rating: schema_1.brews.rating,
        flavourNotes: schema_1.brews.flavourNotes,
        isBest: schema_1.brews.isBest,
        createdAt: schema_1.brews.createdAt,
    })
        .from(schema_1.brews)
        .innerJoin(schema_1.bags, (0, drizzle_orm_1.eq)(schema_1.brews.bagId, schema_1.bags.id))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.brews.createdAt))
        .limit(parsedLimit);
    const payload = rows;
    res.json(payload);
});
// POST /bags/:id/brews
// Adds a brew entry linked to an owned bag.
app.post("/bags/:id/brews", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const bag = await getOwnedBagById(bagId, userId);
    if (!bag)
        return res.status(404).json({ error: "Bag not found" });
    const { method, brewer, grinder, dose, grindSetting, waterAmount, rating, nutty, acidity, fruity, floral, sweetness, chocolate, flavourNotes, } = req.body ?? {};
    // Frontend consumes all field issues in one response.
    const issues = [];
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
    ].filter((issue) => issue !== null);
    if (parsedIssues.length)
        issues.push(...parsedIssues);
    if (issues.length)
        return sendValidationError(res, issues);
    // Insert brew and return created row.
    const inserted = await client_1.db
        .insert(schema_1.brews)
        .values({
        id: (0, crypto_1.randomUUID)(),
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
    if (!createdBrew)
        return res.status(500).json({ error: "Failed to create brew" });
    const payload = createdBrew;
    res.status(201).json(payload);
});
// GET /bags/:id/brews
// Brew history is returned newest first for bag detail UI.
app.get("/bags/:id/brews", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const bag = await getOwnedBagById(bagId, userId);
    if (!bag)
        return res.status(404).json({ error: "Bag not found" });
    const rows = await client_1.db
        .select()
        .from(schema_1.brews)
        .where((0, drizzle_orm_1.eq)(schema_1.brews.bagId, bagId))
        .orderBy((0, drizzle_orm_1.desc)(schema_1.brews.createdAt));
    const payload = rows;
    res.json(payload);
});
// GET /bags/:id/analytics
// Computes bag-level aggregates used by charts/cards in analytics screen.
app.get("/bags/:id/analytics", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const bag = await getOwnedBagById(bagId, userId);
    if (!bag)
        return res.status(404).json({ error: "Bag not found" });
    const rows = await client_1.db
        .select()
        .from(schema_1.brews)
        .where((0, drizzle_orm_1.eq)(schema_1.brews.bagId, bagId))
        .orderBy(schema_1.brews.createdAt);
    const totalBrews = rows.length;
    // Reusable average helper for ratings and taste dimensions.
    const average = (values) => values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
    const ratings = rows.map((row) => row.rating).filter((value) => value !== null);
    const averageRating = average(ratings);
    const averageTasteProfile = {
        nutty: average(rows.map((row) => row.nutty).filter((value) => value !== null)),
        acidity: average(rows.map((row) => row.acidity).filter((value) => value !== null)),
        fruity: average(rows.map((row) => row.fruity).filter((value) => value !== null)),
        floral: average(rows.map((row) => row.floral).filter((value) => value !== null)),
        sweetness: average(rows.map((row) => row.sweetness).filter((value) => value !== null)),
        chocolate: average(rows.map((row) => row.chocolate).filter((value) => value !== null)),
    };
    // Count method frequencies for bar chart.
    const brewMethodMap = new Map();
    for (const row of rows) {
        brewMethodMap.set(row.method, (brewMethodMap.get(row.method) ?? 0) + 1);
    }
    const brewMethods = Array.from(brewMethodMap.entries()).map(([method, count]) => ({ method, count }));
    // Keep chronological order for trend chart.
    const ratingTrend = rows
        .filter((row) => row.rating !== null)
        .map((row, index) => ({
        brewNumber: index + 1,
        rating: row.rating,
        createdAt: row.createdAt,
    }));
    const bestBrew = rows.find((row) => row.isBest) ??
        rows
            .filter((row) => row.rating !== null)
            .sort((a, b) => {
            if ((b.rating ?? 0) !== (a.rating ?? 0))
                return (b.rating ?? 0) - (a.rating ?? 0);
            return b.createdAt.getTime() - a.createdAt.getTime();
        })[0] ??
        null;
    const payload = {
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
    const rows = await client_1.db
        .select()
        .from(schema_1.bags)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.id, bagId), (0, drizzle_orm_1.eq)(schema_1.bags.userId, userId)));
    if (!rows[0])
        return res.status(404).json({ error: "Bag not found" });
    const payload = toBagDetailResponse(rows[0]);
    res.json(payload);
});
// PATCH /bags/:id/archive
// Marks bag as archived; archived bags are hidden from ACTIVE list.
app.patch("/bags/:id/archive", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const updated = await client_1.db
        .update(schema_1.bags)
        .set({
        status: "ARCHIVED",
        archivedAt: new Date(),
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.id, bagId), (0, drizzle_orm_1.eq)(schema_1.bags.userId, userId)))
        .returning();
    if (!updated[0])
        return res.status(404).json({ error: "Bag not found" });
    res.json(updated[0]);
});
// PATCH /bags/:id/unarchive
// Moves an archived bag back to active inventory.
app.patch("/bags/:id/unarchive", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const updated = await client_1.db
        .update(schema_1.bags)
        .set({
        status: "ACTIVE",
        archivedAt: null,
        updatedAt: new Date(),
    })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.id, bagId), (0, drizzle_orm_1.eq)(schema_1.bags.userId, userId)))
        .returning();
    if (!updated[0])
        return res.status(404).json({ error: "Bag not found" });
    res.json(updated[0]);
});
// PATCH /bags/:id
// Allows editing bag metadata for future corrections and archived bag maintenance.
app.patch("/bags/:id", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.id;
    const existing = await getOwnedBagById(bagId, userId);
    if (!existing)
        return res.status(404).json({ error: "Bag not found" });
    const { coffeeName, roaster, origin, process, roastDate, notes } = req.body ?? {};
    const updates = { updatedAt: new Date() };
    if (coffeeName !== undefined)
        updates.coffeeName = coffeeName || existing.coffeeName;
    if (roaster !== undefined)
        updates.roaster = roaster || existing.roaster;
    if (origin !== undefined)
        updates.origin = origin || null;
    if (process !== undefined)
        updates.process = process || null;
    if (notes !== undefined)
        updates.notes = notes || null;
    if (roastDate !== undefined) {
        const parsedRoastDate = new Date(roastDate);
        if (Number.isNaN(parsedRoastDate.getTime())) {
            return sendValidationError(res, [{ field: "roastDate", message: "must be a valid date" }]);
        }
        updates.roastDate = parsedRoastDate;
    }
    const updated = await client_1.db
        .update(schema_1.bags)
        .set(updates)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.bags.id, bagId), (0, drizzle_orm_1.eq)(schema_1.bags.userId, userId)))
        .returning();
    if (!updated[0])
        return res.status(404).json({ error: "Bag not found" });
    const payload = toBagDetailResponse(updated[0]);
    res.json(payload);
});
// PATCH /bags/:bagId/brews/:brewId/best
// Keeps exactly one "best" brew per bag by clearing previous flags first.
app.patch("/bags/:bagId/brews/:brewId/best", async (req, res) => {
    const userId = getRequestUserId(req);
    const bagId = req.params.bagId;
    const brewId = req.params.brewId;
    const bag = await getOwnedBagById(bagId, userId);
    if (!bag)
        return res.status(404).json({ error: "Bag not found" });
    const updated = await client_1.db.transaction(async (tx) => {
        await tx
            .update(schema_1.brews)
            .set({ isBest: false })
            .where((0, drizzle_orm_1.eq)(schema_1.brews.bagId, bagId));
        const rows = await tx
            .update(schema_1.brews)
            .set({ isBest: true })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.brews.id, brewId), (0, drizzle_orm_1.eq)(schema_1.brews.bagId, bagId)))
            .returning();
        return rows[0] ?? null;
    });
    if (!updated)
        return res.status(404).json({ error: "Brew not found" });
    res.json(updated);
});
// Export app for runtime and tests.
exports.default = app;
//# sourceMappingURL=app.js.map