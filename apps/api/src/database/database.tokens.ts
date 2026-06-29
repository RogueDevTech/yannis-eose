export const DRIZZLE = Symbol('DRIZZLE');
export const PG_CLIENT = Symbol('PG_CLIENT');
/** Raw postgres.js client — never wrapped by timing proxy.
 *  Use for queries that MUST use simple protocol (e.g. INSERT on tables
 *  with stamp_actor triggers). */
export const PG_CLIENT_RAW = Symbol('PG_CLIENT_RAW');
export const REDIS = Symbol('REDIS');
