# Mobile Tabs Horizontal Scroll Design

## Goal

Make shared mobile tabs work correctly when the tab list overflows horizontally.

## Problem

The shared `Tabs` component needs to stay horizontally swipe-scrollable on mobile even when rendered inside constrained flex layouts. On pages like `admin/marketing/ad-spend`, the tab row was sizing to content rather than the available width, so overflow scrolling did not activate reliably.

## Approach

Implement the fix once in `apps/web/app/components/ui/tabs.tsx` so every mobile tabs instance inherits it automatically.

- Keep horizontal swipe scrolling on mobile for shared tabs.
- Ensure the shared tabs root uses constrained width semantics so overflow can occur inside flex wrappers.
- Leave desktop behavior unchanged.

## Scope

- Applies to shared mobile `underline` tabs.
- Applies to shared mobile `pill` tabs.
- No one-off page logic.

## Validation

- Mobile tabs remain swipe-scrollable.
- Overflowing tab lists can be reached with horizontal swipe.
- Desktop layout remains unchanged.
