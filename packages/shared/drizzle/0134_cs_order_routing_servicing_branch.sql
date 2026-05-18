-- Cross-branch CS routing: each target pins a servicing branch; team is optional (whole-branch CS pool).

ALTER TABLE cs_order_routing_rule_targets
  ADD COLUMN servicing_branch_id uuid REFERENCES branches (id);

UPDATE cs_order_routing_rule_targets t
SET servicing_branch_id = bt.branch_id
FROM branch_teams bt
WHERE bt.id = t.team_id;

ALTER TABLE cs_order_routing_rule_targets
  ALTER COLUMN servicing_branch_id SET NOT NULL;

ALTER TABLE cs_order_routing_rule_targets
  ALTER COLUMN team_id DROP NOT NULL;
