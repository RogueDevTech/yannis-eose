/**
 * Canonical sticky-table-header classes for HAND-ROLLED `<table>` markup.
 *
 * `CompactTable` already pins its own header (its `stickyHeader` prop, on by
 * default). This constant exists so the tables that predate it — or that can't
 * use it — pin identically instead of each re-deriving the offset, z-index and
 * divider.
 *
 * How the offset works: the header sticks at
 * `top: var(--table-sticky-top, var(--header-height))`, i.e. just below the
 * fixed app topbar when the PAGE is the scroll container. Any context that
 * scrolls internally (a `<Modal>` body sets `--table-sticky-top: 0px`) pins the
 * header flush to that container's top instead of 56px down.
 *
 * REQUIREMENT — the table must not sit inside its own scroll container. An
 * ancestor with `overflow-x-auto` / `overflow-y-auto` / `overflow-hidden`
 * (note: `overflow-x-auto` computes `overflow-y: auto` too, per the CSS spec)
 * becomes the containing block for `position: sticky`, so the header pins to
 * that box and scrolls out of view with it. Either drop the wrapper and let the
 * page scroll, or give the wrapper a `max-h-*` so it is a deliberate internal
 * scroller and the header pins to its top.
 *
 * The background is set on the CELLS, not the `<thead>`: a `<thead>` background
 * does not paint over sticky-positioned children in every engine, so rows would
 * show through the gaps between cells while scrolling underneath.
 */
export const STICKY_TABLE_HEADER_CELL_CLASS =
  'sticky top-[var(--table-sticky-top,var(--header-height))] z-20 bg-app-elevated shadow-[inset_0_-1px_0_0_rgb(var(--app-border))]';

/**
 * Variant for a header cell sitting on the `bg-app-hover` tone (skeleton shells
 * and a few toolbars use that instead of `bg-app-elevated`). Same geometry, so
 * the loading state pins exactly where the loaded state will.
 */
export const STICKY_TABLE_HEADER_CELL_HOVER_CLASS =
  'sticky top-[var(--table-sticky-top,var(--header-height))] z-20 bg-app-hover shadow-[inset_0_-1px_0_0_rgb(var(--app-border))]';
