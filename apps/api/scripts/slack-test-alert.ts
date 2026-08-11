import { existsSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

for (const envPath of [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '..', '.env'),
  resolve(process.cwd(), 'apps/api/.env'),
]) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
  }
}

async function main(): Promise<void> {
  const { SlackService } = await import('../src/common/slack/slack.service');
  const { apiErrorTemplate } = await import('../src/common/slack/templates/api-error.template');
  const { YANNIS_EOSE_CHANNEL } = await import('../src/common/slack/slack-channels');

  const hasToken = Boolean(process.env['SLACK_BOT_TOKEN']);
  const enabledRaw = process.env['SLACK_ALERTS_ENABLED'];
  console.log(`[slack-test] token present: ${hasToken}`);
  console.log(`[slack-test] SLACK_ALERTS_ENABLED=${enabledRaw ?? '(unset)'}  NODE_ENV=${process.env['NODE_ENV'] ?? '(unset)'}`);
  console.log(`[slack-test] target channel: #${YANNIS_EOSE_CHANNEL}`);

  const service = new SlackService();
  const alert = apiErrorTemplate({
    path: 'slack.testAlert',
    code: 'INTERNAL_SERVER_ERROR',
    message: 'This is a test alert from slack-test-alert.ts — integration smoke test.',
    userId: 'test-script',
    userRole: 'SUPER_ADMIN',
    branchId: 'n/a',
    stack: 'Error: test alert\n    at slack-test-alert.ts (manual run)',
  });

  await service.sendMessage(
    YANNIS_EOSE_CHANNEL,
    alert.message,
    alert.blocks,
    alert.attachments,
  );

  console.log('[slack-test] sendMessage returned (check the channel — errors are logged above if any).');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[slack-test] failed:', err);
    process.exit(1);
  });
