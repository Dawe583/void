import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Messages sent from the contact page. */
export const contactMessages = pgTable("contact_messages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  topic: text("topic").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactMessages).omit({
  id: true,
  createdAt: true,
});

export type InsertContactMessage = z.infer<typeof insertContactSchema>;
export type ContactMessage = typeof contactMessages.$inferSelect;
