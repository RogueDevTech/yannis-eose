# User Profile Header Design

## Goal

Improve the profile header on `hr/users/:id` so the user's identity reads immediately and feels deliberate. The current header looks like a plain banner plus a separate content block, which weakens the profile-page feel.

## Approved Direction

Executive hero, name-focused.

- The blue area becomes a real hero section rather than a flat strip.
- The user's name is the single primary headline inside the hero.
- Supporting details stay below the hero so the banner does not become crowded.

## Layout

1. Use a taller branded hero with richer visual depth.
2. Keep the avatar overlapping the lower edge of the hero.
3. Move the name fully into the hero.
4. Keep email, role/status chips, and actions in the lower white section.
5. Preserve the existing page actions and quick-info content, but improve spacing so the header feels like one composed unit.

## Visual Rules

- Favor strong typography over adding more metadata to the banner.
- Add subtle depth to the hero with a gradient and restrained overlay treatment.
- Keep the lower section readable and admin-oriented; do not turn the page into a marketing-style profile.
- Maintain existing components for badges, actions, and branch indicators.

## Data / Behavior

No loader or API changes.

- This is a presentational update only.
- Existing actions like refresh, mirror, edit, reset password, deactivate/reactivate remain unchanged.

## Verification

- Check the hero on the specific requested profile page.
- Confirm the name is fully readable on desktop and mobile widths.
- Confirm avatar overlap, actions, and chips still align cleanly.
- Run lints for the edited file.
