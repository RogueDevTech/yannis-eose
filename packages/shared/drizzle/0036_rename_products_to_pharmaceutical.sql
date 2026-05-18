-- Migration: Rename seed products from generic e-commerce to pharmaceutical drugs
-- This updates any existing seeded data in the database

-- Update product names, descriptions, categories, and pricing
UPDATE products SET
  name = 'Amoxicillin 500mg Capsules',
  description = 'Broad-spectrum antibiotic, 500mg capsules, 20-pack blister',
  category = 'Antibiotics',
  base_sale_price = 4500.00,
  cost_price = 1200.00,
  offers = '[{"label":"1 Pack (20 caps)","qty":1,"price":"4500.00"},{"label":"3 Packs (60 caps)","qty":3,"price":"12000.00"}]'::jsonb
WHERE name = 'Slim Fit Waist Trainer';

UPDATE products SET
  name = 'Metformin 850mg Tablets',
  description = 'Oral hypoglycemic agent, 850mg film-coated tablets, 30-pack',
  category = 'Antidiabetics',
  base_sale_price = 6500.00,
  cost_price = 1800.00,
  offers = '[{"label":"1 Pack (30 tabs)","qty":1,"price":"6500.00"},{"label":"2 Packs (60 tabs)","qty":2,"price":"11500.00"}]'::jsonb
WHERE name = 'Portable Blender Pro';

UPDATE products SET
  name = 'Ibuprofen 400mg Tablets',
  description = 'Non-steroidal anti-inflammatory, 400mg tablets, 24-pack',
  category = 'Analgesics',
  base_sale_price = 3200.00,
  cost_price = 800.00,
  offers = '[{"label":"1 Pack (24 tabs)","qty":1,"price":"3200.00"}]'::jsonb
WHERE name = 'LED Ring Light 10"';

UPDATE products SET
  name = 'Omeprazole 20mg Capsules',
  description = 'Proton pump inhibitor, 20mg enteric-coated capsules, 28-pack',
  category = 'Gastrointestinal',
  base_sale_price = 7500.00,
  cost_price = 2500.00,
  offers = '[{"label":"1 Pack (28 caps)","qty":1,"price":"7500.00"},{"label":"2 Packs (56 caps)","qty":2,"price":"13500.00"},{"label":"3 Packs (84 caps)","qty":3,"price":"19000.00"}]'::jsonb
WHERE name = 'Smart Watch X1';

UPDATE products SET
  name = 'Vitamin C 1000mg Effervescent',
  description = 'Effervescent vitamin C tablets, 1000mg, 20-tube pack, orange flavor',
  category = 'Vitamins & Supplements',
  base_sale_price = 3800.00,
  cost_price = 900.00,
  offers = '[{"label":"1 Tube (20 tabs)","qty":1,"price":"3800.00"},{"label":"Family Pack (5 Tubes)","qty":5,"price":"16000.00"}]'::jsonb
WHERE name = 'Hair Growth Oil Bundle';

-- Update offer templates
UPDATE offer_templates SET
  name = 'Amoxicillin Bulk Discount',
  price = 3800.00,
  variants = '[{"dosage":"500mg","price":3800},{"dosage":"250mg","price":2500}]'::jsonb
WHERE name = 'Waist Trainer Flash Sale';

UPDATE offer_templates SET
  name = 'Metformin Monthly Supply',
  price = 11500.00
WHERE name = 'Blender Pro Combo';

UPDATE offer_templates SET
  name = 'Vitamin C Family Pack',
  price = 16000.00
WHERE name = 'Hair Growth Complete Kit';

-- Update stock batch costs to match new pharmaceutical pricing
UPDATE stock_batches sb SET
  factory_cost = 1200.00,
  landing_cost = 300.00,
  total_landed_cost = 1500.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Amoxicillin 500mg Capsules'
  AND sb.factory_cost IN (3500.00, 3800.00);

-- Second batch for Amoxicillin (was 3800/900)
UPDATE stock_batches sb SET
  factory_cost = 1350.00,
  landing_cost = 350.00,
  total_landed_cost = 1700.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Amoxicillin 500mg Capsules'
  AND sb.factory_cost = 1200.00 AND sb.quantity = 100;

UPDATE stock_batches sb SET
  factory_cost = 1800.00,
  landing_cost = 400.00,
  total_landed_cost = 2200.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Metformin 850mg Tablets';

UPDATE stock_batches sb SET
  factory_cost = 800.00,
  landing_cost = 200.00,
  total_landed_cost = 1000.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Ibuprofen 400mg Tablets';

UPDATE stock_batches sb SET
  factory_cost = 2500.00,
  landing_cost = 600.00,
  total_landed_cost = 3100.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Omeprazole 20mg Capsules';

UPDATE stock_batches sb SET
  factory_cost = 900.00,
  landing_cost = 200.00,
  total_landed_cost = 1100.00
FROM products p
WHERE sb.product_id = p.id AND p.name = 'Vitamin C 1000mg Effervescent';

-- Update notification referencing old product name
UPDATE notifications SET
  body = 'Stock transfer of Omeprazole 20mg Capsules to GoRide Wuse Hub awaiting verification.'
WHERE body LIKE '%Smart Watch X1%';

-- Update approval request referencing old product name (table may not exist)
DO $$ BEGIN
  UPDATE approval_requests SET
    description = 'Emergency restock of Amoxicillin 500mg — supplier minimum order'
  WHERE description LIKE '%Waist Trainers%';
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
