import { pgTable, uuid, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";

export const bagStatus = pgEnum("bag_status", ["ACTIVE", "ARCHIVED"]);

export const bags = pgTable("bags", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull(), // temp until auth
  coffeeName: text("coffee_name").notNull(),
  roaster: text("roaster").notNull(),
  origin: text("origin"),
  process: text("process"),
  roastDate: timestamp("roast_date", { withTimezone: false }),
  notes: text("notes"),
  status: bagStatus("status").notNull().default("ACTIVE"),
  archivedAt: timestamp("archived_at", { withTimezone: false }),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
});

export const brews = pgTable("brews", {
  id: uuid("id").defaultRandom().primaryKey(),
  bagId: uuid("bag_id").notNull(),
  method: text("method").notNull(),
  brewer: text("brewer"),
  grinder: text("grinder"),
  dose: integer("dose"),          // grams
  grindSetting: integer("grind_setting"),
  waterAmount: integer("water_amount"), // ml or grams, your choice
  rating: integer("rating"),      // store 0-50 if you want 0.0-5.0 later
  flavourNotes: text("flavour_notes"),
  createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
});
