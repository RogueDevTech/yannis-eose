# Mobile Card And Table Actions Design

## Goal

Make action buttons feel larger and easier to tap on mobile for:

- card/list item actions
- mobile row/table actions

Do not change header-sheet tools or desktop table density.

## Scope

- Shared `TableActionButton`
- Shared `CompactTableActionButton`
- Mobile `btn-sm` buttons that appear inside `.card` surfaces

## Recommended Approach

Apply the mobile treatment in shared primitives instead of patching each page:

- increase tap target and text size on mobile only
- keep desktop compact sizing unchanged from `md` upward
- keep header tool buttons unchanged by scoping the raw `btn-sm` boost to `.card`

## Why

- Covers most mobile list/card actions with a few shared edits
- Preserves compact desktop tables
- Avoids touching header controls the user did not ask to change
- Reduces page-by-page drift

## Validation

- Mobile card/list actions are visibly larger and easier to tap
- Mobile row/table actions are larger in card/table mobile surfaces
- Desktop action buttons remain compact
- Header tool buttons do not grow
