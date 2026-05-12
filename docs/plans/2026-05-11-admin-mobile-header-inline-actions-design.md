# Admin Mobile Header Inline Actions Design

## Goal

On mobile, compact admin headers should keep refresh and more-actions controls on the top-right beside the page title instead of stacking them underneath.

## Scope

- Apply to admin pages that already use compact mobile header controls:
  - `PageHeaderMobileTools`
  - icon-only refresh patterns
- Keep the current stacked mobile layout as the default for wider or more crowded action groups.

## Recommended Approach

Add an opt-in `PageHeader` prop for compact mobile action placement. When enabled:

- the title and mobile actions share the first row
- the description stays below on its own row
- desktop layout remains unchanged

Pages that already collapse their mobile actions into a refresh icon or `refresh + kebab` should enable this prop, including matching loading shells.

## Why This Approach

- Avoids risky global layout changes
- Preserves readability on pages with larger action groups
- Keeps `/admin` and similar admin pages visually consistent
- Reuses the shared header instead of introducing page-specific hacks

## Validation

- Mobile: title stays left, refresh / more-actions stay top-right
- Description wraps below without pushing actions to a second row
- Desktop: no visible layout regression
