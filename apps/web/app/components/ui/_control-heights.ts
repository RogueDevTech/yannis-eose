/**
 * Canonical height for interactive form / filter / toolbar controls.
 *
 * Mobile-first: 40px on small screens (tap-target friendly, parity with
 * MobileDateFilterRow) → 36px at md+ (matches the long-standing form-input
 * default). Apply to: SearchInput, TextInput, FormSelect, SearchableSelect,
 * DateInput, AmountInput, NumberInput, FilterPills, Pagination buttons, the
 * inline DateFilterBar chrome, ToolbarFiltersCollapsible "Filters" trigger,
 * ActionDropdown triggers, and the standard Button.
 *
 * Excluded: badges/chips (StatusBadge / RoleBadge / CountPill — content
 * tags), Checkbox / RadioGroup dots (intentionally smaller), and
 * TableActionButton / CompactTable row actions (table density rule).
 */
export const CONTROL_HEIGHT_CLASS = 'h-10 md:h-9';

/**
 * Same shape as `CONTROL_HEIGHT_CLASS` but as a `min-h-` pair, for chrome
 * wrappers that need a minimum height instead of a fixed one (e.g. the
 * DateFilterBar inline pill chrome where the trigger sets its own height).
 */
export const CONTROL_MIN_HEIGHT_CLASS = 'min-h-[2.5rem] md:min-h-[2.25rem]';
