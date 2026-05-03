/**
 * Default CS message templates seeded on every API boot (idempotent).
 *
 * Mirrors the pattern in `rbac/permission-catalog.ts`: source of truth lives in
 * code so the live DB stays in sync without depending on anyone remembering to
 * run a CLI. The boot-time seeder ([apps/api/src/database/message-template-seed.service.ts])
 * inserts every entry the first time, then no-ops if a row with the same name
 * already exists (rename intent: edit `name` here AND on the existing row, or
 * insert a new entry — names are the seed identity).
 *
 * Scope: every default is org-wide (`branch_id = NULL`). The `templates.list`
 * tRPC procedure surfaces NULL-branch rows alongside the caller's branch
 * templates so all CS reps see them. Branch-specific overrides remain visible
 * only inside that branch.
 *
 * Placeholders MUST be in `ALLOWED_TEMPLATE_PLACEHOLDERS` (see
 * `apps/api/src/trpc/routers/messaging.router.ts`). Available keys:
 *   customer_name · order_id · product_name · delivery_address ·
 *   estimated_date · quantity · total_amount · payment_status
 */

export type DefaultTemplateChannel = 'SMS' | 'WHATSAPP' | 'WHATSAPP_GROUP';

export interface DefaultMessageTemplate {
  /** Stable identity for idempotency. Editing this renames the seeded row on next boot. */
  name: string;
  channel: DefaultTemplateChannel;
  /** Body with `{{placeholder}}` syntax — substituted server-side at send time. */
  body: string;
}

export const DEFAULT_MESSAGE_TEMPLATES: DefaultMessageTemplate[] = [
  {
    name: 'Order confirmation reminder (SMS)',
    channel: 'SMS',
    body: "Hi {{customer_name}}, this is Yannis confirming your order #{{order_id}} for {{product_name}} (qty {{quantity}}). Delivery to {{delivery_address}}. Total: {{total_amount}}. Reply if anything's incorrect.",
  },
  {
    name: 'Out for delivery (SMS)',
    channel: 'SMS',
    body: 'Hi {{customer_name}}, your order #{{order_id}} is on the way to {{delivery_address}} today. Please be available. Total payable: {{total_amount}} ({{payment_status}}).',
  },
  {
    name: 'Confirmation request (WhatsApp)',
    channel: 'WHATSAPP',
    body: 'Hello {{customer_name}}! We tried reaching you about your order for {{product_name}}. Please confirm: {{quantity}} unit(s), delivery to {{delivery_address}}. Total {{total_amount}}. Reply YES to confirm.',
  },
  {
    name: 'Delivery follow-up (WhatsApp)',
    channel: 'WHATSAPP',
    body: 'Hi {{customer_name}}, just checking in on order {{order_id}} ({{product_name}}). Was everything delivered correctly? If you need anything, reply here.',
  },
  {
    name: '3PL dispatch handoff (WhatsApp Group)',
    channel: 'WHATSAPP_GROUP',
    body: '🚚 New Order Dispatch — Customer: {{customer_name}} · {{product_name}} (qty {{quantity}}) · {{delivery_address}} · Total {{total_amount}} ({{payment_status}}) · Estimated: {{estimated_date}} · Order {{order_id}}',
  },
];
