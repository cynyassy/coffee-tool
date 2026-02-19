import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import app from "./app";

// Flexible JSON shape used in assertions for API payloads.
type JsonRecord = Record<string, unknown>;

let server: Server;
let baseUrl = "";

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const data = (await response.json()) as unknown;
  return { status: response.status, data };
}

describe("coffee tools full flow", () => {
  beforeAll(async () => {
    // Start API on random available port for isolated test execution.
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // Ensure HTTP server is closed so test process exits cleanly.
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it("creates bag, logs brews, reads analytics, archives bag", async () => {
    const suffix = Date.now();
    const createBag = await api("/bags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        coffeeName: `Flow Test ${suffix}`,
        roaster: "Flow Roaster",
        roastDate: "2026-02-10",
        origin: "Panama",
        process: "Washed",
        notes: "integration test",
      }),
    });

    expect(createBag.status).toBe(201);
    const createdBag = createBag.data as JsonRecord;
    expect(createdBag.status).toBe("ACTIVE");
    expect(createdBag.restingStatus).toBeTypeOf("string");

    const bagId = String(createdBag.id);

    // Add multiple brews to validate history + analytics aggregation behavior.
    const brewPayloads = [
      {
        method: "V60",
        brewer: "Hario V60",
        grinder: "Baratza Virtuoso",
        dose: 18,
        grindSetting: 20,
        waterAmount: 300,
        rating: 3.6,
        nutty: 2,
        acidity: 4,
        fruity: 5,
        floral: 5,
        sweetness: 3,
        chocolate: 1,
        flavourNotes: "jasmine, bergamot",
      },
      {
        method: "V60",
        brewer: "Hario V60",
        grinder: "Baratza Virtuoso",
        dose: 18,
        grindSetting: 18,
        waterAmount: 300,
        rating: 3.4,
        nutty: 2,
        acidity: 4,
        fruity: 4,
        floral: 5,
        sweetness: 3,
        chocolate: 1,
        flavourNotes: "floral, citrus",
      },
    ];

    for (const payload of brewPayloads) {
      const brewResponse = await api(`/bags/${bagId}/brews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(brewResponse.status).toBe(201);
    }

    const brewListAfterCreate = await api(`/bags/${bagId}/brews`);
    const createdBrews = brewListAfterCreate.data as JsonRecord[];
    const firstBrew = createdBrews[0];
    expect(firstBrew).toBeDefined();
    if (!firstBrew) throw new Error("Expected at least one brew");
    const brewIdToMarkBest = String(firstBrew.id);
    const markBest = await api(`/bags/${bagId}/brews/${brewIdToMarkBest}/best`, { method: "PATCH" });
    expect(markBest.status).toBe(200);

    const bagList = await api("/bags?status=ACTIVE");
    expect(bagList.status).toBe(200);
    const bags = bagList.data as JsonRecord[];
    const flowBag = bags.find((bag) => bag.id === bagId);
    expect(flowBag).toBeDefined();
    expect(flowBag?.brewCount).toBe(2);

    const brewList = await api(`/bags/${bagId}/brews`);
    expect(brewList.status).toBe(200);
    expect((brewList.data as JsonRecord[]).length).toBe(2);

    const feed = await api("/feed/brews");
    expect(feed.status).toBe(200);
    const feedRows = feed.data as JsonRecord[];
    expect(feedRows.length).toBeGreaterThanOrEqual(2);
    expect(feedRows.some((row) => row.bagId === bagId)).toBe(true);

    const analytics = await api(`/bags/${bagId}/analytics`);
    expect(analytics.status).toBe(200);
    const analyticsData = analytics.data as JsonRecord;
    expect(analyticsData.totalBrews).toBe(2);
    expect(analyticsData.averageRating).toBe(3.5);
    expect(analyticsData.restingStatus).toBeTypeOf("string");
    expect((analyticsData.bestBrew as JsonRecord).id).toBe(brewIdToMarkBest);

    // Archive and verify bag moves from active -> archived list.
    const archive = await api(`/bags/${bagId}/archive`, { method: "PATCH" });
    expect(archive.status).toBe(200);

    const activeAfter = await api("/bags?status=ACTIVE");
    const activeBags = activeAfter.data as JsonRecord[];
    expect(activeBags.some((bag) => bag.id === bagId)).toBe(false);

    const archivedAfter = await api("/bags?status=ARCHIVED");
    const archivedBags = archivedAfter.data as JsonRecord[];
    const archivedBag = archivedBags.find((bag) => bag.id === bagId);
    expect(archivedBag).toBeDefined();
    expect(archivedBag?.brewCount).toBe(2);

    const unarchive = await api(`/bags/${bagId}/unarchive`, { method: "PATCH" });
    expect(unarchive.status).toBe(200);
    const activeAgain = await api("/bags?status=ACTIVE");
    const activeBagsAgain = activeAgain.data as JsonRecord[];
    expect(activeBagsAgain.some((bag) => bag.id === bagId)).toBe(true);
  });
});
