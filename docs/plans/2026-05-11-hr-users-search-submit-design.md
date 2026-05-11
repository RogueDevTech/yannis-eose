# HR Users Search Submit Design

## Goal

Stop `/hr/users` from searching while the user is still typing. Search should run only when the user explicitly submits.

## Approved Direction

Use explicit submit-based search.

- Keep a local draft value for the search box.
- Remove debounced URL updates on every keystroke.
- Run search only on button click or Enter.
- Show the action button only when there is search text to apply or an existing search to clear.

## Interaction

1. User types in the search field.
2. No server reload happens while typing.
3. A button appears beside the field.
4. Pressing the button or Enter applies the search to the URL and resets pagination to page 1.
5. Clearing the field and submitting removes the `search` param while preserving other filters.

## Data / Behavior

- Preserve `status`, `role`, `probationOnly`, `supervisorOnly`, and page-size params.
- Reset `page` to `1` on search submit.
- Keep status and role selects as apply-on-change.

## Verification

- Typing alone should not trigger loader revalidation.
- Enter should submit the search.
- Clicking the button should submit the search.
- Clearing the field and submitting should clear the search filter.
