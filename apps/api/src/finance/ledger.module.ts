import { Module } from '@nestjs/common';
import { GeneralLedgerService } from './general-ledger.service';

/**
 * LedgerModule — the double-entry accounting engine (Phase 1). Kept separate
 * from FinanceModule so later-phase services (invoicing, agent payments) can
 * import the ledger poster cleanly.
 */
@Module({
  providers: [GeneralLedgerService],
  exports: [GeneralLedgerService],
})
export class LedgerModule {}
