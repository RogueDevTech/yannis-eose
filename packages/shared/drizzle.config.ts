import { config } from 'dotenv';
import { resolve } from 'path';
import { defineConfig } from 'drizzle-kit';

// Only load .env file if DATABASE_URL is not already set (e.g., in CI it's injected directly)
if (!process.env['DATABASE_URL'] && !process.env['TEST_DATABASE_URL']) {
  config({ path: resolve(__dirname, '../../.env') });
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: (process.env['TEST_DATABASE_URL'] ?? process.env['DATABASE_URL'])!,
  },
});
