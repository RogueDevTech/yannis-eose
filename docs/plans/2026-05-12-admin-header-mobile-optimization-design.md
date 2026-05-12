# Admin Header Mobile Optimization Design

## Goal

Normalize page-header UX for all admin pages from the `LOGISTICS` sidebar group downward.

## Scope

Included groups:

- `LOGISTICS`
- `Finance`
- `Stock Management`
- `Catalog`
- `HR`
- `Config`
- `Analytics`

Included page types:

- top-level pages
- nested list/index pages
- detail pages
- reused pages mounted under those groups
- matching loading shells

## Header Standard

Apply these rules everywhere in scope unless a page has a custom hero that needs to preserve stronger context:

1. Shorten header descriptions to one direct sentence.
2. Use `PageHeader` with `mobileInlineActions` where the page has multiple header actions or header-level filters.
3. Use `PageHeaderMobileTools` for mobile action collapse.
4. Keep desktop actions visible inline.
5. On mobile, rely on icon refresh plus kebab sheet rather than a row of full buttons.
6. Group header-level filters/actions in the same chrome pattern used by the newer marketing pages.
7. Mirror the same header structure in the loading shell.

## Rollout Buckets

### Bucket 1: Full header normalization

High-impact pages that still have crowded or inconsistent headers:

- `apps/web/app/features/logistics/LogisticsPage.tsx`
- `apps/web/app/features/remittances/RemittancesAdminPage.tsx`
- `apps/web/app/features/disbursements/DisbursementsPage.tsx`
- `apps/web/app/features/finance/FinancePayoutPage.tsx`
- `apps/web/app/routes/admin.shipments._index/route.tsx`
- `apps/web/app/features/inventory/ShipmentDetailPage.tsx`
- `apps/web/app/routes/admin.inventory.warehouses.$id/route.tsx`
- `apps/web/app/routes/admin.products._index/route.tsx`
- `apps/web/app/features/categories/CategoriesPage.tsx`
- `apps/web/app/features/hr/HRPage.tsx`
- `apps/web/app/features/hr/CommissionPlansPage.tsx`
- `apps/web/app/features/settings/RoleTemplatesPage.tsx`
- `apps/web/app/routes/admin.branches._index/route.tsx`

### Bucket 2: Shared/custom detail headers

Pages with custom hero or reused detail surfaces:

- `apps/web/app/features/users/UserDetailPage.tsx`
- `apps/web/app/routes/admin.notifications/route.tsx`
- `apps/web/app/routes/admin.branches.$branchId/route.tsx`
- `apps/web/app/features/logistics/LogisticsOrderDetailPage.tsx`
- `apps/web/app/features/products/ProductViewPage.tsx`
- `apps/web/app/routes/admin.inventory_.$id/route.tsx`

### Bucket 3: Lighter cleanup

Pages that mainly need shorter copy or light mobile action cleanup:

- import pages
- simple create/edit/detail pages with back/refresh
- onboarding/supporting pages with minimal actions

## Behavior Rules

### Bucket 1

- Convert to `PageHeader` + `mobileInlineActions` + `PageHeaderMobileTools`.
- Shorten the description.
- Keep desktop actions unchanged where possible.
- Put primary mobile actions in the tools sheet.
- Wrap header-level filter controls in grouped chrome.

### Bucket 2

- Preserve custom hero identity.
- Normalize only the action area and mobile behavior.
- Do not flatten useful detail context into a generic header.

### Bucket 3

- Shorten descriptions first.
- Add mobile tools only where the current header crowds or wraps.
- Leave truly simple back-only pages mostly intact.

## Verification

- Update corresponding loading shells for any page whose live header changes.
- Run lints on all touched files.
- Prefer low-risk header-only edits over body/layout refactors.
