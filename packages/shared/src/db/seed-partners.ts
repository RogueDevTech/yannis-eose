/**
 * Seed script — creates 12 3PL logistics partners (providers + locations).
 *
 * Usage:
 *   npx tsx packages/shared/src/db/seed-partners.ts
 *
 * Env: DATABASE_URL required (loads from repo root .env if present).
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(__dirname, '../../../../.env') });

import postgres from 'postgres';
import { randomUUID } from 'crypto';

interface Partner {
  providerId: string;
  providerName: string;
  contactInfo: string;
  coverageArea: string;
  rateCard: string; // JSON string
  locationId: string;
  locationName: string;
  address: string;
  coordinates: string;
}

const partners: Partner[] = [
  {
    providerId: randomUUID(),
    providerName: 'RapidDrop Lagos Mainland',
    contactInfo: '08060001111',
    coverageArea: 'Lagos Mainland, Surulere, Yaba',
    rateCard: JSON.stringify({ zone_1: 1200, zone_2: 2000, zone_3: 3000 }),
    locationId: randomUUID(),
    locationName: 'RapidDrop Surulere Hub',
    address: '8 Bode Thomas Street, Surulere, Lagos',
    coordinates: '6.5059,3.3570',
  },
  {
    providerId: randomUUID(),
    providerName: 'NaijaExpress Logistics',
    contactInfo: '08060002222',
    coverageArea: 'Lagos Island, Victoria Island, Ikoyi',
    rateCard: JSON.stringify({ zone_1: 1500, zone_2: 2500, zone_3: 3500 }),
    locationId: randomUUID(),
    locationName: 'NaijaExpress VI Hub',
    address: '14 Adeola Odeku Street, Victoria Island, Lagos',
    coordinates: '6.4281,3.4219',
  },
  {
    providerId: randomUUID(),
    providerName: 'SpeedLink Ibadan',
    contactInfo: '08060003333',
    coverageArea: 'Ibadan, Oyo, Ogbomoso',
    rateCard: JSON.stringify({ zone_1: 1800, zone_2: 2800, zone_3: 4000 }),
    locationId: randomUUID(),
    locationName: 'SpeedLink Ibadan Hub',
    address: '22 Ring Road, Challenge, Ibadan',
    coordinates: '7.3775,3.9470',
  },
  {
    providerId: randomUUID(),
    providerName: 'DashRider Port Harcourt',
    contactInfo: '08060004444',
    coverageArea: 'Port Harcourt, Rivers, Bayelsa',
    rateCard: JSON.stringify({ zone_1: 2000, zone_2: 3200, zone_3: 4500 }),
    locationId: randomUUID(),
    locationName: 'DashRider PH Hub',
    address: '5 Aba Road, GRA Phase 2, Port Harcourt',
    coordinates: '4.8156,7.0498',
  },
  {
    providerId: randomUUID(),
    providerName: 'KwikShip Kano',
    contactInfo: '08060005555',
    coverageArea: 'Kano, Kaduna, Katsina',
    rateCard: JSON.stringify({ zone_1: 2200, zone_2: 3500, zone_3: 5000 }),
    locationId: randomUUID(),
    locationName: 'KwikShip Kano Hub',
    address: '10 Bompai Road, Nassarawa GRA, Kano',
    coordinates: '12.0022,8.5919',
  },
  {
    providerId: randomUUID(),
    providerName: 'EagleWing Enugu',
    contactInfo: '08060006666',
    coverageArea: 'Enugu, Anambra, Ebonyi',
    rateCard: JSON.stringify({ zone_1: 1900, zone_2: 3000, zone_3: 4200 }),
    locationId: randomUUID(),
    locationName: 'EagleWing Enugu Hub',
    address: '33 Ogui Road, Enugu',
    coordinates: '6.4584,7.5464',
  },
  {
    providerId: randomUUID(),
    providerName: 'BoltDrop Benin',
    contactInfo: '08060007777',
    coverageArea: 'Benin City, Edo, Delta',
    rateCard: JSON.stringify({ zone_1: 1700, zone_2: 2700, zone_3: 3800 }),
    locationId: randomUUID(),
    locationName: 'BoltDrop Benin Hub',
    address: '15 Sapele Road, Benin City',
    coordinates: '6.3350,5.6037',
  },
  {
    providerId: randomUUID(),
    providerName: 'FlashMove Abeokuta',
    contactInfo: '08060008888',
    coverageArea: 'Abeokuta, Ogun, Ijebu-Ode',
    rateCard: JSON.stringify({ zone_1: 1400, zone_2: 2200, zone_3: 3200 }),
    locationId: randomUUID(),
    locationName: 'FlashMove Abeokuta Hub',
    address: '7 Kuto Road, Abeokuta',
    coordinates: '7.1557,3.3450',
  },
  {
    providerId: randomUUID(),
    providerName: 'TurboRun Calabar',
    contactInfo: '08060009999',
    coverageArea: 'Calabar, Cross River, Akwa Ibom',
    rateCard: JSON.stringify({ zone_1: 2300, zone_2: 3600, zone_3: 5200 }),
    locationId: randomUUID(),
    locationName: 'TurboRun Calabar Hub',
    address: '18 Marian Road, Calabar',
    coordinates: '4.9757,8.3417',
  },
  {
    providerId: randomUUID(),
    providerName: 'JetHaul Jos',
    contactInfo: '08061001111',
    coverageArea: 'Jos, Plateau, Bauchi',
    rateCard: JSON.stringify({ zone_1: 2100, zone_2: 3300, zone_3: 4800 }),
    locationId: randomUUID(),
    locationName: 'JetHaul Jos Hub',
    address: '9 Ahmadu Bello Way, Jos',
    coordinates: '9.8965,8.8583',
  },
  {
    providerId: randomUUID(),
    providerName: 'PrimeDash Warri',
    contactInfo: '08061002222',
    coverageArea: 'Warri, Delta, Ughelli',
    rateCard: JSON.stringify({ zone_1: 1800, zone_2: 2900, zone_3: 4100 }),
    locationId: randomUUID(),
    locationName: 'PrimeDash Warri Hub',
    address: '4 Effurun-Sapele Road, Warri',
    coordinates: '5.5168,5.7502',
  },
  {
    providerId: randomUUID(),
    providerName: 'SwiftArrow Ilorin',
    contactInfo: '08061003333',
    coverageArea: 'Ilorin, Kwara, Osogbo',
    rateCard: JSON.stringify({ zone_1: 1600, zone_2: 2600, zone_3: 3700 }),
    locationId: randomUUID(),
    locationName: 'SwiftArrow Ilorin Hub',
    address: '11 Unity Road, GRA, Ilorin',
    coordinates: '8.4966,4.5426',
  },
];

async function seedPartners() {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = postgres(connectionString, { max: 1 });

  console.log('Seeding 12 3PL partners (providers + locations)...\n');

  for (const p of partners) {
    // Insert provider
    await sql`
      INSERT INTO logistics_providers (id, name, contact_info, coverage_area, rate_card, status)
      VALUES (${p.providerId}, ${p.providerName}, ${p.contactInfo}, ${p.coverageArea}, ${p.rateCard}::jsonb, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
    `;

    // Insert location (hub) for this provider
    await sql`
      INSERT INTO logistics_locations (id, provider_id, name, address, coordinates, dispatch_locked, status)
      VALUES (${p.locationId}, ${p.providerId}, ${p.locationName}, ${p.address}, ${p.coordinates}, false, 'ACTIVE')
      ON CONFLICT (id) DO NOTHING
    `;

    console.log(`  ✓ ${p.providerName} → ${p.locationName}`);
  }

  console.log(`\nDone! Created ${partners.length} partners with locations.\n`);

  await sql.end();
}

seedPartners().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
