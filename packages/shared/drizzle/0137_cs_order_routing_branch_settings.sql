-- Per funnel branch: how CS auto-dispatch interprets routing rules (branch-only vs product-keyed).

CREATE TYPE cs_routing_relationship_mode AS ENUM ('BRANCH_DEFAULT', 'PRODUCT_ALLOCATION');

CREATE TABLE cs_order_routing_branch_settings (
  owner_branch_id uuid PRIMARY KEY REFERENCES branches (id) ON DELETE CASCADE,
  relationship_mode cs_routing_relationship_mode NOT NULL DEFAULT 'BRANCH_DEFAULT',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
