-- Migration 0356: campaign_views.host_domain (2026-10-15).
--
-- The website the form was shown on. For an iframe the view beacon's Referer
-- is the iframe's own URL, so until now there was no way to tell WHOSE landing
-- page a form was loaded on (Oct 15 dispute: Shola's form on another media
-- buyer's page). The form now sends the host page's hostname only (no path, no
-- query, so nothing a customer typed): embedded = the page itself, iframe = the
-- parent page (location.ancestorOrigins / document.referrer), hosted = the page
-- that sent the visitor. Telemetry like the rest of campaign_views: no history twin.

ALTER TABLE campaign_views ADD COLUMN IF NOT EXISTS host_domain text;
CREATE INDEX IF NOT EXISTS campaign_views_host_domain_viewed_idx
  ON campaign_views (host_domain, viewed_at) WHERE host_domain IS NOT NULL;
