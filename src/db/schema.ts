import { pgTable, uuid, text, timestamp, integer, pgEnum, real, index, boolean } from "drizzle-orm/pg-core";

// Bag lifecycle status used by UI filtering and archive flow.
export const bagStatus = pgEnum("bag_status", ["ACTIVE", "ARCHIVED"]);

// Coffee bag entity.
// Represents one purchased bag that can have many brews.
export const bags = pgTable(
  "bags",
  {
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
  },
  (table) => ({
    userStatusUpdatedAtIdx: index("bags_user_status_updated_at_idx").on(
      table.userId,
      table.status,
      table.updatedAt,
    ),
  }),
);

// Brew entity.
// Represents one logged cup linked to a bag.
export const brews = pgTable(
  "brews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bagId: uuid("bag_id").notNull(),
    method: text("method").notNull(),
    brewer: text("brewer"),
    grinder: text("grinder"),
    dose: integer("dose"), // grams
    grindSetting: integer("grind_setting"),
    waterAmount: integer("water_amount"), // ml or grams, your choice
    rating: real("rating"), // 0.0 - 5.0
    nutty: integer("nutty"), // 0 - 5
    acidity: integer("acidity"), // 0 - 5
    fruity: integer("fruity"), // 0 - 5
    floral: integer("floral"), // 0 - 5
    sweetness: integer("sweetness"), // 0 - 5
    chocolate: integer("chocolate"), // 0 - 5
    isBest: boolean("is_best").notNull().default(false),
    flavourNotes: text("flavour_notes"),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    bagCreatedAtIdx: index("brews_bag_created_at_idx").on(table.bagId, table.createdAt),
  }),
);

// Public user profile used by social feed features.
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id").primaryKey(),
    username: text("username").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: false }).notNull().defaultNow(),
  },
  (table) => ({
    usernameIdx: index("user_profiles_username_idx").on(table.username),
  }),
);
