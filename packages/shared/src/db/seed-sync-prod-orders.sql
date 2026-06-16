-- ============================================================
-- Seed script: Sync prod-like order data for today (2026-06-16)
-- Branches: Lagos, Remote, Ibadan
-- ============================================================
-- Prod snapshot:
--   Lagos:  44 orders (1 unassigned, 11 assigned, 25 unconfirmed, 7 confirmed, 1 deleted) + 14 cart abandonment
--   Remote: 79 orders (0 unassigned, 25 assigned, 30 unconfirmed, 24 confirmed, 0 deleted) + 13 cart abandonment
--   Ibadan: 20 orders (0 unassigned, 7 assigned, 9 unconfirmed, 4 confirmed, 0 deleted) + 10 cart abandonment
--   Follow-Up: 14 (10 unassigned, 0 assigned, 3 engaged, 1 confirmed)
--   Cart Orders: 14 (5 unassigned, 0 assigned, 9 engaged)
-- ============================================================

BEGIN;

-- ============================================================
-- 0. Assign some MBs to Remote and Ibadan branches
-- ============================================================
INSERT INTO user_branches (user_id, branch_id, is_primary) VALUES
  -- Remote branch MBs (pick 5 from Lagos)
  ('019e70b1-a705-7ba7-8dcd-624d757e07ce', '019df73d-a577-7117-abac-7607fc7017a2', false), -- Kemi
  ('019e70b1-a705-7ba7-8dcd-6250a4804090', '019df73d-a577-7117-abac-7607fc7017a2', false), -- Funmi
  ('019e70b5-897d-7e5d-915b-e3fca2360a27', '019df73d-a577-7117-abac-7607fc7017a2', false), -- Musa
  ('019e70b1-a705-7ba7-8dcd-624fec68c2c3', '019df73d-a577-7117-abac-7607fc7017a2', false), -- Segun
  ('019e70b5-897d-7e5d-915b-e3fb757364d7', '019df73d-a577-7117-abac-7607fc7017a2', false), -- Tosin
  -- Ibadan branch MBs (pick 3 from Lagos)
  ('019e70b1-a705-7ba7-8dcd-62521dcdf7fb', '019df3db-f659-7330-b2df-a7443b87b63c', false), -- Ngozi
  ('019e70b5-897e-724d-a544-1996f91df0ad', '019df3db-f659-7330-b2df-a7443b87b63c', false), -- Gbenga
  ('019e70b5-897d-7e5d-915b-e3fe3957ed07', '019df3db-f659-7330-b2df-a7443b87b63c', false)  -- Olayinka
ON CONFLICT DO NOTHING;

-- ============================================================
-- Helper: Nigerian names + phone hashes for realistic data
-- ============================================================
-- We'll use gen_random_uuid() for IDs (UUIDv7 not critical for test data)
-- and encode(sha256(...), 'hex') for phone hashes

-- ============================================================
-- 1. ORDERS — Lagos Branch (44 total)
-- Status breakdown: 1 UNPROCESSED, 11 CS_ASSIGNED, 25 CS_ENGAGED (unconfirmed), 7 CONFIRMED, 1 DELETED
-- ============================================================

-- Products we'll use:
--   Arjuna and Lasuna: 019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046  (₦30,000)
--   LIV T-550:         019e70ae-55ca-72ac-8cc3-4cbcdbbd742a  (₦59,500)
--   Arjuna:            019de620-e63a-7607-9cb0-2b32d3561e77  (₦30,000)
--   Lasuna:            019de9cd-da69-756b-a0f8-2c9f33706bd6  (₦30,000)
--   Ashwangandha:      019e16b4-54ab-79fa-bc8c-e209ad9984d7  (₦30,000)

-- Lagos MBs:
--   Paul:     019e70ae-55c9-743e-bc11-a0e878c6e7be
--   Hassan:   019e70b1-a705-7ba7-8dcd-6251d6106088
--   Adaeze:   019e70b5-897d-7e5d-915b-e3faa20085cc
--   Chiamaka: 019e70b5-897d-7e5d-915b-e3fd4d80f700
--   Uche:     019e70b1-a705-7ba7-8dcd-624e28b0087c
--   Nneka:    019e70b5-897e-724d-a544-1995c6487542

-- Lagos CS:
--   Alexandra: 019e70ae-55c9-743e-bc11-a0eaa803cedc
--   Blessing:  019e70b1-a705-7ba7-8dcd-6256563a2390
--   Tunde:     019e70b1-a705-7ba7-8dcd-6257f99a4507
--   Mercy:     019e70b1-a705-7ba7-8dcd-6258a3bbf547

