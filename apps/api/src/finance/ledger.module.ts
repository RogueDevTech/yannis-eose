import { Module } from '@nestjs/common';
import { GeneralLedgerService } from './general-ledger.service';
import { AssetRegisterService } from './asset-register.service';
import { ExpenseSubmissionService } from './expense-submission.service';
import { BankReconciliationService } from './bank-reconciliation.service';

/**
 * LedgerModule — the double-entry accounting engine (Phase 1). Kept separate
 * from FinanceModule so later-phase services (invoicing, agent payments) can
 * import the ledger poster cleanly.
 */
@Module({
  providers: [GeneralLedgerService, AssetRegisterService, ExpenseSubmissionService, BankReconciliationService],
  exports: [GeneralLedgerService, AssetRegisterService, ExpenseSubmissionService, BankReconciliationService],
})
export class LedgerModule {}
