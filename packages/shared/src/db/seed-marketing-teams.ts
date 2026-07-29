/**
 * Seed 4 marketing teams x 6 media buyers (24 MBs) for Team Analysis testing.
 *
 * Creates on the Abuja branch (hom@yannis.dev's branch):
 *   - 24 MEDIA_BUYER users (mb3..mb26@yannis.dev, password Yannis2026!)
 *   - branch_departments MARKETING row + 4 branch_teams (Alpha/Beta/Gamma/Delta)
 *   - 6 members per team; the first member of each team is the supervisor
 *   - 1 campaign per MB
 *   - Orders per MB with per-team performance profiles (spread over 30 days,
 *     weighted toward today since the Team Analysis page defaults to "today")
 *   - APPROVED AD_SPEND logs per MB (feeds CPA / ROAS)
 *   - COMPLETED funding rows HoM -> MB (feeds Received / Balance columns)
 *
 * Idempotent: users/teams/campaigns are reused by email/name on re-run;
 * orders + spend + funding are skipped for any MB that already has orders.
 *
 * Usage:
 *   npx tsx packages/shared/src/db/seed-marketing-teams.ts
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import postgres from 'postgres';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { uuidv7 } from 'uuidv7';

config({ path: resolve(__dirname, '../../../../.env') });
config({ path: resolve(__dirname, '../../../../apps/api/.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const sql = postgres(DATABASE_URL, { max: 1, ssl: DATABASE_URL.includes('sslmode=require') ? 'require' : false });

const PASSWORD = 'Yannis2026!';
const SALT_ROUNDS = 12;
const BRANCH_ID = '22222222-2222-4222-8222-222222222222'; // Abuja (HoM's branch)
const HOM_EMAIL = 'hom@yannis.dev';

// Deterministic PRNG so re-runs produce the same shape
let _seed = 424242421;
function rand(): number { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]!; }
function randInt(lo: number, hi: number): number { return lo + Math.floor(rand() * (hi - lo + 1)); }

function hashPhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = '234' + d.slice(1);
  return createHash('sha256').update(`yannis:phone:${d}`).digest('hex');
}

let phoneCounter = 1;
function nextCustomerPhone(): string {
  return '0813' + String(phoneCounter++).padStart(7, '0');
}

// ── 24 MBs across 4 teams. First member of each team = supervisor. ──
interface TeamDef {
  name: string;
  // Performance profile ranges (per-MB jitter applied inside)
  orders: [number, number];
  confirmRate: [number, number];
  deliverRate: [number, number];
  /** Ad spend per order in naira; low spendPerOrder = good CPA */
  spendPerOrder: [number, number];
  members: string[]; // names; emails assigned in order mb3..mb26
}

const TEAMS: TeamDef[] = [
  {
    name: 'Marketing Team Alpha',
    orders: [14, 18], confirmRate: [0.65, 0.75], deliverRate: [0.45, 0.55], spendPerOrder: [2500, 3500],
    members: ['Kemi Adekunle', 'Uche Onyekachi', 'Segun Bello', 'Funmi Oladele', 'Hassan Ibrahim', 'Ngozi Amadi'],
  },
  {
    name: 'Marketing Team Beta',
    orders: [11, 15], confirmRate: [0.55, 0.65], deliverRate: [0.35, 0.45], spendPerOrder: [3500, 4500],
    members: ['Adaeze Okwu', 'Tosin Bakare', 'Musa Abdulrahman', 'Chiamaka Ogu', 'Olayinka Fadeyi', 'Yakubu Bala'],
  },
  {
    name: 'Marketing Team Gamma',
    orders: [9, 13], confirmRate: [0.45, 0.55], deliverRate: [0.25, 0.35], spendPerOrder: [4500, 5500],
    members: ['Nneka Chiedozie', 'Gbenga Soyinka', 'Amina Sadiq', 'Chuka Okonjo', 'Bisi Ogunleye', 'Idris Mohammed'],
  },
  {
    name: 'Marketing Team Delta',
    orders: [6, 10], confirmRate: [0.30, 0.45], deliverRate: [0.10, 0.20], spendPerOrder: [5500, 7000],
    members: ['Ronke Ajayi', 'Emeka Nnamani', 'Zainab Aliyu', 'Tayo Fashola', 'Ify Obiora', 'Sule Danladi'],
  },
];

