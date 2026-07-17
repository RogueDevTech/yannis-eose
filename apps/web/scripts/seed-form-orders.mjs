#!/usr/bin/env node
/**
 * Seed 100 orders via the public orders.create tRPC endpoint.
 * Simulates edge-form submissions for campaign 019f6a22-c15b-7b94-b19f-81a1f20cf66a.
 *
 * Usage: node apps/web/scripts/seed-form-orders.mjs
 */

import crypto from 'node:crypto';

const API_URL = 'http://localhost:4444';
const CAMPAIGN_ID = '019f6a22-c15b-7b94-b19f-81a1f20cf66a';
const MEDIA_BUYER_ID = '019de444-daf2-793c-8c3e-b8c017bac877';
const PRODUCT_ID = '019df815-e438-769a-a9d2-6388ae493965';
const OFFER_LABEL = 'Buy 1 Inhaler, Get 1 Amp of Aminophyline free';
const OFFER_PRICE = 24000;
const OFFER_QTY = 2;
const TOTAL = 100;

// Nigerian states
const STATES = [
  'Lagos', 'Abuja (FCT)', 'Rivers', 'Oyo', 'Kano', 'Delta',
  'Kaduna', 'Ogun', 'Edo', 'Anambra', 'Enugu', 'Imo',
  'Abia', 'Osun', 'Kwara', 'Plateau', 'Benue', 'Cross River',
];

const FIRST_NAMES = [
  'Adebayo', 'Chioma', 'Emeka', 'Fatima', 'Gbenga', 'Halima',
  'Ibrahim', 'Jumoke', 'Kehinde', 'Lateef', 'Maryam', 'Ngozi',
  'Obinna', 'Patricia', 'Rasheed', 'Sade', 'Tunde', 'Uche',
  'Victoria', 'Wale', 'Yetunde', 'Zainab', 'Aisha', 'Bola',
  'Chukwu', 'Damilola', 'Ese', 'Folake', 'Grace', 'Hassan',
];

const LAST_NAMES = [
  'Okafor', 'Adeyemi', 'Balogun', 'Chukwuma', 'Danjuma', 'Eze',
  'Fagbemi', 'Garba', 'Hassan', 'Igwe', 'Johnson', 'Kalu',
  'Lawal', 'Mohammed', 'Nnamdi', 'Obi', 'Peters', 'Quadri',
  'Raji', 'Suleiman', 'Taiwo', 'Udoh', 'Victor', 'Williams',
  'Yakubu', 'Zubair', 'Abubakar', 'Bankole', 'Cole', 'Dim',
];

const STREETS = [
  'Admiralty Way', 'Allen Avenue', 'Awolowo Road', 'Broad Street',
  'Commercial Avenue', 'Diya Street', 'Eko Atlantic', 'Falolu Road',
  'Gbagada Expressway', 'Herbert Macaulay Way', 'Ikorodu Road',
  'Jibowu Street', 'Kingsway Road', 'Lewis Street', 'Marina Road',
  'Nnamdi Azikiwe Street', 'Obalende Road', 'Palm Avenue',
  'Queen Elizabeth Drive', 'Ring Road', 'Sapele Road', 'Toyin Street',
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone() {
  const prefix = pick(['070', '080', '081', '090', '091']);
  const suffix = String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
  return prefix + suffix;
}

function normalizePhoneDigits(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = '234' + digits.slice(1);
  }
  return digits;
}

function hashPhone(phone) {
  const normalized = normalizePhoneDigits(phone);
  const data = `yannis:phone:${normalized}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

async function createOrder(index) {
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const phone = randomPhone();
  const state = pick(STATES);
  const houseNo = Math.floor(Math.random() * 200) + 1;
  const street = pick(STREETS);

  const payload = {
    campaignId: CAMPAIGN_ID,
    mediaBuyerId: MEDIA_BUYER_ID,
    customerName: `${firstName} ${lastName}`,
    customerPhoneHash: hashPhone(phone),
    customerPhone: phone,
    deliveryAddress: `${houseNo} ${street}`,
    deliveryState: state,
    paymentMethod: 'PAY_ON_DELIVERY',
    items: [{
      productId: PRODUCT_ID,
      quantity: OFFER_QTY,
      unitPrice: OFFER_PRICE,
      offerLabel: OFFER_LABEL,
    }],
    totalAmount: OFFER_PRICE,
    source: 'edge-form',
  };

  const res = await fetch(`${API_URL}/trpc/orders.create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error(`[${index + 1}/${TOTAL}] FAILED: ${JSON.stringify(data)}`);
    return false;
  }
  const orderId = data?.result?.data?.id ?? '?';
  console.log(`[${index + 1}/${TOTAL}] OK — ${firstName} ${lastName} (${phone}) → ${orderId}`);
  return true;
}

async function main() {
  console.log(`Seeding ${TOTAL} orders to campaign ${CAMPAIGN_ID}...`);
  console.log(`Product: Nebulizer | Offer: ${OFFER_LABEL} | Price: ₦${OFFER_PRICE}\n`);

  let ok = 0;
  let fail = 0;

  // Send in batches of 5 to avoid overwhelming the API
  for (let i = 0; i < TOTAL; i += 5) {
    const batch = [];
    for (let j = i; j < Math.min(i + 5, TOTAL); j++) {
      batch.push(createOrder(j));
    }
    const results = await Promise.all(batch);
    ok += results.filter(Boolean).length;
    fail += results.filter((r) => !r).length;
  }

  console.log(`\nDone: ${ok} created, ${fail} failed.`);
}

main().catch(console.error);
