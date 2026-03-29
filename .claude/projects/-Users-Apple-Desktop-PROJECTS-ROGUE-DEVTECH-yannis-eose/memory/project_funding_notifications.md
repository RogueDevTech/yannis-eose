---
name: Funding request notification routing
description: Who gets notified when a funding request is submitted — Media Buyer vs HoM have different audiences
type: project
---

Media Buyer requests funding → HEAD_OF_MARKETING only (they are the one who funds Media Buyers).
Head of Marketing requests funding → SUPER_ADMIN + FINANCE_OFFICER only (Finance must disburse).
Funding disputed (Not Received) → SUPER_ADMIN + HEAD_OF_MARKETING.

**Why:** SuperAdmin and Finance are NOT involved in Media Buyer funding — that is an internal marketing team matter handled by HoM. SuperAdmin/Finance only get involved when HoM itself needs a budget disbursement.

**How to apply:** In `marketing.service.ts → createFundingRequest()`, the `if (requesterRole === 'HEAD_OF_MARKETING')` branch notifies SuperAdmin + Finance; the `else` branch notifies HoM only. Never add SuperAdmin/Finance to the Media Buyer branch.
