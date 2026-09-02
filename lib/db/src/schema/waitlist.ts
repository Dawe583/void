import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Private beta access requests. Each row carries a hash that links it to the
 * previous row, mirroring the product's own ledger idea: the receipt a visitor
 * sees is verifiable against the chain.
 */
export const waitlistRequests = pgTable("waitlist_requests", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  agents: text("agents").notNull(),
  frameworks: jsonb("frameworks").$type<string[]>().notNull().default([]),
  note: text("note"),
  source: text("source").notNull().default("web"),
  prevHash: text("prev_hash"),
  hash: text("hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWaitlistSchema = createInsertSchema(waitlistRequests).omit({
  id: true,
  createdAt: true,
});

export type InsertWaitlistRequest = z.infer<typeof insertWaitlistSchema>;
export type WaitlistRequest = typeof waitlistRequests.$inferSelect;
