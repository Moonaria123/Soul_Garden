CREATE TABLE `app_config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`timestamp` text NOT NULL,
	`token_estimate` integer,
	`emotion_hint` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_session` ON `chat_messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_entity` ON `chat_messages` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_messages_timestamp` ON `chat_messages` (`entity_id`,`timestamp`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`summaries` text DEFAULT '[]',
	`last_summarized_message_index` integer DEFAULT 0,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_entity` ON `chat_sessions` (`entity_id`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`entity_type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`avatar_data` text,
	`questionnaire_data` text,
	`soul_docs` text,
	`text_materials` text,
	`chat_materials` text,
	`web_search_materials` text,
	`background_image` text,
	`user_call_name` text,
	`user_perception` text,
	`nickname` text,
	`region` text,
	`error_message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_embeddings` (
	`memory_id` text NOT NULL,
	`memory_kind` text NOT NULL,
	`embedding` blob,
	`model_name` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memory_embeddings_pk` ON `memory_embeddings` (`memory_id`,`memory_kind`);--> statement-breakpoint
CREATE TABLE `memory_events` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`session_id` text,
	`source` text DEFAULT 'dialogue' NOT NULL,
	`event_type` text NOT NULL,
	`summary` text NOT NULL,
	`quote_snippet` text,
	`salience_score` real DEFAULT 0.5 NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`last_used_at` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_memory_events_entity` ON `memory_events` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_events_salience` ON `memory_events` (`entity_id`,`salience_score`);--> statement-breakpoint
CREATE TABLE `memory_facts` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`fact_type` text NOT NULL,
	`statement` text NOT NULL,
	`evidence_refs` text,
	`salience_score` real DEFAULT 0.5 NOT NULL,
	`confidence` real DEFAULT 0.5 NOT NULL,
	`merge_key` text,
	`last_used_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_facts_entity` ON `memory_facts` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_facts_type` ON `memory_facts` (`entity_id`,`fact_type`);--> statement-breakpoint
CREATE TABLE `memory_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`summary_scope` text NOT NULL,
	`summary_text` text NOT NULL,
	`source_range` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_memory_summaries_entity` ON `memory_summaries` (`entity_id`);--> statement-breakpoint
CREATE TABLE `open_loops` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`topic` text NOT NULL,
	`loop_type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`origin_event_id` text,
	`next_followup_hint` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`origin_event_id`) REFERENCES `memory_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_open_loops_entity` ON `open_loops` (`entity_id`,`status`);--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`alias` text,
	`context_window` integer,
	`is_custom` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`supports_thinking` integer DEFAULT false NOT NULL,
	`supports_vision` integer DEFAULT false NOT NULL,
	`supports_web_search` integer DEFAULT false NOT NULL,
	`capabilities_text` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_provider_models_provider` ON `provider_models` (`provider_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_type` text DEFAULT 'openai' NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_api_key` text,
	`api_key_iv` text,
	`is_default` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `relationship_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text NOT NULL,
	`affinity_score` real,
	`trust_score` real,
	`emotional_temperature` real,
	`boundary_sensitivity` real,
	`preferred_addressing_style` text,
	`last_meaningful_contact_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`entity_id`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_relationship_snapshots_entity` ON `relationship_snapshots` (`entity_id`);--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`applied_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_state` (
	`session_id` text PRIMARY KEY NOT NULL,
	`working_summary` text,
	`last_summarized_message_id` text,
	`last_memory_extracted_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`id` text PRIMARY KEY DEFAULT 'global-user-profile' NOT NULL,
	`display_name` text,
	`nickname` text,
	`age` text,
	`gender` text,
	`personality` text,
	`bio` text,
	`avatar_data` text,
	`chat_reply_style` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
