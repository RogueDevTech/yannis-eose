-- Seed ad_spend_logs for today for a specific company (branch_group).
-- Usage:  psql "$DATABASE_URL" -f seed-expenses-today.sql
-- Or via the companion TS script.
--
-- Resolves MBs, campaigns, and products from the target company's branches
-- then inserts ~15 PENDING expenses so the bulk-approve flow can be tested.

DO $$
DECLARE
  v_company_id UUID := '833a1030-292c-4988-9c3f-6bd8450b8635';
  v_today      DATE := CURRENT_DATE;
  v_mb         RECORD;
  v_camp       RECORD;
  v_prod       RECORD;
  v_branch_ids UUID[];
  v_mb_ids     UUID[];
  v_camp_rows  RECORD[];
  v_inserted   INT := 0;
  v_amount     NUMERIC;
  v_platform   TEXT;
  v_platforms   TEXT[] := ARRAY['FACEBOOK','TIKTOK','GOOGLE','FACEBOOK','FACEBOOK'];
BEGIN
  -- 1. Resolve branches for this company
  SELECT array_agg(id) INTO v_branch_ids
  FROM branches
  WHERE group_id = v_company_id AND status = 'ACTIVE';

  IF v_branch_ids IS NULL OR array_length(v_branch_ids, 1) = 0 THEN
    RAISE NOTICE 'No active branches found for company %. Aborting.', v_company_id;
    RETURN;
  END IF;

  RAISE NOTICE 'Found % branches for company', array_length(v_branch_ids, 1);

  -- 2. Set actor for audit triggers
  PERFORM set_config('yannis.current_user_id', '00000000-0000-0000-0000-000000000000', true);

  -- 3. Insert expenses by iterating media buyers with campaigns in this company
  FOR v_camp IN
    SELECT c.id AS campaign_id, c.media_buyer_id, c.name AS campaign_name, c.branch_id,
           (SELECT p.id FROM products p WHERE p.id = ANY(
             CASE WHEN jsonb_typeof(c.product_ids) = 'array'
               THEN ARRAY(SELECT jsonb_array_elements_text(c.product_ids))::uuid[]
               ELSE ARRAY[]::uuid[]
             END
           ) LIMIT 1) AS product_id
    FROM campaigns c
    WHERE c.branch_id = ANY(v_branch_ids)
      AND c.status = 'ACTIVE'
    ORDER BY random()
    LIMIT 15
  LOOP
    -- Vary amount between 5000 and 80000
    v_amount := 5000 + floor(random() * 75000);
    v_platform := v_platforms[1 + (v_inserted % array_length(v_platforms, 1))];

    INSERT INTO ad_spend_logs (
      id, media_buyer_id, product_id, campaign_id,
      spend_amount, screenshot_url, ad_url, platform, category,
      spend_date, status, created_at
    ) VALUES (
      gen_random_uuid(),
      v_camp.media_buyer_id,
      v_camp.product_id,
      v_camp.campaign_id,
      v_amount::numeric(12,2),
      'https://storage.example.com/screenshots/test-expense-' || v_inserted || '.jpg',
      'https://facebook.com/ads/test-' || v_inserted,
      v_platform::ad_platform,
      'AD_SPEND'::expense_category,
      v_today::timestamp with time zone,
      'PENDING',
      NOW()
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  -- 4. Also add a couple of non-AD_SPEND expenses (OTHER categories)
  IF v_branch_ids IS NOT NULL AND array_length(v_branch_ids, 1) > 0 THEN
    -- Find any MB in these branches
    SELECT u.id INTO v_mb
    FROM users u
    JOIN user_branch_assignments uba ON uba.user_id = u.id
    WHERE uba.branch_id = ANY(v_branch_ids)
      AND u.role = 'MEDIA_BUYER'
      AND u.status = 'ACTIVE'
    LIMIT 1;

    IF v_mb.id IS NOT NULL THEN
      INSERT INTO ad_spend_logs (
        id, media_buyer_id, spend_amount, screenshot_url, platform, category, description,
        spend_date, status, created_at
      ) VALUES
      (
        gen_random_uuid(), v_mb.id, 12000,
        'https://storage.example.com/screenshots/test-whatsapp.jpg',
        'OTHER', 'WHATSAPP_CAMPAIGN', 'WhatsApp broadcast for June promo',
        v_today::timestamp with time zone, 'PENDING', NOW()
      ),
      (
        gen_random_uuid(), v_mb.id, 25000,
        'https://storage.example.com/screenshots/test-recruitment.jpg',
        'FACEBOOK', 'RECRUITMENT_AD', 'Recruitment ad for new closers',
        v_today::timestamp with time zone, 'PENDING', NOW()
      ),
      (
        gen_random_uuid(), v_mb.id, 8500,
        'https://storage.example.com/screenshots/test-ugc.jpg',
        'OTHER', 'UGC_PRODUCTION', 'UGC video production for skincare line',
        v_today::timestamp with time zone, 'PENDING', NOW()
      );

      v_inserted := v_inserted + 3;
    END IF;
  END IF;

  RAISE NOTICE 'Inserted % PENDING expense entries for %', v_inserted, v_today;
END $$;
