-- Follow-up batches: track groups of reopened orders for conversion analytics.
CREATE TABLE IF NOT EXISTS follow_up_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  source text NOT NULL DEFAULT 'orders',
  branch_id uuid,
  created_by_id uuid NOT NULL REFERENCES users(id),
  order_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_up_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES follow_up_batches(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id),
  original_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_up_batch_items_batch_id ON follow_up_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_batch_items_order_id ON follow_up_batch_items(order_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_batches_created_by ON follow_up_batches(created_by_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_batches_branch_id ON follow_up_batches(branch_id);
