# Yannis EOSE — Service & Pricing Proposal

**Prepared by:** Rogue Developer Technologies Limited
**Prepared for:** Yannis Management
**Date:** March 2026
**Document Type:** Commercial Proposal
**Version:** 1.0

---

## 1. Executive Summary

Rogue Developer Technologies Limited has built the Yannis EOSE platform — a custom enterprise operations and sales engine that replaces the legacy Sniper tool. This document outlines three engagement models for completing and deploying the system, along with transparent breakdowns of all costs involved.

**There are two categories of cost:**

| Category | Who Pays | Description |
|---|---|---|
| **Development & Service Fees** | Yannis pays Rogue DevTech | Our fees for building, deploying, and/or maintaining the platform |
| **Infrastructure & Integration Costs** | Yannis pays directly to providers | Hosting, VOIP, SMS, email, storage — paid to Twilio, Cloudflare, etc. |

We separate these clearly so there is no ambiguity. Infrastructure costs are pass-through — Yannis holds the accounts and pays the providers directly. We do not mark up infrastructure.

---

## 2. Project Timeline

| Phase | Duration | Description |
|---|---|---|
| **Demo Build** | 1 week (Complete) | Functional prototype demonstrating all core modules |
| **Discovery & Requirements** | 1 month | Deep-dive with each department (CS, Logistics, Marketing, Finance, HR) to capture exact workflows, edge cases, and preferences |
| **Final Build & Testing** | 1 month | Complete development incorporating team feedback, extensive testing, data migration, UAT (User Acceptance Testing) |
| **Deployment & Handover** | 1 week | Production deployment, team training, documentation |
| **Total** | **~10 weeks** from contract signing to go-live |

---

## 3. Service Models — Choose Your Engagement

We offer three engagement models. Each builds on the previous.

---

### Option A: Build & Transfer

**You get:** The completed software, deployed to your infrastructure, with full source code ownership. We walk away after handover.

| Item | Cost |
|---|---|
| Discovery & Requirements (1 month) | Included |
| Final Build & Testing (1 month) | Included |
| Production Deployment | Included |
| Team Training (2 sessions) | Included |
| Full Source Code Transfer | Included |
| Technical Documentation | Included |
| **Total One-Time Fee** | **₦8,500,000** |

**What's included:**
- Complete source code with git history
- Database schema, migrations, and seed data
- All documentation (Developer Guide, Runbook, Architecture Decisions)
- 2 training sessions (1 for management, 1 for technical staff)
- Deployment to your chosen cloud provider
- 2 weeks of post-launch bug fixes (critical issues only)

**What's NOT included:**
- Ongoing maintenance or support after the 2-week warranty
- New feature development
- Server monitoring or uptime management
- Infrastructure cost management

**Best for:** Companies that have an in-house development team capable of maintaining a NestJS + Remix + PostgreSQL stack.

**Risk:** If bugs are discovered after the 2-week warranty, or if new requirements emerge, you need your own developers to fix them. Enterprise ERP systems typically require ongoing maintenance.

---

### Option B: Build & Deploy

**You get:** Everything in Option A, plus 3 months of post-launch support to stabilize the platform.

| Item | Cost |
|---|---|
| Everything in Option A | ₦8,500,000 |
| 3-Month Post-Launch Support | ₦750,000 (₦250,000/month) |
| **Total** | **₦9,250,000** |

**The 3-month support includes:**
- Bug fixes and patches (48-hour response time)
- Performance monitoring and optimization
- Minor adjustments based on team feedback
- Up to 20 support hours per month
- Email + WhatsApp support during business hours

**After 3 months:** Support ends. Source code has already been transferred. You are on your own, or you can transition to an ongoing maintenance plan (see Option C tiers).

**Best for:** Companies that want a stabilization period before taking full ownership, or companies evaluating whether to hire in-house developers.

---

### Option C: Build, Deploy & Maintain

**You get:** Everything in Option A + ongoing monthly maintenance and support. The system stays healthy, secure, and evolving.

| Item | Cost |
|---|---|
| Everything in Option A | ₦8,500,000 |
| Monthly Maintenance (ongoing) | See tiers below |

Choose your maintenance tier:

#### Tier 1: Essential — "Keep It Running"

