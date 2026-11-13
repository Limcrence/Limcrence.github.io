CREATE TABLE IF NOT EXISTS progress_vaults (
  vault_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  mutation_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
