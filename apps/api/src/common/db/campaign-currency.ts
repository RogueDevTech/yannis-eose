/**
 * A form's (campaign's) country, as a currency code, in SQL.
 *
 * Ad spend rows carry no currency: they are logged in ₦ against a form. To
 * split spend by country we use the form's country, which is the same rule the
 * Forms page chips and the public edge form use: `form_config.pinnedCurrency`
 * (the form's starting currency), else the company's base currency, else NGN.
 *
 * Interpolates the given `campaigns` columns, so the outer query must have the
 * real `campaigns` table in scope (not an alias).
 */
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

export function campaignCurrencyCodeSql(formConfig: AnyColumn, branchId: AnyColumn): SQL<string> {
  return sql<string>`upper(coalesce(
    nullif(trim(${formConfig}->>'pinnedCurrency'), ''),
    (select cu.code from currencies cu
       join branches cb on cb.id = ${branchId}
      where cu.is_default and cu.group_id is not distinct from cb.group_id
      limit 1),
    'NGN'
  ))`;
}
