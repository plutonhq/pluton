CREATE TABLE retained_managed_repositories (
 id TEXT PRIMARY KEY NOT NULL,
 former_plan_id TEXT NOT NULL,
 agent_id TEXT NOT NULL,
 storage_id TEXT NOT NULL,
 storage_path TEXT NOT NULL,
 encrypted_password TEXT NOT NULL CHECK(length(encrypted_password)>0),
 initialized_at INTEGER,
 repository_created_at INTEGER NOT NULL,
 retained_at INTEGER NOT NULL DEFAULT (unixepoch())
);
