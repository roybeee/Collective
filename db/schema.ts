import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const records=sqliteTable('records',{id:text('id').primaryKey(),owner:text('owner').notNull(),kind:text('kind').notNull(),parentId:text('parent_id').notNull().default(''),data:text('data').notNull(),updatedAt:text('updated_at').notNull()},t=>[index('idx_records_owner_kind').on(t.owner,t.kind),index('idx_records_owner_parent').on(t.owner,t.parentId)]);
export const settings=sqliteTable('settings',{owner:text('owner').primaryKey(),secret:text('secret'),model:text('model').notNull().default('gpt-6-astra'),updatedAt:text('updated_at').notNull()});
export const jobs=sqliteTable('jobs',{id:text('id').primaryKey(),owner:text('owner').notNull(),campaignId:text('campaign_id').notNull(),role:text('role').notNull(),status:text('status').notNull(),providerId:text('provider_id'),model:text('model').notNull(),campaignVersion:integer('campaign_version').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),error:text('error'),tokens:integer('tokens').notNull().default(0)},t=>[index('idx_jobs_owner_campaign').on(t.owner,t.campaignId),uniqueIndex('idx_jobs_active_campaign').on(t.owner,t.campaignId).where(sql`${t.status} IN ('starting','queued','in_progress','uncertain')`)]);

export const mutationLocks=sqliteTable('mutation_locks',{owner:text('owner').primaryKey(),token:text('token').notNull(),expiresAt:integer('expires_at').notNull()});

export const authUsers=sqliteTable('auth_users',{
 id:text('id').primaryKey(),email:text('email').notNull(),passwordHash:text('password_hash'),
 workspaceOwner:text('workspace_owner').notNull(),role:text('role').notNull(),status:text('status').notNull(),createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('idx_auth_users_email').on(t.email),index('idx_auth_users_owner').on(t.workspaceOwner)]);
export const authSessions=sqliteTable('auth_sessions',{
 sessionHash:text('session_hash').primaryKey(),userId:text('user_id').notNull().references(()=>authUsers.id),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull(),
},t=>[index('idx_auth_sessions_user').on(t.userId),index('idx_auth_sessions_expiry').on(t.expiresAt)]);
export const authTokens=sqliteTable('auth_tokens',{
 tokenHash:text('token_hash').primaryKey(),userId:text('user_id').references(()=>authUsers.id),email:text('email').notNull(),owner:text('owner').notNull(),role:text('role').notNull(),kind:text('kind').notNull(),expiresAt:integer('expires_at').notNull(),used:text('used'),createdAt:integer('created_at').notNull(),
},t=>[index('idx_auth_tokens_user').on(t.userId),index('idx_auth_tokens_expiry').on(t.expiresAt)]);
export const authRateLimits=sqliteTable('auth_rate_limits',{
 key:text('key').primaryKey(),count:integer('count').notNull(),windowStart:integer('window_start').notNull(),
},t=>[index('idx_auth_rate_limits_window').on(t.windowStart)]);