| | |
|---|---|
| **Monthly Fee** | **₦200,000/month** |
| Response Time | 48 hours (critical: 24 hours) |
| Scope | Bug fixes, security patches, server monitoring, uptime checks |
| Hours Included | 10 hours/month |
| Support Channel | Email + ticket system |
| Availability | Business hours (Mon-Fri, 9am-5pm) |
| Server Monitoring | Basic (uptime alerts) |
| Database Maintenance | Monthly backup verification |

#### Tier 2: Standard — "Active Maintenance"

| | |
|---|---|
| **Monthly Fee** | **₦450,000/month** |
| Response Time | 24 hours (critical: 4 hours) |
| Scope | Bug fixes + minor feature tweaks (2-3/month) + performance optimization |
| Hours Included | 25 hours/month |
| Support Channel | Email + WhatsApp group + monthly call |
| Availability | Extended hours (Mon-Sat, 8am-8pm) |
| Server Monitoring | Active (performance dashboards, error tracking) |
| Database Maintenance | Weekly backup verification, query optimization |
| Reporting | Monthly health report with recommendations |

#### Tier 3: Premium — "Full Managed Service"

| | |
|---|---|
| **Monthly Fee** | **₦800,000/month** |
| Response Time | 4 hours (critical: 1 hour) |
| Scope | All Standard items + new feature development + architecture reviews + scaling |
| Hours Included | 50 hours/month |
| Support Channel | Dedicated WhatsApp group + phone + weekly sync calls |
| Availability | Mon-Sun, 8am-10pm (critical issues: 24/7) |
| Server Monitoring | Comprehensive (real-time dashboards, alerting, log analysis) |
| Database Maintenance | Continuous optimization, growth planning |
| Reporting | Weekly status updates + monthly strategic review |
| Extras | Quarterly roadmap planning, priority feature requests |

**Best for:** Companies that want peace of mind — the system is always running, always improving, and there is always a team that knows the codebase inside out.

---

### Comparison At A Glance

| Feature | Option A | Option B | Option C |
|---|---|---|---|
| Full Source Code | Yes | Yes | Yes |
| Production Deployment | Yes | Yes | Yes |
| Team Training | Yes | Yes | Yes |
| Documentation | Yes | Yes | Yes |
| Post-Launch Bug Fixes | 2 weeks | 3 months | Ongoing |
| New Feature Development | No | No | Tier 3 only |
| Server Monitoring | No | 3 months | Ongoing |
| Performance Optimization | No | 3 months | Ongoing |
| Dedicated Support Channel | No | 3 months (WhatsApp) | Ongoing |
| **One-Time Cost** | **₦8,500,000** | **₦9,250,000** | **₦8,500,000** |
| **Monthly Cost** | ₦0 | ₦0 (after 3 months) | ₦200K-800K |
| **Year 1 Total** | ₦8,500,000 | ₦9,250,000 | ₦10,900,000-₦18,100,000 |

---

## 4. Infrastructure Costs (Paid Directly by Yannis)

These are the costs of running the platform. Yannis holds all accounts and pays providers directly. We help set up and configure everything, but the accounts belong to Yannis.

### 4.1 Core Hosting (Required)

| Service | Provider | Monthly Cost | Annual Cost |
|---|---|---|---|
| API Server (NestJS) | Render Standard | ₦35,000 | ₦420,000 |
| Web Server (Remix) | Render Standard | ₦35,000 | ₦420,000 |
| Database (PostgreSQL) | Neon / Supabase | ₦28,000-₦55,000 | ₦336,000-₦660,000 |
| Cache & Sessions (Redis) | Upstash | ₦7,000-₦14,000 | ₦84,000-₦168,000 |
| Edge Worker (Forms) | Cloudflare Workers | ₦7,000 | ₦84,000 |
| File Storage (Receipts, Screenshots) | Cloudflare R2 | ₦0-₦3,000 | ₦0-₦36,000 |
| Domain + SSL | Cloudflare / Registrar | ₦1,500 | ₦18,000 |
| **Hosting Subtotal** | | **₦113,500-₦150,500/month** | **₦1,362,000-₦1,806,000/year** |

*Estimates based on 500-2,000 orders/month with 20-50 internal users. Scales with usage.*

---

### 4.2 Integrations (Variable — Based on Usage)

These are the costs of the third-party services that power specific features. Each is optional — you can start without them and add as needed.

