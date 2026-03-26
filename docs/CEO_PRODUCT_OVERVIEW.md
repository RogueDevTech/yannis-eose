# Yannis EOSE — Product Overview

**Prepared by:** Rogue Developer Technologies Limited
**Prepared for:** Yannis Management
**Date:** March 2026
**Document Type:** Executive Product Summary
**Version:** 1.0

---

## 1. What Is Yannis EOSE?

Yannis EOSE (Enterprise Operations & Sales Engine) is a custom-built, enterprise-grade platform designed to replace the legacy "Sniper" tool and solve the critical problems that caused your team to abandon it — downtime during high traffic, no accountability trail, unreliable financials, and zero stock audit capability.

EOSE is not a generic CRM or off-the-shelf ERP. It is a **revenue protection system** built specifically for how Yannis operates — from the moment a customer fills out a sales form, through CS confirmation, logistics dispatch, delivery, and all the way to the final profit calculation and staff payout.

---

## 2. What We Preserved From Sniper

Your team valued Sniper for its smooth operational flow, granular data per order, and quality automations. We kept the spirit of what worked:

- Smooth, fast dashboard experience with real-time updates
- Granular order detail — every touch, every change, every actor visible
- Automated workflows (dispatch, notifications, status transitions)
- Mobile-friendly interface for field agents

---

## 3. What We Fixed (The 4 Pillars)

Every feature in EOSE serves at least one of four non-negotiable pillars:

### Pillar 1: Revenue Insurance — Zero Lost Sales
Sales forms are hosted at the network edge (Cloudflare), not on your main server. If the primary API goes down, orders are automatically buffered and synced when systems recover. Customers always see "Order received!" — never an error page. Riders can mark deliveries offline and sync when back in network coverage.

### Pillar 2: Lead Fortress — No Phone Number Theft
Customer phone numbers are **never visible** to agents in the browser, network tab, or anywhere in the interface. Agents click "Call" and the system connects them through a VOIP bridge (Twilio). They talk to the customer without ever seeing the raw number. Every access to customer data is permanently logged.

### Pillar 3: Financial Truth — Real Profit, Not Estimates
Every product carries a 6-layer cost structure: Factory Cost + Landing Cost + Internal Fulfillment + Delivery Fee + Ad Spend + Commission. The system uses FIFO (First-In, First-Out) batch costing — if Batch A costs ₦5,000/unit and Batch B costs ₦7,000/unit, Batch A is sold first and margins are calculated accordingly. You see **real net cash profit** at any time.

### Pillar 4: Absolute Accountability — Permanent Audit Trail
Every single change to every record — who did it, when, what was the old value, what is the new value — is permanently logged at the database level using PostgreSQL temporal tables. This cannot be bypassed, edited, or deleted by anyone, including the SuperAdmin. You can "time travel" to see the exact state of any record at any point in history.

---

## 4. Core Modules — What's Built

### 4.1 Edge Sales & Order Intake
- High-availability order capture hosted at the network edge
- Automatic duplicate detection (same phone + product within 6 hours)
- Inventory budget cap — forms auto-show "Sold Out" before overselling
- CAPTCHA protection against bots (protects your VOIP budget)
- 3 deployment modes for Media Buyers: embedded snippet, iframe, or hosted link

### 4.2 Customer Service Command Centre
- Weighted auto-dispatch: orders go to the least-loaded agent, not round-robin
- VOIP call bridge: agents call customers without seeing their phone number
- 15-second call gate: "Confirm" button stays disabled until a real conversation happens
- Callback scheduling: "No Answer" auto-reschedules with attempt tracking (max 3 retries)
- Duplicate order review: side-by-side comparison with merge/dismiss options
- Hot Swap: Head of CS can bulk-reassign orders between agents instantly
- Inactivity detection: agents idle > 10 minutes are flagged

### 4.3 Inventory Management
- FIFO batch costing with per-batch landed cost tracking
- Location-aware stock (Main Warehouse, each 3PL hub)
- 10% virtual buffer prevents overselling during traffic spikes
- Ghost stock prevention: dispatch locked when physical count doesn't match digital records
- Stock reconciliation with mandatory reason codes (Damaged, Lost, Expired, Theft)
- Low-stock alerts with automatic notifications

### 4.4 Third-Party Logistics Operations
- Dedicated 3PL partner portal (separate login, simplified dashboard)
- Dual-entry stock transfers: warehouse sends → 3PL verifies received quantity
- Automatic shrinkage alerts when received < sent (with mandatory reason codes)
- Rider mobile dashboard (PWA) with offline delivery confirmation
- GPS + OTP/signature capture for delivery proof
- Local restock: returned items assessed at 3PL, sellable items go back to local stock
- 48-hour escalation for unverified transfers
- Rider disappearance detection for stuck orders

### 4.5 Marketing Governance
- Funding ledger: Head of Marketing sends → Media Buyer verifies receipt (with proof images)
- Disputed funding auto-alerts CEO
- Mandatory ad spend logging with Ads Manager screenshot (no screenshot = no entry)
- Automated metrics: CPA, True ROAS (delivered orders only), Delivery Rate, Conversion Rate
- High CPA warning system with configurable thresholds
- Campaign form builder with 3 deployment modes

### 4.6 Financial Core
- True Profit dashboard with all 6 cost layers broken down
- Centralized approval queue for all financial requests
- Self-approval prevention (Finance Officers cannot approve their own requests)
- Budget tracking per department/campaign with over-budget warnings
- Invoice system with sequential numbering, PDF export, and overdue auto-flagging
- 3PL balance sheet: running tally of what's owed to each logistics partner
- Materialized views for report performance (< 3 seconds for 100k records)

