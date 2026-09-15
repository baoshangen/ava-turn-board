import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const board = sqliteTable('board', { id: integer('id').primaryKey(), revision: integer('revision').notNull(), data: text('data').notNull() });
export const salonAccount = sqliteTable('salon_account', { id:integer('id').primaryKey(), username:text('username').notNull(), passwordHash:text('password_hash').notNull(), salt:text('salt').notNull(), epoch:text('epoch').notNull() });
export const salonSessions = sqliteTable('salon_sessions', { tokenHash:text('token_hash').primaryKey(), epoch:text('epoch').notNull(), expiresAt:integer('expires_at').notNull() });
export const loginAttempts = sqliteTable('login_attempts', { key:text('key').primaryKey(), attempts:integer('attempts').notNull(), expiresAt:integer('expires_at').notNull() });
