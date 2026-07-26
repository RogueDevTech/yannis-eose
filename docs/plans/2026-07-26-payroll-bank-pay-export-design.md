# Payroll Bank Pay Export Design

## Goal

Let Finance export a bank-pay document from `/hr/payroll`: pick batches, choose one PDF or one-PDF-per-batch ZIP, and preview the PDF in a modal before download.

## Approved Direction

1. Toolbar **Export bank pay** on `/hr/payroll` (Finance / `finance.disburse` / admin-class).
2. Picker modal: tick batches from the current list (only `PENDING_FINANCE` and `PAID` selectable).
3. Mode: **One file** (single combined PDF) or **By batch** (ZIP of per-batch PDFs).
4. Preview opens invoice-style PDF modal; Download PDF or Download ZIP from there.
5. API: `hr.exportBankUpload` accepts `batchIds[]` and returns `{ batches: [...] }` with bank lines (finance-gated).

## Data

Per line: beneficiary name, account number, bank code/name, net amount, reference, staff name, pay role.

## Verification

- Non-finance users do not see the button.
- Draft / Pending HR batches cannot be selected.
- Preview matches downloaded PDF content.
- One-file mode merges selected batches; by-batch mode produces a ZIP.