const FIRST_MB_NUMBER = 3; // mb3@yannis.dev .. mb26@yannis.dev

interface SeededMb {
  id: string;
  name: string;
  email: string;
  teamName: string;
  isSupervisor: boolean;
  profile: { orders: number; confirmRate: number; deliverRate: number; spendPerOrder: number };
}

function jitter([lo, hi]: [number, number]): number { return lo + rand() * (hi - lo); }

async function main() {
  console.log('Seeding 4 marketing teams x 6 MBs on Abuja branch...');
  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  // ── Reference rows ──
  const [hom] = await sql`SELECT id, name FROM users WHERE email = ${HOM_EMAIL} LIMIT 1`;
  if (!hom) { console.error(`HoM ${HOM_EMAIL} not found. Run seed-full-dataset first.`); process.exit(1); }

  const closers = await sql`SELECT id FROM users WHERE role = 'CS_CLOSER' AND status = 'ACTIVE'`;
  if (closers.length === 0) { console.error('No CS_CLOSER users found.'); process.exit(1); }

  const products = await sql`SELECT id, name, base_sale_price::numeric AS price, cost_price::numeric AS cost FROM products WHERE status = 'ACTIVE' ORDER BY name`;
  if (products.length === 0) { console.error('No products found.'); process.exit(1); }

  // ── 1. Users ──
  const mbs: SeededMb[] = [];
  let mbNumber = FIRST_MB_NUMBER;
  for (const team of TEAMS) {
    for (let mi = 0; mi < team.members.length; mi++) {
      const email = `mb${mbNumber}@yannis.dev`;
      mbNumber++;
      const name = team.members[mi]!;
      const isSupervisor = mi === 0;
      let id: string;
      const existing = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
      if (existing.length > 0) {
        id = existing[0]!.id;
        await sql`UPDATE users SET name = ${name}, role = 'MEDIA_BUYER', status = 'ACTIVE',
          password_hash = ${passwordHash}, primary_branch_id = ${BRANCH_ID}, is_team_supervisor = ${isSupervisor}
          WHERE id = ${id}`;
      } else {
        id = uuidv7();
        await sql`INSERT INTO users (id, name, email, password_hash, role, status, scope_global, primary_branch_id, is_team_supervisor)
          VALUES (${id}, ${name}, ${email}, ${passwordHash}, 'MEDIA_BUYER', 'ACTIVE', false, ${BRANCH_ID}, ${isSupervisor})`;
      }
      await sql`INSERT INTO user_branches (user_id, branch_id)
        VALUES (${id}, ${BRANCH_ID}) ON CONFLICT DO NOTHING`.catch(() => {});
      mbs.push({
        id, name, email, teamName: team.name, isSupervisor,
        profile: {
          orders: randInt(team.orders[0], team.orders[1]),
          confirmRate: jitter(team.confirmRate),
          deliverRate: jitter(team.deliverRate),
          spendPerOrder: jitter(team.spendPerOrder),
        },
      });
    }
  }
  console.log(`  Users: ${mbs.length} media buyers (mb${FIRST_MB_NUMBER}..mb${mbNumber - 1}@yannis.dev, password ${PASSWORD})`);

  // ── 2. Marketing department + teams + members ──
  let mktDeptId: string;
  const dept = await sql`SELECT id FROM branch_departments WHERE branch_id = ${BRANCH_ID} AND department = 'MARKETING' LIMIT 1`;
  if (dept.length > 0) {
    mktDeptId = dept[0]!.id;
  } else {
    mktDeptId = uuidv7();
    await sql`INSERT INTO branch_departments (id, branch_id, department) VALUES (${mktDeptId}, ${BRANCH_ID}, 'MARKETING')`;
  }

  for (const team of TEAMS) {
    let teamId: string;
    const existingTeam = await sql`SELECT id FROM branch_teams WHERE branch_id = ${BRANCH_ID} AND department = 'MARKETING' AND name = ${team.name} LIMIT 1`;
    if (existingTeam.length > 0) {
      teamId = existingTeam[0]!.id;
    } else {
      teamId = uuidv7();
      await sql`INSERT INTO branch_teams (id, branch_id, branch_department_id, department, name)
        VALUES (${teamId}, ${BRANCH_ID}, ${mktDeptId}, 'MARKETING', ${team.name})`;
    }
    const teamMbs = mbs.filter((m) => m.teamName === team.name);
    for (const m of teamMbs) {
      await sql`INSERT INTO branch_team_members (team_id, user_id, is_supervisor)
        VALUES (${teamId}, ${m.id}, ${m.isSupervisor})
        ON CONFLICT (team_id, user_id) DO UPDATE SET is_supervisor = ${m.isSupervisor}`;
      // Department roster row so the MB shows under the Marketing department
      await sql`INSERT INTO branch_department_members (branch_department_id, user_id)
        VALUES (${mktDeptId}, ${m.id}) ON CONFLICT DO NOTHING`;
    }
  }
  console.log(`  Teams: ${TEAMS.length} marketing teams, 6 members each (first member is supervisor)`);

  // ── 3. Campaign per MB ──
  const campaignByMb = new Map<string, string>();
  for (const m of mbs) {
    const cName = `Campaign ${m.name}`;
    const existing = await sql`SELECT id FROM campaigns WHERE media_buyer_id = ${m.id} AND name = ${cName} LIMIT 1`;
    let cId: string;
    if (existing.length > 0) {
      cId = existing[0]!.id;
    } else {
      cId = uuidv7();
      await sql`INSERT INTO campaigns (id, name, media_buyer_id, branch_id, status)
        VALUES (${cId}, ${cName}, ${m.id}, ${BRANCH_ID}, 'ACTIVE')`;
    }
    campaignByMb.set(m.id, cId);
  }
  console.log(`  Campaigns: ${campaignByMb.size} (one per MB, Abuja branch)`);

  // ── 4. Orders + ad spend + funding per MB ──
  const POST_CONFIRM = new Set(['CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'REMITTED']);
  const DELIVERED_SET = new Set(['DELIVERED', 'REMITTED']);
  const now = Date.now();
  let ordersCreated = 0;
  let spendRows = 0;
  let fundingRows = 0;
  let skipped = 0;

  for (const m of mbs) {
    const [{ n: existingOrders }] = await sql<{ n: number }[]>`SELECT count(*)::int n FROM orders WHERE media_buyer_id = ${m.id}`;
    if (existingOrders > 0) { skipped++; continue; }

    const campaignId = campaignByMb.get(m.id)!;
    const n = m.profile.orders;
    const deliveredCount = Math.round(n * m.profile.deliverRate);
    const confirmedOnly = Math.max(0, Math.round(n * m.profile.confirmRate) - deliveredCount);

    // Build the status list: delivered bucket, confirmed-but-in-flight bucket, pre-confirm rest
    const statuses: string[] = [];
    for (let i = 0; i < deliveredCount; i++) statuses.push(i % 3 === 0 ? 'REMITTED' : 'DELIVERED');
    const inFlight = ['CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'AGENT_ASSIGNED', 'DISPATCHED', 'IN_TRANSIT'];
    for (let i = 0; i < confirmedOnly; i++) statuses.push(inFlight[i % inFlight.length]!);
    const preConfirm = ['UNPROCESSED', 'CS_ASSIGNED', 'CS_ENGAGED', 'CS_ENGAGED'];
    while (statuses.length < n) statuses.push(preConfirm[statuses.length % preConfirm.length]!);

    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i]!;
      // ~20% of orders land today (page defaults to the "today" filter), rest over last 30 days
      const daysAgo = i % 5 === 0 ? 0 : randInt(1, 30);
      const createdAt = new Date(now - daysAgo * 86400000 - randInt(0, 6) * 3600000);
      const product = pick([...products]);
      const phone = nextCustomerPhone();
      const orderId = uuidv7();
      const confirmedAt = POST_CONFIRM.has(status) ? new Date(createdAt.getTime() + 2 * 3600000) : null;
      const deliveredAt = DELIVERED_SET.has(status) ? new Date(createdAt.getTime() + randInt(1, 3) * 86400000) : null;
      const landed = POST_CONFIRM.has(status) ? Math.round(Number(product.cost) * 1.15) : null;
      const closer = pick([...closers]);

      await sql`INSERT INTO orders (
        id, status, order_source, branch_id, servicing_branch_id, campaign_id, media_buyer_id, assigned_cs_id,
        customer_name, customer_phone, customer_phone_hash, customer_address,
        total_amount, landed_cost, is_follow_up, created_at, confirmed_at, delivered_at
      ) VALUES (
        ${orderId}, ${status}, 'edge-form', ${BRANCH_ID}, ${BRANCH_ID}, ${campaignId}, ${m.id},
        ${status === 'UNPROCESSED' ? null : closer.id},
        ${'Customer ' + m.name.split(' ')[0] + ' ' + (i + 1)}, ${phone}, ${hashPhone(phone)},
        ${'No. ' + randInt(1, 200) + ' Abuja St'},
        ${sql`${String(product.price)}::numeric`}, ${landed === null ? null : sql`${String(landed)}::numeric`},
        false, ${createdAt}, ${confirmedAt}, ${deliveredAt}
      )`;
      await sql`INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
        VALUES (${uuidv7()}, ${orderId}, ${product.id}, 1, ${sql`${String(product.price)}::numeric`})`;
      ordersCreated++;
    }

    // Ad spend: 6 APPROVED AD_SPEND rows over 30 days, one always today
    const totalSpend = Math.round(n * m.profile.spendPerOrder);
    const perRow = Math.round(totalSpend / 6);
    for (let s = 0; s < 6; s++) {
      const daysAgo = s === 0 ? 0 : randInt(1, 30);
      const spendDate = new Date(now - daysAgo * 86400000);
      await sql`INSERT INTO ad_spend_logs (
        id, media_buyer_id, campaign_id, spend_amount, platform, category, status,
        spend_date, approved_at, approved_by, attributed_order_count, created_at
      ) VALUES (
        ${uuidv7()}, ${m.id}, ${campaignByMb.get(m.id)}, ${sql`${String(perRow)}::numeric`},
        ${pick(['FACEBOOK', 'FACEBOOK', 'TIKTOK', 'GOOGLE'])}, 'AD_SPEND', 'APPROVED',
        ${spendDate}, ${spendDate}, ${hom.id}, 0, ${spendDate}
      )`;
      spendRows++;
    }

    // Funding: 2 COMPLETED rows HoM -> MB covering the spend with headroom
    const fundingTotal = Math.round(totalSpend * 1.4);
    for (let f = 0; f < 2; f++) {
      const sentAt = new Date(now - randInt(5, 28) * 86400000);
      await sql`INSERT INTO marketing_funding (id, sender_id, receiver_id, amount, status, sent_at, verified_at)
        VALUES (${uuidv7()}, ${hom.id}, ${m.id}, ${sql`${String(Math.round(fundingTotal / 2))}::numeric`},
                'COMPLETED', ${sentAt}, ${new Date(sentAt.getTime() + 3600000)})`;
      fundingRows++;
    }
  }

  if (skipped > 0) console.log(`  Skipped orders/spend/funding for ${skipped} MBs that already had orders`);
  console.log(`  Orders: ${ordersCreated} | Ad spend rows: ${spendRows} | Funding rows: ${fundingRows}`);

  console.log('\nDone. Team roster:');
  for (const team of TEAMS) {
    const teamMbs = mbs.filter((x) => x.teamName === team.name);
    console.log(`  ${team.name}`);
    for (const x of teamMbs) {
      console.log(`    ${x.isSupervisor ? '[SUPERVISOR] ' : '             '}${x.name.padEnd(20)} ${x.email}`);
    }
  }
  console.log(`\nAll passwords: ${PASSWORD}`);
  console.log('View as hom@yannis.dev (all teams) or any [SUPERVISOR] account (own team only) at /admin/marketing/team');
  console.log('Note: restart the API so RBAC permission snapshots restamp for the new users.');

  await sql.end();
}

main().catch((err) => { console.error(err); process.exit(1); });