-- Lagos Campaigns:
--   Brahmi:         019e0d33-5fff-7caf-8f7c-a4d3085726d6
--   Arjuna:         019e0d44-1c6e-7f76-9452-8680c184119b
--   Healthy:        019e030b-0576-7d06-9d88-884f5e1387af
--   Liv T-550:      019e0d85-e129-77a3-90c6-c740135433d1

-- Create a helper function for random timestamps today
CREATE OR REPLACE FUNCTION _seed_ts(hour_offset int) RETURNS timestamptz AS $$
  SELECT ('2026-06-16'::date + (hour_offset * interval '1 hour') + (random() * interval '55 minutes'))::timestamptz;
$$ LANGUAGE sql;

-- ============================================================
-- LAGOS ORDERS (44)
-- ============================================================

-- 1 UNPROCESSED
INSERT INTO orders (id, campaign_id, media_buyer_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70ae-55c9-743e-bc11-a0e878c6e7be', 'UNPROCESSED', 'Adewale Ogundimu', encode(sha256('08031110001'::bytea), 'hex'), '08031110001', '12 Broad St, Lagos', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(7));

-- 11 CS_ASSIGNED
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ASSIGNED', 'Fatima Bello', encode(sha256('08031110002'::bytea), 'hex'), '08031110002', '45 Ajose Adeogun, VI', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(6), _seed_ts(6)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ASSIGNED', 'Chioma Nwaeze', encode(sha256('08031110003'::bytea), 'hex'), '08031110003', '78 Allen Ave, Ikeja', 'Lagos', 30000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(6), _seed_ts(6)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ASSIGNED', 'Murtala Yusuf', encode(sha256('08031110004'::bytea), 'hex'), '08031110004', '23 Agege Motor Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(7)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ASSIGNED', 'Aisha Mohammed', encode(sha256('08031110005'::bytea), 'hex'), '08031110005', '56 Oshodi Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(7)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897e-724d-a544-1995c6487542', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ASSIGNED', 'Babajide Omotosho', encode(sha256('08031110006'::bytea), 'hex'), '08031110006', '90 Ikorodu Rd', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(8)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ASSIGNED', 'Zainab Abdullahi', encode(sha256('08031110007'::bytea), 'hex'), '08031110007', '34 Maryland, Ikeja', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(8)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ASSIGNED', 'Emeka Obi', encode(sha256('08031110008'::bytea), 'hex'), '08031110008', '67 Surulere St', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ASSIGNED', 'Olumide Farouk', encode(sha256('08031110009'::bytea), 'hex'), '08031110009', '12 Lekki Phase 1', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ASSIGNED', 'Halima Sani', encode(sha256('08031110010'::bytea), 'hex'), '08031110010', '45 Apapa Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ASSIGNED', 'Taofeek Olanrewaju', encode(sha256('08031110011'::bytea), 'hex'), '08031110011', '89 Festac Town', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897e-724d-a544-1995c6487542', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ASSIGNED', 'Khadija Usman', encode(sha256('08031110012'::bytea), 'hex'), '08031110012', '23 Yaba Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(10), _seed_ts(10));

-- 25 CS_ENGAGED (unconfirmed)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Ibukun Adeyemi', encode(sha256('08031120001'::bytea), 'hex'), '08031120001', '15 Marina St', 'Lagos', 30000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(5), _seed_ts(6)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Adeola Balogun', encode(sha256('08031120002'::bytea), 'hex'), '08031120002', '28 Herbert Macaulay', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(5), _seed_ts(6)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Tolani Ogundele', encode(sha256('08031120003'::bytea), 'hex'), '08031120003', '41 Opebi Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(5), _seed_ts(6)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Sekinat Adegoke', encode(sha256('08031120004'::bytea), 'hex'), '08031120004', '55 Ojuelegba', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Yinka Afolabi', encode(sha256('08031120005'::bytea), 'hex'), '08031120005', '72 Awolowo Way', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b5-897e-724d-a544-1995c6487542', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Kunle Fashola', encode(sha256('08031120006'::bytea), 'hex'), '08031120006', '18 Bode Thomas', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Ganiu Bakare', encode(sha256('08031120007'::bytea), 'hex'), '08031120007', '33 Mushin Rd', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Shade Olaniyan', encode(sha256('08031120008'::bytea), 'hex'), '08031120008', '47 Ojo Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Rasheedat Jimoh', encode(sha256('08031120009'::bytea), 'hex'), '08031120009', '61 Badagry Exp', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Opeyemi Adekola', encode(sha256('08031120010'::bytea), 'hex'), '08031120010', '84 Iyana Ipaja', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Bolaji Sotunde', encode(sha256('08031120011'::bytea), 'hex'), '08031120011', '96 Agbara Est', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897e-724d-a544-1995c6487542', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Nkechi Azubuike', encode(sha256('08031120012'::bytea), 'hex'), '08031120012', '19 Epe Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Maryam Garba', encode(sha256('08031120013'::bytea), 'hex'), '08031120013', '37 Ajah Rd', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Damilola Oyelaran', encode(sha256('08031120014'::bytea), 'hex'), '08031120014', '52 Gbagada', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Tijani Akande', encode(sha256('08031120015'::bytea), 'hex'), '08031120015', '74 Ketu Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Binta Abdulkadir', encode(sha256('08031120016'::bytea), 'hex'), '08031120016', '39 Bariga', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Samson Oluwaseun', encode(sha256('08031120017'::bytea), 'hex'), '08031120017', '67 Alagomeji', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b5-897e-724d-a544-1995c6487542', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Folake Oyediran', encode(sha256('08031120018'::bytea), 'hex'), '08031120018', '82 Ifako Gbagada', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Kabiru Lawal', encode(sha256('08031120019'::bytea), 'hex'), '08031120019', '14 Berger Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Amina Dikko', encode(sha256('08031120020'::bytea), 'hex'), '08031120020', '49 Coker Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Taiwo Onifade', encode(sha256('08031120021'::bytea), 'hex'), '08031120021', '58 Palmgrove', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(9)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Jumoke Adebiyi', encode(sha256('08031120022'::bytea), 'hex'), '08031120022', '71 Onipanu', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(10)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Risikat Mustapha', encode(sha256('08031120023'::bytea), 'hex'), '08031120023', '93 Cele Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(10)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897e-724d-a544-1995c6487542', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Lukman Oyetunji', encode(sha256('08031120024'::bytea), 'hex'), '08031120024', '26 Ilasamaja', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(10), _seed_ts(10)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Wasiu Animashaun', encode(sha256('08031120025'::bytea), 'hex'), '08031120025', '43 Cement Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(10), _seed_ts(10));

-- 7 CONFIRMED
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, confirmed_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CONFIRMED', 'Ayo Adebayo', encode(sha256('08031130001'::bytea), 'hex'), '08031130001', '10 Lekki Rd', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(5), _seed_ts(8)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CONFIRMED', 'Sade Olawale', encode(sha256('08031130002'::bytea), 'hex'), '08031130002', '25 Ikoyi', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(5), _seed_ts(8)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b5-897d-7e5d-915b-e3fd4d80f700', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CONFIRMED', 'Kazeem Adeniyi', encode(sha256('08031130003'::bytea), 'hex'), '08031130003', '38 VGC', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(6), _seed_ts(9)),
  (gen_random_uuid(), '019e030b-0576-7d06-9d88-884f5e1387af', '019e70b1-a705-7ba7-8dcd-624e28b0087c', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CONFIRMED', 'Omolola Fasasi', encode(sha256('08031130004'::bytea), 'hex'), '08031130004', '51 Banana Island', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(6), _seed_ts(9)),
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897e-724d-a544-1995c6487542', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CONFIRMED', 'Sikiru Ogunleye', encode(sha256('08031130005'::bytea), 'hex'), '08031130005', '64 Ajah Lekki', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(7), _seed_ts(9)),
  (gen_random_uuid(), '019e0d33-5fff-7caf-8f7c-a4d3085726d6', '019e70ae-55c9-743e-bc11-a0e878c6e7be', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CONFIRMED', 'Funke Adeoye', encode(sha256('08031130006'::bytea), 'hex'), '08031130006', '77 Sangotedo', 'Lagos', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(9), _seed_ts(7), _seed_ts(9)),
  (gen_random_uuid(), '019e0d85-e129-77a3-90c6-c740135433d1', '019e70b1-a705-7ba7-8dcd-6251d6106088', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CONFIRMED', 'Rasaq Adeyemo', encode(sha256('08031130007'::bytea), 'hex'), '08031130007', '88 Eleko Beach', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(10), _seed_ts(7), _seed_ts(10));

-- 1 DELETED
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, deleted_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e0d44-1c6e-7f76-9452-8680c184119b', '019e70b5-897d-7e5d-915b-e3faa20085cc', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'DELETED', 'Test Customer Lagos', encode(sha256('08031140001'::bytea), 'hex'), '08031140001', 'Test Address', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'edge-form', 'PAY_ON_DELIVERY', _seed_ts(8), _seed_ts(6), _seed_ts(8));

-- ============================================================
-- 2. ORDERS — Remote Branch (79 total)
-- Status: 0 UNPROCESSED, 25 CS_ASSIGNED, 30 CS_ENGAGED, 24 CONFIRMED, 0 DELETED
-- Using campaigns from Remote: ORDER READY, Pain Relieve Pills, Madhuarara
-- ============================================================

-- Remote MBs (assigned above):
--   Kemi:   019e70b1-a705-7ba7-8dcd-624d757e07ce
--   Funmi:  019e70b1-a705-7ba7-8dcd-6250a4804090
--   Musa:   019e70b5-897d-7e5d-915b-e3fca2360a27
--   Segun:  019e70b1-a705-7ba7-8dcd-624fec68c2c3
--   Tosin:  019e70b5-897d-7e5d-915b-e3fb757364d7

-- Remote Campaigns:
--   ORDER READY:       019df7f6-e6f0-7ca9-9b8f-8897e86d5d11
--   Pain Relieve Pills: 019e1c67-f32a-7217-9ca3-7ee1df494eaf
--   Madhuarara:        019e268d-ea25-7cef-aa6a-8fbc7246467f

-- Remote CS (all CS are multi-branch):
--   Alexandra: 019e70ae-55c9-743e-bc11-a0eaa803cedc
--   Blessing:  019e70b1-a705-7ba7-8dcd-6256563a2390
--   Tunde:     019e70b1-a705-7ba7-8dcd-6257f99a4507
--   Mercy:     019e70b1-a705-7ba7-8dcd-6258a3bbf547
--   Ibrahim:   019e70b1-a705-7ba7-8dcd-62598a52e377
--   Yetunde:   019e70b1-a705-7ba7-8dcd-625a1d1abb0e

-- 25 CS_ASSIGNED (Remote)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019df7f6-e6f0-7ca9-9b8f-8897e86d5d11', '019e1c67-f32a-7217-9ca3-7ee1df494eaf', '019e268d-ea25-7cef-aa6a-8fbc7246467f']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-624d757e07ce', '019e70b1-a705-7ba7-8dcd-6250a4804090', '019e70b5-897d-7e5d-915b-e3fca2360a27', '019e70b1-a705-7ba7-8dcd-624fec68c2c3', '019e70b5-897d-7e5d-915b-e3fb757364d7']::uuid[])[1 + (i % 5)],
  (ARRAY['019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b1-a705-7ba7-8dcd-6257f99a4507', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', '019e70b1-a705-7ba7-8dcd-62598a52e377', '019e70b1-a705-7ba7-8dcd-625a1d1abb0e']::uuid[])[1 + (i % 6)],
  'CS_ASSIGNED',
  'Remote Customer R-A' || i,
  encode(sha256(('08091200' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08091200' || lpad(i::text, 3, '0'),
  i || ' Remote St, Abuja',
  'FCT',
  (ARRAY[30000.00, 59500.00, 60000.00]::numeric[])[1 + (i % 3)],
  (ARRAY[2500.00, 28000.00, 20000.00]::numeric[])[1 + (i % 3)],
  CASE (i % 3)
    WHEN 0 THEN '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    ELSE '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb
  END,
  '019df73d-a577-7117-abac-7607fc7017a2',
  '019df73d-a577-7117-abac-7607fc7017a2',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(5 + (i % 5)),
  _seed_ts(5 + (i % 5))
FROM generate_series(1, 25) AS i;

-- 30 CS_ENGAGED (Remote)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019df7f6-e6f0-7ca9-9b8f-8897e86d5d11', '019e1c67-f32a-7217-9ca3-7ee1df494eaf', '019e268d-ea25-7cef-aa6a-8fbc7246467f']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-624d757e07ce', '019e70b1-a705-7ba7-8dcd-6250a4804090', '019e70b5-897d-7e5d-915b-e3fca2360a27', '019e70b1-a705-7ba7-8dcd-624fec68c2c3', '019e70b5-897d-7e5d-915b-e3fb757364d7']::uuid[])[1 + (i % 5)],
  (ARRAY['019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b1-a705-7ba7-8dcd-6257f99a4507', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', '019e70b1-a705-7ba7-8dcd-62598a52e377', '019e70b1-a705-7ba7-8dcd-625a1d1abb0e']::uuid[])[1 + (i % 6)],
  'CS_ENGAGED',
  'Remote Customer R-E' || i,
  encode(sha256(('08091300' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08091300' || lpad(i::text, 3, '0'),
  (10 + i) || ' Wuse Rd, Abuja',
  'FCT',
  (ARRAY[30000.00, 59500.00, 60000.00, 30000.00]::numeric[])[1 + (i % 4)],
  (ARRAY[2500.00, 28000.00, 20000.00, 18000.00]::numeric[])[1 + (i % 4)],
  CASE (i % 4)
    WHEN 0 THEN '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    WHEN 2 THEN '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb
    ELSE '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb
  END,
  '019df73d-a577-7117-abac-7607fc7017a2',
  '019df73d-a577-7117-abac-7607fc7017a2',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(4 + (i % 6)),
  _seed_ts(5 + (i % 5))
FROM generate_series(1, 30) AS i;

-- 24 CONFIRMED (Remote)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, confirmed_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019df7f6-e6f0-7ca9-9b8f-8897e86d5d11', '019e1c67-f32a-7217-9ca3-7ee1df494eaf', '019e268d-ea25-7cef-aa6a-8fbc7246467f']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-624d757e07ce', '019e70b1-a705-7ba7-8dcd-6250a4804090', '019e70b5-897d-7e5d-915b-e3fca2360a27', '019e70b1-a705-7ba7-8dcd-624fec68c2c3', '019e70b5-897d-7e5d-915b-e3fb757364d7']::uuid[])[1 + (i % 5)],
  (ARRAY['019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b1-a705-7ba7-8dcd-6257f99a4507', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', '019e70b1-a705-7ba7-8dcd-62598a52e377', '019e70b1-a705-7ba7-8dcd-625a1d1abb0e']::uuid[])[1 + (i % 6)],
  'CONFIRMED',
  'Remote Customer R-C' || i,
  encode(sha256(('08091400' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08091400' || lpad(i::text, 3, '0'),
  (20 + i) || ' Garki Area, Abuja',
  'FCT',
  (ARRAY[30000.00, 59500.00, 60000.00, 30000.00]::numeric[])[1 + (i % 4)],
  (ARRAY[2500.00, 28000.00, 20000.00, 18000.00]::numeric[])[1 + (i % 4)],
  CASE (i % 4)
    WHEN 0 THEN '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    WHEN 2 THEN '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb
    ELSE '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb
  END,
  '019df73d-a577-7117-abac-7607fc7017a2',
  '019df73d-a577-7117-abac-7607fc7017a2',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(7 + (i % 3)),
  _seed_ts(3 + (i % 6)),
  _seed_ts(7 + (i % 3))
FROM generate_series(1, 24) AS i;

-- ============================================================
-- 3. ORDERS — Ibadan Branch (20 total)
-- Status: 0 UNPROCESSED, 7 CS_ASSIGNED, 9 CS_ENGAGED, 4 CONFIRMED, 0 DELETED
-- ============================================================

-- Ibadan MBs:
--   Ngozi:    019e70b1-a705-7ba7-8dcd-62521dcdf7fb
--   Gbenga:   019e70b5-897e-724d-a544-1996f91df0ad
--   Olayinka: 019e70b5-897d-7e5d-915b-e3fe3957ed07

-- Ibadan Campaigns:
--   Brahmi-Shakti: 019e0d70-6197-7fcd-a5b1-68c71b7048a3
--   Media Form:    019e0d72-15e4-7619-9036-58567fbb4731
--   SAMSON1:       019e0d54-b27a-7b14-9610-e65d651ceaf8

-- Ibadan CS (already in Ibadan branch):
--   Abiodun:    019e70b1-a705-7ba7-8dcd-625cc10e4003
--   Alexandra:  019e70ae-55c9-743e-bc11-a0eaa803cedc
--   Blessing:   019e70b1-a705-7ba7-8dcd-6256563a2390
--   Dare:       019e70b5-897e-724d-a544-19982b07bf5f

-- 7 CS_ASSIGNED (Ibadan)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019e0d70-6197-7fcd-a5b1-68c71b7048a3', '019e0d72-15e4-7619-9036-58567fbb4731', '019e0d54-b27a-7b14-9610-e65d651ceaf8']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-62521dcdf7fb', '019e70b5-897e-724d-a544-1996f91df0ad', '019e70b5-897d-7e5d-915b-e3fe3957ed07']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-625cc10e4003', '019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b5-897e-724d-a544-19982b07bf5f']::uuid[])[1 + (i % 4)],
  'CS_ASSIGNED',
  'Ibadan Customer I-A' || i,
  encode(sha256(('08071500' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08071500' || lpad(i::text, 3, '0'),
  i || ' Dugbe Rd, Ibadan',
  'Oyo',
  (ARRAY[30000.00, 59500.00, 60000.00]::numeric[])[1 + (i % 3)],
  (ARRAY[2500.00, 28000.00, 20000.00]::numeric[])[1 + (i % 3)],
  CASE (i % 3)
    WHEN 0 THEN '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    ELSE '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":2,"unitPrice":60000}]'::jsonb
  END,
  '019df3db-f659-7330-b2df-a7443b87b63c',
  '019df3db-f659-7330-b2df-a7443b87b63c',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(6 + (i % 4)),
  _seed_ts(6 + (i % 4))
FROM generate_series(1, 7) AS i;

-- 9 CS_ENGAGED (Ibadan)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019e0d70-6197-7fcd-a5b1-68c71b7048a3', '019e0d72-15e4-7619-9036-58567fbb4731', '019e0d54-b27a-7b14-9610-e65d651ceaf8']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-62521dcdf7fb', '019e70b5-897e-724d-a544-1996f91df0ad', '019e70b5-897d-7e5d-915b-e3fe3957ed07']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-625cc10e4003', '019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b5-897e-724d-a544-19982b07bf5f']::uuid[])[1 + (i % 4)],
  'CS_ENGAGED',
  'Ibadan Customer I-E' || i,
  encode(sha256(('08071600' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08071600' || lpad(i::text, 3, '0'),
  (10 + i) || ' Ring Rd, Ibadan',
  'Oyo',
  (ARRAY[30000.00, 59500.00, 60000.00, 30000.00]::numeric[])[1 + (i % 4)],
  (ARRAY[2500.00, 28000.00, 20000.00, 18000.00]::numeric[])[1 + (i % 4)],
  CASE (i % 4)
    WHEN 0 THEN '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    WHEN 2 THEN '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":2,"unitPrice":60000}]'::jsonb
    ELSE '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb
  END,
  '019df3db-f659-7330-b2df-a7443b87b63c',
  '019df3db-f659-7330-b2df-a7443b87b63c',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(5 + (i % 5)),
  _seed_ts(6 + (i % 4))
FROM generate_series(1, 9) AS i;

-- 4 CONFIRMED (Ibadan)
INSERT INTO orders (id, campaign_id, media_buyer_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, payment_method, confirmed_at, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019e0d70-6197-7fcd-a5b1-68c71b7048a3', '019e0d72-15e4-7619-9036-58567fbb4731', '019e0d54-b27a-7b14-9610-e65d651ceaf8']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-62521dcdf7fb', '019e70b5-897e-724d-a544-1996f91df0ad', '019e70b5-897d-7e5d-915b-e3fe3957ed07']::uuid[])[1 + (i % 3)],
  (ARRAY['019e70b1-a705-7ba7-8dcd-625cc10e4003', '019e70ae-55c9-743e-bc11-a0eaa803cedc', '019e70b1-a705-7ba7-8dcd-6256563a2390', '019e70b5-897e-724d-a544-19982b07bf5f']::uuid[])[1 + (i % 4)],
  'CONFIRMED',
  'Ibadan Customer I-C' || i,
  encode(sha256(('08071700' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08071700' || lpad(i::text, 3, '0'),
  (20 + i) || ' UI Rd, Ibadan',
  'Oyo',
  (ARRAY[30000.00, 59500.00, 60000.00]::numeric[])[1 + (i % 3)],
  (ARRAY[2500.00, 28000.00, 20000.00]::numeric[])[1 + (i % 3)],
  CASE (i % 3)
    WHEN 0 THEN '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    ELSE '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb
  END,
  '019df3db-f659-7330-b2df-a7443b87b63c',
  '019df3db-f659-7330-b2df-a7443b87b63c',
  'edge-form', 'PAY_ON_DELIVERY',
  _seed_ts(8 + (i % 2)),
  _seed_ts(4 + (i % 5)),
  _seed_ts(8 + (i % 2))
FROM generate_series(1, 4) AS i;

-- ============================================================
-- 4. FOLLOW-UP ORDERS (14 total)
-- Status: 10 UNPROCESSED, 3 CS_ENGAGED, 1 CONFIRMED
-- Spread across Lagos + Remote
-- ============================================================

-- Pick an existing source order for the FK (use any old order)
-- We'll use NULL for source_order_id since it's optional

-- 10 UNPROCESSED follow-ups
INSERT INTO follow_up_orders (id, follow_up_rule_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, created_at, updated_at)
SELECT
  gen_random_uuid(),
  (ARRAY['019eb73e-d5a6-7de2-9441-57999f1bb8d9', '019eb811-9861-7074-981c-c5479559cf92']::uuid[])[1 + (i % 2)],
  'UNPROCESSED',
  'FollowUp Customer FU-U' || i,
  encode(sha256(('08081800' || lpad(i::text, 3, '0'))::bytea), 'hex'),
  '08081800' || lpad(i::text, 3, '0'),
  i || ' Follow-Up St',
  CASE WHEN i <= 5 THEN 'Lagos' ELSE 'FCT' END,
  (ARRAY[30000.00, 59500.00, 60000.00]::numeric[])[1 + (i % 3)],
  (ARRAY[2500.00, 28000.00, 20000.00]::numeric[])[1 + (i % 3)],
  CASE (i % 3)
    WHEN 0 THEN '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb
    WHEN 1 THEN '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb
    ELSE '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb
  END,
  CASE WHEN i <= 5 THEN '00000000-0000-0000-0000-000000000001'::uuid ELSE '019df73d-a577-7117-abac-7607fc7017a2'::uuid END,
  CASE WHEN i <= 5 THEN '00000000-0000-0000-0000-000000000001'::uuid ELSE '019df73d-a577-7117-abac-7607fc7017a2'::uuid END,
  'offline',
  _seed_ts(5 + (i % 5)),
  _seed_ts(5 + (i % 5))
FROM generate_series(1, 10) AS i;

-- 3 CS_ENGAGED follow-ups
INSERT INTO follow_up_orders (id, follow_up_rule_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019eb73e-d5a6-7de2-9441-57999f1bb8d9', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'FollowUp Engaged 1', encode(sha256('08081900001'::bytea), 'hex'), '08081900001', '11 FU Lane', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019eb811-9861-7074-981c-c5479559cf92', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'FollowUp Engaged 2', encode(sha256('08081900002'::bytea), 'hex'), '08081900002', '22 FU Lane', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(6), _seed_ts(8)),
  (gen_random_uuid(), '019eb73e-d5a6-7de2-9441-57999f1bb8d9', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'FollowUp Engaged 3', encode(sha256('08081900003'::bytea), 'hex'), '08081900003', '33 FU Lane', 'FCT', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '019df73d-a577-7117-abac-7607fc7017a2', '019df73d-a577-7117-abac-7607fc7017a2', 'offline', _seed_ts(7), _seed_ts(8));

-- 1 CONFIRMED follow-up
INSERT INTO follow_up_orders (id, follow_up_rule_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, confirmed_at, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019eb73e-d5a6-7de2-9441-57999f1bb8d9', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CONFIRMED', 'FollowUp Confirmed 1', encode(sha256('08082000001'::bytea), 'hex'), '08082000001', '44 FU Confirmed Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(9), _seed_ts(5), _seed_ts(9));

-- ============================================================
-- 5. CART ORDERS (14 total)
-- Status: 5 UNPROCESSED, 9 CS_ENGAGED
-- Need source_cart_id FK to cart_abandonments
-- ============================================================

-- Use existing cart_abandonment IDs
-- 5 UNPROCESSED cart orders
INSERT INTO cart_orders (id, source_cart_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e6504-661e-76e4-8905-d57baeff480d', 'UNPROCESSED', 'Cart Customer CU-1', encode(sha256('08082100001'::bytea), 'hex'), '08082100001', '1 Cart St, Lagos', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(5), _seed_ts(5)),
  (gen_random_uuid(), '019e64a9-9b96-7fd8-b7b8-5e453c9f394d', 'UNPROCESSED', 'Cart Customer CU-2', encode(sha256('08082100002'::bytea), 'hex'), '08082100002', '2 Cart St, Lagos', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(6), _seed_ts(6)),
  (gen_random_uuid(), '019e64a6-812c-7c80-ba2b-62f5c52f1b4f', 'UNPROCESSED', 'Cart Customer CU-3', encode(sha256('08082100003'::bytea), 'hex'), '08082100003', '3 Cart Rd, Abuja', 'FCT', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '019df73d-a577-7117-abac-7607fc7017a2', '019df73d-a577-7117-abac-7607fc7017a2', 'offline', _seed_ts(6), _seed_ts(6)),
  (gen_random_uuid(), '019e63ee-8e11-7411-ad47-b820a02e4fed', 'UNPROCESSED', 'Cart Customer CU-4', encode(sha256('08082100004'::bytea), 'hex'), '08082100004', '4 Cart Rd, Ibadan', 'Oyo', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '019df3db-f659-7330-b2df-a7443b87b63c', '019df3db-f659-7330-b2df-a7443b87b63c', 'offline', _seed_ts(7), _seed_ts(7)),
  (gen_random_uuid(), '019e63ed-4ce9-7564-b2e8-e39fd67e4f92', 'UNPROCESSED', 'Cart Customer CU-5', encode(sha256('08082100005'::bytea), 'hex'), '08082100005', '5 Cart Rd, Ibadan', 'Oyo', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '019df3db-f659-7330-b2df-a7443b87b63c', '019df3db-f659-7330-b2df-a7443b87b63c', 'offline', _seed_ts(7), _seed_ts(7));

-- 9 CS_ENGAGED cart orders
INSERT INTO cart_orders (id, source_cart_id, assigned_cs_id, status, customer_name, customer_phone_hash, customer_phone, customer_address, delivery_state, total_amount, landed_cost, items, branch_id, servicing_branch_id, order_source, created_at, updated_at)
VALUES
  (gen_random_uuid(), '019e63ec-dcae-70ac-8fc7-270678b39889', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Cart Engaged CE-1', encode(sha256('08082200001'::bytea), 'hex'), '08082200001', '10 Cart Engaged Rd', 'Lagos', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(5), _seed_ts(6)),
  (gen_random_uuid(), '019e63aa-ccd0-773c-afde-450b41014343', '019e70b1-a705-7ba7-8dcd-6256563a2390', 'CS_ENGAGED', 'Cart Engaged CE-2', encode(sha256('08082200002'::bytea), 'hex'), '08082200002', '11 Cart Engaged Rd', 'Lagos', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(5), _seed_ts(6)),
  (gen_random_uuid(), '019e63a6-eed7-7d77-82c5-22d8dc68158e', '019e70b1-a705-7ba7-8dcd-6257f99a4507', 'CS_ENGAGED', 'Cart Engaged CE-3', encode(sha256('08082200003'::bytea), 'hex'), '08082200003', '12 Cart Engaged Rd', 'FCT', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '019df73d-a577-7117-abac-7607fc7017a2', '019df73d-a577-7117-abac-7607fc7017a2', 'offline', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019e63a6-7ef9-7a1d-8436-23f801105eb6', '019e70b1-a705-7ba7-8dcd-6258a3bbf547', 'CS_ENGAGED', 'Cart Engaged CE-4', encode(sha256('08082200004'::bytea), 'hex'), '08082200004', '13 Cart Engaged Rd', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(6), _seed_ts(7)),
  (gen_random_uuid(), '019e63a6-6400-7cc0-bba4-5809f48164a5', '019e70b1-a705-7ba7-8dcd-62598a52e377', 'CS_ENGAGED', 'Cart Engaged CE-5', encode(sha256('08082200005'::bytea), 'hex'), '08082200005', '14 Cart Engaged Rd', 'FCT', 30000.00, 2500.00, '[{"productId":"019de9cd-da69-756b-a0f8-2c9f33706bd6","quantity":1,"unitPrice":30000}]'::jsonb, '019df73d-a577-7117-abac-7607fc7017a2', '019df73d-a577-7117-abac-7607fc7017a2', 'offline', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e63a6-0851-7506-8dcd-58eb82056a1b', '019e70b1-a705-7ba7-8dcd-625a1d1abb0e', 'CS_ENGAGED', 'Cart Engaged CE-6', encode(sha256('08082200006'::bytea), 'hex'), '08082200006', '15 Cart Engaged Rd', 'Oyo', 59500.00, 28000.00, '[{"productId":"019e70ae-55ca-72ac-8cc3-4cbcdbbd742a","quantity":1,"unitPrice":59500}]'::jsonb, '019df3db-f659-7330-b2df-a7443b87b63c', '019df3db-f659-7330-b2df-a7443b87b63c', 'offline', _seed_ts(7), _seed_ts(8)),
  (gen_random_uuid(), '019e5eae-8f1c-7c96-b227-504beddbca50', '019e70b1-a705-7ba7-8dcd-625cc10e4003', 'CS_ENGAGED', 'Cart Engaged CE-7', encode(sha256('08082200007'::bytea), 'hex'), '08082200007', '16 Cart Engaged Rd', 'Oyo', 30000.00, 2500.00, '[{"productId":"019de620-e63a-7607-9cb0-2b32d3561e77","quantity":1,"unitPrice":30000}]'::jsonb, '019df3db-f659-7330-b2df-a7443b87b63c', '019df3db-f659-7330-b2df-a7443b87b63c', 'offline', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e5eae-8e44-7b22-bcb9-ffb19d406158', '019e70b5-897e-724d-a544-19982b07bf5f', 'CS_ENGAGED', 'Cart Engaged CE-8', encode(sha256('08082200008'::bytea), 'hex'), '08082200008', '17 Cart Engaged Rd', 'Oyo', 60000.00, 20000.00, '[{"productId":"019e0cf7-0b5b-7fd0-b6f6-9b1348bb2046","quantity":2,"unitPrice":60000}]'::jsonb, '019df3db-f659-7330-b2df-a7443b87b63c', '019df3db-f659-7330-b2df-a7443b87b63c', 'offline', _seed_ts(8), _seed_ts(9)),
  (gen_random_uuid(), '019e5eae-441e-7a45-9d3a-b3b0275e9345', '019e70ae-55c9-743e-bc11-a0eaa803cedc', 'CS_ENGAGED', 'Cart Engaged CE-9', encode(sha256('08082200009'::bytea), 'hex'), '08082200009', '18 Cart Engaged Rd', 'Lagos', 30000.00, 18000.00, '[{"productId":"019e16b4-54ab-79fa-bc8c-e209ad9984d7","quantity":1,"unitPrice":30000}]'::jsonb, '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'offline', _seed_ts(8), _seed_ts(9));

-- ============================================================
-- Cleanup helper function
-- ============================================================
DROP FUNCTION IF EXISTS _seed_ts(int);

COMMIT;
