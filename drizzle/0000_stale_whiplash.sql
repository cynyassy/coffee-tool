CREATE TYPE "public"."bag_status" AS ENUM('ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TABLE "bags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"coffee_name" text NOT NULL,
	"roaster" text NOT NULL,
	"origin" text,
	"process" text,
	"roast_date" timestamp,
	"notes" text,
	"status" "bag_status" DEFAULT 'ACTIVE' NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bag_id" uuid NOT NULL,
	"method" text NOT NULL,
	"brewer" text,
	"grinder" text,
	"dose" integer,
	"grind_setting" integer,
	"water_amount" integer,
	"rating" integer,
	"flavour_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
