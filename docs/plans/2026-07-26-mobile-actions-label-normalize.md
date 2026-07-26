# Plan: Normalize Action Group Labels (`+` prefixes)

Date: 2026-07-26

## Goal

Make toolbar / mobile Actions sheet labels consistent with the Marketing Orders standard:

- Sheet CTAs: secondary (already done)
- Labels: no decorative leading `+`
- Blue primary reserved for sheet **Close** (and desktop primary CTAs when needed)

## Rule

In `PageHeaderMobileTools` `desktop` and `sheet` content only:

| Before | After |
|---|---|
| `+ Add-on` | `Add-on` |
| `+ New Branch` | `New Branch` |
| `+ Generate Monthly Batch` | `Generate Monthly Batch` |
| `+Create offer` | `Create offer` |

Do **not** change:

- Form/modal submit buttons outside the tools sheet
- Table row actions
- Labels that use `+` as math / increment semantics (none expected here)

## Scope (scanned)

Live pages with `+` labels in desktop and/or sheet:

- HR: `HRPage`, `PayrollConfigRolesPage`, `PayrollContractorsPage`
- Finance: `DisbursementsPage`, `ExpenseSubmissionsPage`, `AssetRegisterPage`
- Logistics: `LogisticsPage`
- Marketing: `MarketingAdSpendPage`
- Campaigns: `CampaignsPage`
- Orders: `OrdersListPage`
- Branches: `admin.branches._index`, `admin.branches.$branchId`, branch-groups routes
- Products: `admin.products._index`
- CS: `admin.sales.message-templates`

Matching deferred loading shells that still show `+` on desktop placeholders.

## Steps

1. Strip leading `+` / `+ ` from labels in `desktop` + `sheet` for the files above
2. Re-scan for remaining `>+` text nodes inside `PageHeaderMobileTools` blocks
3. Spot-check one HR + one Finance + one Logistics page on mobile Actions sheet

## Done when

- Zero decorative `+Label` / `+ Label` text nodes remain in `PageHeaderMobileTools` desktop/sheet
- Desktop can still use `variant="primary"` for main CTAs; labels match sheet wording

## Status

Completed 2026-07-26. Verification scan: 0 remaining decorative `+` prefixes in `PageHeaderMobileTools` desktop/sheet.
