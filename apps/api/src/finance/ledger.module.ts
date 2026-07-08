import { Module } from '@nestjs/common';
import { GeneralLedgerService } from './general-ledger.service';
import { AssetRegisterService } from './asset-register.service';

/**
 * LedgerModule — the double-entry accounting engine (Phase 1). Kept separate
 * from FinanceModule so later-phase services (invoicing, agent payments) can
 * import the ledger poster cleanly.
 */
@Module({
  providers: [GeneralLedgerService, AssetRegisterService],
  exports: [GeneralLedgerService, AssetRegisterService],
})
export class LedgerModule {}
