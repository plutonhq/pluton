export type SourceTypes = 'device' | 'database' | 'googleworkspace' | 'microsoft365';

export type SqlDatabaseConfig = {
	engine: 'postgres' | 'mysql' | 'mongodb';
	host: string;
	port: number;
	user: string;
	password: string;
	database: string;
	config?: Record<string, string>; // e.g. ['--column-inserts']
};

export type FirebaseDatabaseConfig = {
	engine: 'firebase';
	projectId: string;
	serviceAccountKey: string; // JSON string or base64
	databaseURL?: string; // for Realtime Database
	storageBucket?: string; // for Storage backups
	config?: Record<string, string>;
};

export type SupabaseDatabaseConfig = {
	engine: 'supabase';
	url: string; // e.g. https://xyz.supabase.co
	anonKey: string;
	serviceRoleKey: string;
	schema?: string; // which Postgres schema to dump
	config?: Record<string, string>;
};

export type DatabaseSource = { type: 'database' } & (
	| SqlDatabaseConfig
	| FirebaseDatabaseConfig
	| SupabaseDatabaseConfig
);

export type GoogleAppSource = {
	type: 'google';
	services: Array<
		| 'all'
		| 'drive' // Google Drive (files & folders)
		| 'gmail' // Gmail (mailboxes)
		| 'calendar' // Google Calendar events
		| 'contacts' // Google Contacts
		| 'sites' // Google Sites
		| 'admin' // Admin SDK (users, groups, roles)
		| 'chat' // Google Chat messages & rooms
		| 'tasks' // Google Tasks
		| 'keep' // Google Keep notes
		| 'groups' // Google Groups
	>;
	creds: {
		clientId: string;
		clientSecret: string;
		refreshToken: string;
		scopes: string[];
	};
	filters?: {
		driveFolderIds?: string[]; // only these Drive folder IDs
		gmailLabelIds?: string[]; // only these Gmail label IDs
		calendarIds?: string[]; // only these Calendar IDs
		contactGroupIds?: string[]; // only these Contact Group IDs
		sitesIds?: string[]; // only these Site IDs
		chatRoomIds?: string[]; // only these Chat room IDs
		taskListIds?: string[]; // only these Task list IDs
		groupIds?: string[]; // only these Groups IDs
	};
};

export type MicrosoftAppSource = {
	type: 'microsoft';
	service: Array<
		| 'exchange-mail'
		| 'exchange-calendar'
		| 'exchange-contacts'
		| 'onedrive'
		| 'sharepoint'
		| 'teams'
		| 'planner'
		| 'groups'
		| 'onenote'
		| 'yammer'
	>;
	creds: {
		tenantId: string;
		clientId: string;
		clientSecret: string;
		certificateBase64?: string;
		scopes: string[];
	};
	// optional filters
	filters?: {
		siteIds?: string[];
		channelIds?: string[];
		folderPaths?: string[];
	};
};

export type DeviceSource = {
	type: 'device';
	includes: string[];
	excludes: string[];
};

export type PlanSource = DeviceSource | DatabaseSource | GoogleAppSource | MicrosoftAppSource;