### 4.7 HR & Payroll
- Dynamic commission rules stored as JSON — HR can change rules anytime without developer help
- Configurable settlement windows: Weekly, Bi-weekly, or Monthly
- Commissions follow delivery date, not order creation date
- Clawback engine: returned orders automatically create deductions from future payouts
- Add-on earnings: manual bonuses with Admin approval, shown as distinct line items
- Full payout breakdown: base salary, performance bonus, add-ons, deductions, total

### 4.8 CEO Executive Dashboard
- Single-page command centre with all key metrics
- Revenue, True Profit, Order Pipeline, Team Performance, Stock Health, Marketing Overview
- Critical alerts panel (shrinkage, disputed funding, SLA breaches, high CPA)
- Real-time updates via WebSocket (< 60 seconds staleness)
- Drill-down links to every detailed page

### 4.9 Cross-Cutting Features
- **12 user roles** with database-level access control (not just UI hiding)
- **Real-time dashboards** via WebSocket — no manual refresh needed
- **Global search** (Cmd+K) across orders, products, and users
- **CSV export** on all major tables (orders, finance, HR, inventory, audit)
- **Dark mode** toggle
- **PWA** — installable on mobile, offline capable, push notifications
- **Notification system** — in-app bell + real-time push + Web Push for offline users

---

## 5. Technology Summary

| Layer | Technology | Why |
|---|---|---|
| Frontend | Remix (React) + Tailwind CSS | Fast server-rendered pages, modern responsive UI |
| Backend | NestJS + TypeScript | Enterprise-grade, strictly typed, modular |
| Database | PostgreSQL 18 | Temporal tables, row-level security, industry standard |
| Real-time | Socket.io (WebSockets) | Live dashboard updates without refresh |
| VOIP | Twilio Voice API + WebRTC | Secure click-to-call without exposing phone numbers |
| Edge/CDN | Cloudflare Workers | Order capture survives server outages |
| File Storage | AWS S3 / Cloudflare R2 | Receipts, screenshots, invoices stored securely |
| Mobile | PWA (Progressive Web App) | Works offline, installable, no App Store needed |

---

## 6. User Roles & Access

| Role | What They See |
|---|---|
| **SuperAdmin (CEO)** | Everything — all modules, all data, global audit trail, system settings |
| **Head of Marketing** | Marketing team performance, all campaigns, funding ledger |
| **Media Buyer** | Own campaigns, own orders, own payouts, ad spend log |
| **Head of CS** | CS team performance, all CS orders, Hot Swap interface |
| **CS Agent** | Own assigned orders only, masked phone numbers, VOIP calling |
| **Finance Officer** | All financial data, approval queue, budgets, invoices, cost data |
| **Head of Logistics** | All 3PL partners, transfers, delivery metrics |
| **Warehouse Manager** | Inventory levels, stock movements, transfers |
| **3PL Manager** | Own location only — orders, stock, riders, returns |
| **3PL Rider** | Own assigned deliveries only, mobile-optimized, offline capable |
| **HR Manager** | Staff payouts, commission rules, settlement configuration |

---

## 7. Security Highlights

- **Phone numbers masked everywhere** — agents never see raw numbers
- **Database-level access control** — even if the app has a bug, the database blocks unauthorized access
- **Immutable audit trail** — no one can edit or delete history records
- **Encrypted sessions** — stored in Redis with instant revocation capability
- **Rate limiting** — at both the edge (form submissions) and API level
- **Security headers** — CSP, HSTS, X-Frame-Options, strict CORS

---

## 8. Current Status & Next Steps

### What's Done (97%+)
All 7 core business modules are fully functional with backend logic, API endpoints, and frontend dashboards. The system handles the complete order lifecycle from customer submission to delivery, payout, and financial reporting.

### What Remains (Infrastructure)
| Item | Description | Status |
|---|---|---|
| Multi-CDN Failover | Secondary CDN for form hosting if Cloudflare goes down | Pending (deployment infrastructure) |
| Load Testing | Validate performance under 1,000+ concurrent users | Pending (needs staging environment) |
| Twilio Credentials | Real Twilio account setup for live VOIP calls | Pending (works in simulation mode) |
| Edge Worker Deployment | Cloudflare KV namespace provisioning | Pending (needs Cloudflare account) |

### Feedback-Driven Iteration
This version was built based on the original operational requirements and business flow analysis. We expect and welcome feedback from each department:

- **CS Team**: Workflow adjustments, dispatch rules, UI preferences
- **Logistics Team**: Transfer workflow, rider app experience, delivery proof requirements
- **Marketing Team**: Campaign builder flow, reporting needs, metric definitions
- **Finance Team**: Report formats, approval workflow, invoice templates
- **HR Team**: Commission rule structure, payout display, settlement timing

We will incorporate this feedback during the deployment phase to ensure every team's needs are met before go-live.

---

## 9. How Yannis EOSE Solves Sniper's Failures

| Sniper Problem | EOSE Solution |
|---|---|
| Crashed under concurrent users | Edge-first architecture — orders captured at Cloudflare, not the main server |
| No audit trail | PostgreSQL temporal tables — permanent, immutable, database-level logging |
| Could not do stock audits | FIFO batch costing, location tracking, reconciliation with reason codes |
| Messy financials | 6-layer True Profit formula, column-level security, centralized approval queue |
| Went down during AWS outages | Circuit breaker pattern, PWA offline sync, order buffering in durable queues |
| No accountability | Every action by every user permanently logged with actor, timestamp, old/new values |
| Phone number theft risk | VOIP bridge — agents never see raw numbers, every access is audited |

---

**Prepared by Rogue Developer Technologies Limited**
*Building systems that protect revenue, enforce accountability, and scale under pressure.*
