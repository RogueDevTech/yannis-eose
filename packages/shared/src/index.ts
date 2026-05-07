// ============================================
// Yannis EOSE — Shared Package Barrel Export
// ============================================

export * from './enums/index';
export * from './validators/index';
export * from './hr/commission-calc';
export * from './notifications/config';
export * from './rbac/permission-codes';
export * from './rbac/permission-catalog';
export * from './rbac/permission-snapshot-merge';
export * from './messaging/template-catalog';
export { DEFAULT_CAMPAIGN_FORM_ACCENT_HEX } from './marketing/default-form-accent';
export * as db from './db/index';
// `runSqlMigrations` is server-only (uses node:fs / node:path). Re-exporting it
// from the public barrel pulls Node built-ins into Vite's web bundle and breaks
// the production build with "readFileSync is not exported by __vite-browser-external".
// Server consumers (the API's MigrationRunnerService, the migrate CLI) should
// import from the dedicated subpath instead:
//   import { runSqlMigrations } from '@yannis/shared/migrations';