#### VOIP Calling (Twilio Voice API)

This powers the "Call Customer" button in the CS dashboard. Agents call through the browser, customers receive a call from a verified business number.

| Item | Rate | Estimated Monthly (1,500 orders) |
|---|---|---|
| Calls to Nigerian mobile | ~₦230/minute | |
| WebRTC (agent browser side) | ~₦6/minute | |
| Call recording (optional) | ~₦3.50/minute | |
| Phone number rental | ~₦1,600/month | |
| **Total (3 min avg call)** | | **₦555,000-₦1,080,000/month** |

**Cost reduction options:**
- Use a local Nigerian VOIP provider (e.g. Africa's Talking) at ~₦55-100/minute = **₦250,000-₦450,000/month** (40-60% savings)
- Reduce average call duration through better CS scripts
- The system supports a "Manual Call Mode" (VOIP disabled) where agents use personal phones and log calls manually — **₦0/month** but sacrifices Pillar 2 (phone number masking)

#### SMS Notifications

For sending OTP codes, delivery updates, and order confirmations to customers.

| Provider | Rate per SMS | Estimated Monthly (1,500 orders) |
|---|---|---|
| **Twilio** (international route) | ₦10-₦390/SMS | ₦15,000-₦585,000 |
| **Termii** (local Nigerian) | ₦2.50-₦8/SMS | **₦3,750-₦12,000** |
| **BulkSMS Nigeria** (local) | ₦2-₦6/SMS | **₦3,000-₦9,000** |

**Recommendation:** Use a local Nigerian SMS provider. 10-50x cheaper than Twilio for Nigerian numbers.

#### WhatsApp Business API

For automated order confirmations, delivery tracking, and follow-up messages.

| Message Type | Rate | Estimated Monthly |
|---|---|---|
| Utility (order updates, confirmations) | ~₦9/message | ₦27,000 (3,000 messages) |
| Marketing (promotions, re-engagement) | ~₦72/message | ₦36,000 (500 messages) |
| Service (customer-initiated replies) | Free | ₦0 |
| BSP Platform Fee (360dialog/WATI) | Flat fee | ₦0-₦70,000 |
| **Total** | | **₦63,000-₦133,000/month** |

**Note:** WhatsApp automation is not yet built into the system. It would be a future enhancement (see Section 6).

#### Email Service (SendGrid)

For transactional emails (order confirmations, password resets, notifications).

| Plan | Monthly Cost | Emails Included |
|---|---|---|
| Essentials | ₦28,000 | 50,000 emails |
| Pro (with dedicated IP) | ₦125,000 | 100,000 emails |

**Recommendation:** Essentials plan is sufficient at your current scale.

---

### 4.3 Infrastructure Cost Summary

| Category | Low Estimate | High Estimate |
|---|---|---|
| **Core Hosting** | ₦113,500/month | ₦150,500/month |
| **VOIP (Twilio)** | ₦555,000/month | ₦1,080,000/month |
| **VOIP (Local provider alternative)** | ₦250,000/month | ₦450,000/month |
| **SMS (Local provider)** | ₦3,750/month | ₦12,000/month |
| **Email (SendGrid)** | ₦28,000/month | ₦28,000/month |
| **WhatsApp (if added)** | ₦63,000/month | ₦133,000/month |

**Minimum viable monthly infrastructure (hosting + local VOIP + local SMS + email):**

| | Monthly | Annual |
|---|---|---|
| With local VOIP provider | **₦395,250-₦640,500** | **₦4,743,000-₦7,686,000** |
| With Twilio VOIP | **₦700,250-₦1,270,500** | **₦8,403,000-₦15,246,000** |
| Without VOIP (manual call mode) | **₦145,250-₦190,500** | **₦1,743,000-₦2,286,000** |

*All estimates based on 500-2,000 orders/month. Costs scale proportionally with volume.*

---

## 5. Total Cost of Ownership — Year 1

### Scenario 1: Build & Transfer + Manual Call Mode (Minimum Cost)

| Item | Cost |
|---|---|
| Development (one-time) | ₦8,500,000 |
| Infrastructure (12 months, no VOIP) | ₦1,743,000-₦2,286,000 |
| Maintenance | ₦0 (self-managed) |
| **Year 1 Total** | **₦10,243,000-₦10,786,000** |

### Scenario 2: Build, Deploy & Maintain (Standard) + Local VOIP

| Item | Cost |
|---|---|
| Development (one-time) | ₦8,500,000 |
| Infrastructure (12 months, local VOIP) | ₦4,743,000-₦7,686,000 |
| Maintenance — Standard (12 months) | ₦5,400,000 |
| **Year 1 Total** | **₦18,643,000-₦21,586,000** |

### Scenario 3: Build, Deploy & Maintain (Premium) + Twilio VOIP + WhatsApp

| Item | Cost |
|---|---|
| Development (one-time) | ₦8,500,000 |
| Infrastructure (12 months, Twilio + WhatsApp) | ₦9,159,000-₦16,842,000 |
| Maintenance — Premium (12 months) | ₦9,600,000 |
| **Year 1 Total** | **₦27,259,000-₦34,942,000** |

---

## 6. Future Enhancements (Not Included in Current Scope)

These are features that can be added as future phases. Each would be scoped and quoted separately.

| Enhancement | Description | Estimated Effort |
|---|---|---|
| **WhatsApp Automation** | Automated order confirmations, delivery tracking, follow-up messages via WhatsApp Business API | 2-3 weeks |
| **Email Automation** | Automated email sequences (order confirmation, delivery update, review request, re-engagement) | 1-2 weeks |
| **SMS Automation** | OTP delivery, status updates, marketing campaigns via local SMS provider | 1 week |
| **AI Call Transcription** | Automatic transcription of VOIP calls for quality monitoring | 1-2 weeks |
| **Mobile App** | Native iOS/Android app for riders (beyond PWA capabilities) | 4-6 weeks |
| **Multi-Currency Support** | Support for USD, GBP alongside NGN | 1-2 weeks |
| **Customer Portal** | Self-service tracking for customers (order status, delivery ETA) | 2-3 weeks |
| **Advanced Analytics** | Custom dashboards, data visualization, predictive metrics | 2-4 weeks |
| **Multi-Warehouse** | Support for multiple main warehouses across regions | 2-3 weeks |
| **API for Partners** | REST API access for external partners and integrations | 1-2 weeks |

Enhancement pricing is based on the active maintenance tier:
- **No maintenance contract:** Quoted per project at standard rates
- **Standard tier clients:** 15% discount on enhancement projects
- **Premium tier clients:** Enhancements up to 50 hours/month are included in the retainer

---

## 7. Payment Terms

| Milestone | Amount | Trigger |
|---|---|---|
| Contract Signing | 50% of development fee (₦4,250,000) | Upon signed agreement |
| Discovery Complete | — | End of month 1 |
| UAT Approval | 40% of development fee (₦3,400,000) | Client signs off on User Acceptance Testing |
| Go-Live | 10% of development fee (₦850,000) | Production deployment confirmed |
| Monthly Maintenance | Per tier selected | Billed monthly, 30-day notice to cancel |

**Infrastructure costs** are set up during deployment — Yannis creates and owns all provider accounts (Cloudflare, hosting, Twilio, etc.). Rogue DevTech assists with setup and configuration at no additional charge.

---

## 8. What Happens to the Source Code?

Regardless of which option you choose:

- **Full source code** is transferred to a repository owned by Yannis
- **All documentation** (technical guides, runbooks, architecture decisions) is included
- **Database schema and migrations** are included
- **No vendor lock-in** — the system runs on standard open-source technologies (PostgreSQL, Node.js, React). Any competent development team can maintain it

If you choose Option C (Maintain), we continue to manage the codebase from your repository. If you cancel maintenance, you still own everything.

---

## 9. Why Rogue Developer Technologies

- **Built for accountability** — every feature in EOSE exists to protect Yannis's revenue, data, and operations
- **Deep understanding of your business** — we didn't build a generic tool, we built YOUR tool based on how your CS, logistics, marketing, finance, and HR teams actually work
- **Transparent pricing** — infrastructure costs are pass-through, not marked up
- **No vendor lock-in** — you own the code, the accounts, and the data from day one
- **Proven architecture** — the demo system has all 7 modules functioning end-to-end

---

**Rogue Developer Technologies Limited**
*Enterprise software that protects revenue, enforces accountability, and scales under pressure.*

**Contact:** [Your Contact Information]
**Website:** [Your Website]
