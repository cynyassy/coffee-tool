"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brews = exports.bags = exports.bagStatus = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
// Bag lifecycle status used by UI filtering and archive flow.
exports.bagStatus = (0, pg_core_1.pgEnum)("bag_status", ["ACTIVE", "ARCHIVED"]);
// Coffee bag entity.
// Represents one purchased bag that can have many brews.
exports.bags = (0, pg_core_1.pgTable)("bags", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    userId: (0, pg_core_1.uuid)("user_id").notNull(), // temp until auth
    coffeeName: (0, pg_core_1.text)("coffee_name").notNull(),
    roaster: (0, pg_core_1.text)("roaster").notNull(),
    origin: (0, pg_core_1.text)("origin"),
    process: (0, pg_core_1.text)("process"),
    roastDate: (0, pg_core_1.timestamp)("roast_date", { withTimezone: false }),
    notes: (0, pg_core_1.text)("notes"),
    status: (0, exports.bagStatus)("status").notNull().default("ACTIVE"),
    archivedAt: (0, pg_core_1.timestamp)("archived_at", { withTimezone: false }),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: false }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)("updated_at", { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
    userStatusUpdatedAtIdx: (0, pg_core_1.index)("bags_user_status_updated_at_idx").on(table.userId, table.status, table.updatedAt),
}));
// Brew entity.
// Represents one logged cup linked to a bag.
exports.brews = (0, pg_core_1.pgTable)("brews", {
    id: (0, pg_core_1.uuid)("id").defaultRandom().primaryKey(),
    bagId: (0, pg_core_1.uuid)("bag_id").notNull(),
    method: (0, pg_core_1.text)("method").notNull(),
    brewer: (0, pg_core_1.text)("brewer"),
    grinder: (0, pg_core_1.text)("grinder"),
    dose: (0, pg_core_1.integer)("dose"), // grams
    grindSetting: (0, pg_core_1.integer)("grind_setting"),
    waterAmount: (0, pg_core_1.integer)("water_amount"), // ml or grams, your choice
    rating: (0, pg_core_1.real)("rating"), // 0.0 - 5.0
    nutty: (0, pg_core_1.integer)("nutty"), // 0 - 5
    acidity: (0, pg_core_1.integer)("acidity"), // 0 - 5
    fruity: (0, pg_core_1.integer)("fruity"), // 0 - 5
    floral: (0, pg_core_1.integer)("floral"), // 0 - 5
    sweetness: (0, pg_core_1.integer)("sweetness"), // 0 - 5
    chocolate: (0, pg_core_1.integer)("chocolate"), // 0 - 5
    isBest: (0, pg_core_1.boolean)("is_best").notNull().default(false),
    flavourNotes: (0, pg_core_1.text)("flavour_notes"),
    createdAt: (0, pg_core_1.timestamp)("created_at", { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
    bagCreatedAtIdx: (0, pg_core_1.index)("brews_bag_created_at_idx").on(table.bagId, table.createdAt),
}));
//# sourceMappingURL=schema.js.map