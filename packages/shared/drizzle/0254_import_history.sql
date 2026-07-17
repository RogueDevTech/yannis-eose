-- Import history tracking
-- Stores one row per bulk import for audit and troubleshooting.

CREATE TABLE IF NOT EXISTS import_batches (
  id            uuid        PRIMARY KEY,
  resource_type text        NOT NULL,
  file_name     text,
  total_rows    integer     NOT NULL,
  success_count integer     NOT NULL DEFAULT 0,
  failed_count  integer     NOT NULL DEFAULT 0,
  created_by    uuid        NOT NULL REFERENCES users(id),
  branch_id     uuid                 REFERENCES branches(id),
  metadata      jsonb,
  created_at    timestamptz NOT NULL  DEFAULT now()
);

-- Who imported + recency
CREATE INDEX idx_import_batches_created_by_at
  ON import_batches (created_by, created_at DESC);

-- Filter by resource type + recency
CREATE INDEX idx_import_batches_resource_type_at
  ON import_batches (resource_type, created_at DESC);
