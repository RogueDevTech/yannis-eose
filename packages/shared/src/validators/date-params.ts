import { z } from 'zod';

/**
 * A date filter param that accepts EITHER a bare calendar date (`YYYY-MM-DD`) OR a
 * full datetime with offset (`YYYY-MM-DDTHH:MM:SS+01:00`).
 *
 * The backend's nigeriaDayStart/nigeriaDayEnd helpers already pass any `T`-bearing
 * string through verbatim (honoring the offset) and snap bare dates to WAT
 * day-bounds — so accepting datetimes here lets the Compare feature (and any other
 * caller) send a precise sub-day time window without changing the service layer.
 *
 * Use this in place of `z.string().date()` on any date-range tRPC input that should
 * also accept a time-of-day window. `{ offset: true }` is required so `+01:00`
 * (WAT) is accepted, not only UTC `Z`.
 */
export const dateOrDateTime = z.union([
  z.string().date(),
  z.string().datetime({ offset: true }),
]);

export const dateOrDateTimeOptional = dateOrDateTime.optional();
