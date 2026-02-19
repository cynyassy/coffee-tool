import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "net";
import type { Server } from "http";
import { sql } from "drizzle-orm";
import { db } from "./db/client";

type JsonRecord = Record<string, unknown>;

let app: { listen: (port: number) => Server };
let server: Server;
let baseUrl = "";

type ApiOptions = {
  userId?: string;
  email?: string;
  body?: unknown;
  method?: string;
};

async function api(path: string, options: ApiOptions = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.userId) headers["x-dev-user-id"] = options.userId;
  if (options.email) headers["x-dev-user-email"] = options.email;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = (await response.json()) as unknown;
  return { status: response.status, data };
}

describe("global feed multi-user flow", () => {
  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "false";
    process.env.ALLOW_DEV_USER_HEADER = "true";
    ({ default: app } = await import("./app"));

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  beforeEach(async () => {
    // Isolated run: clear all records so feed order/content is deterministic.
    await db.execute(sql`TRUNCATE TABLE brews, bags, user_profiles RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  });

  it("creates 10 users, logs brews, and returns newest-first global feed", async () => {
    const runId = `r${Date.now()}`;
    const users = Array.from({ length: 10 }, (_, index) => {
      const n = index + 1;
      return {
        userId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
        email: `brew${n}@example.com`,
        username: `brew_user_${n}`,
      };
    });

    const expectedFeedOrder: string[] = [];

    for (const user of users) {
      const profile = await api("/me/profile", {
        method: "PATCH",
        userId: user.userId,
        email: user.email,
        body: { username: user.username },
      });
      expect(profile.status).toBe(200);

      const bag = await api("/bags", {
        method: "POST",
        userId: user.userId,
        email: user.email,
        body: {
          coffeeName: `Coffee ${user.username}`,
          roaster: `Roaster ${user.username}`,
          roastDate: "2026-02-10",
          origin: "Ethiopia",
          process: "Washed",
        },
      });
      expect(bag.status).toBe(201);
      const bagId = String((bag.data as JsonRecord).id);

      const firstNote = `${runId} ${user.username} brew 1`;
      const secondNote = `${runId} ${user.username} brew 2`;

      const brewOne = await api(`/bags/${bagId}/brews`, {
        method: "POST",
        userId: user.userId,
        email: user.email,
        body: {
          method: "Pourover",
          brewer: "V60",
          rating: 3.5,
          flavourNotes: firstNote,
        },
      });
      expect(brewOne.status).toBe(201);

      // Small delay keeps createdAt values strictly increasing for stable feed ordering assertions.
      await new Promise((resolve) => setTimeout(resolve, 10));

      const brewTwo = await api(`/bags/${bagId}/brews`, {
        method: "POST",
        userId: user.userId,
        email: user.email,
        body: {
          method: "Espresso",
          brewer: "Gaggia Classic",
          rating: 4,
          flavourNotes: secondNote,
        },
      });
      expect(brewTwo.status).toBe(201);

      expectedFeedOrder.unshift(secondNote, firstNote);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const feed = await api("/feed/brews?limit=200");
    expect(feed.status).toBe(200);
    const rows = (feed.data as JsonRecord[]).filter((row) =>
      String(row.flavourNotes || "").startsWith(runId),
    );

    expect(rows.length).toBe(20);

    const usernames = new Set(rows.map((row) => String(row.username)));
    for (const user of users) {
      expect(usernames.has(user.username)).toBe(true);
    }

    const notesInFeedOrder = rows.map((row) => String(row.flavourNotes));
    expect(notesInFeedOrder).toEqual(expectedFeedOrder);
  });
});
