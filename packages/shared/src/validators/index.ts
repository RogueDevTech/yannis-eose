// ============================================
// Yannis EOSE — Shared Zod Validators
// ============================================

export { z } from 'zod';

// Order validators
export {
  EDGE_FORM_ACTOR_ID,
  SYSTEM_ACTOR_ID,
  orderStatusSchema,
  orderItemSchema,
  createOrderSchema,
  createOfflineOrderSchema,
  importOrderSchema,
  transitionOrderSchema,
  updateOrderSchema,
  requestOrderLinePriceChangeSchema,
  requestOrderDeletionSchema,
  requestDeliveredOrderDeletionSchema,
  requestOrderRetrackSchema,
  softDeleteOrderSchema,
  assignOrderSchema,
  bulkReassignSchema,
  listOrdersSchema,
  listOrdersScheduleKindSchema,
  scheduleCalendarHeatSchema,
} from './orders';

export { saveCartSchema } from './cart';
export type { SaveCartInput } from './cart';

export type {
  OrderStatusInput,
  CreateOrderInput,
  CreateOfflineOrderInput,
  ImportOrderInput,
  TransitionOrderInput,
  UpdateOrderInput,
  RequestOrderLinePriceChangeInput,
  RequestOrderDeletionInput,
  RequestDeliveredOrderDeletionInput,
  SoftDeleteOrderInput,
  AssignOrderInput,
  BulkReassignInput,
  ListOrdersInput,
  ListOrdersScheduleKind,
  ScheduleCalendarHeatInput,
} from './orders';

export {
  csRoutingStrategySchema,
  csRoutingRuleTargetInputSchema,
  createCsRoutingRuleSchema,
  updateCsRoutingRuleSchema,
  deleteCsRoutingRuleSchema,
  listCsRoutingRulesSchema,
  csRoutingRelationshipModeSchema,
  getCsRoutingBranchSettingsSchema,
  setCsRoutingRelationshipModeSchema,
} from './cs-order-routing';

export type {
  CreateCsRoutingRuleInput,
  UpdateCsRoutingRuleInput,
  CsRoutingRelationshipMode,
  SetCsRoutingRelationshipModeInput,
} from './cs-order-routing';

export {
  followUpRuleSourceStatuses,
  createFollowUpRuleSchema,
  updateFollowUpRuleSchema,
  deleteFollowUpRuleSchema,
  listFollowUpRulesSchema,
  listFollowUpSyncLogsSchema,
  listFollowUpOrdersSchema,
  followUpOrderDetailSchema,
  assignFollowUpOrderSchema,
  bulkAssignFollowUpOrdersSchema,
  transitionFollowUpOrderSchema,
} from './follow-up-config';

export type {
  CreateFollowUpRuleInput,
  UpdateFollowUpRuleInput,
  ListFollowUpOrdersInput,
} from './follow-up-config';

// User validators
export {
  userRoleSchema,
  visibleOrderStatusSchema,
  setupSuperAdminSchema,
  userCompensationSchema,
  createStaffSchema,
  updateStaffSchema,
  listUsersSchema,
  usersRosterSummarySchema,
  searchUsersForPushTargetSchema,
  resetPasswordSchema,
  processEmailChangeSchema,
} from './users';

export type {
  SetupSuperAdminInput,
  UserCompensationInput,
  CreateStaffInput,
  UpdateStaffInput,
  ListUsersInput,
  ListUsersRosterSummaryInput,
  SearchUsersForPushTargetInput,
  ResetPasswordInput,
  ProcessEmailChangeInput,
} from './users';

// Product validators
export {
  MAX_OFFER_TIER_IMAGES,
  MAX_PRODUCT_GALLERY_IMAGES,
  MAX_PRODUCT_OFFER_IMAGES,
  galleryImageUrlsSchema,
  productOfferSchema,
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
  requestProductArchiveSchema,
  setBundleComponentsSchema,
  bundleComponentSchema,
} from './products';

export type {
  ProductOffer,
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
  RequestProductArchiveInput,
  SetBundleComponentsInput,
} from './products';

// Product category validators
export {
  createProductCategorySchema,
  updateProductCategorySchema,
  listProductCategoriesSchema,
} from './product-categories';

export type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  ListProductCategoriesInput,
} from './product-categories';

// Inventory validators
export {
  stockIntakeSchema,
  stockTransferSchema,
  stockTransferBatchSchema,
  verifyTransferSchema,
  approveTransferSchema,
  rejectTransferSchema,
  stockAdjustmentSchema,
  listInventorySchema,
  listMovementsSchema,
  createReconciliationSchema,
  resolveReconciliationSchema,
  shipmentStatusSchema,
  createShipmentSchema,
  updateShipmentLinesSchema,
  shipmentTransitionSchema,
  verifyShipmentSchema,
  cancelShipmentSchema,
  listShipmentsSchema,
  getShipmentSchema,
  createWarehouseSchema,
  updateWarehouseSchema,
  listWarehousesSchema,
} from './inventory';

export type {
  StockIntakeInput,
  StockTransferInput,
  StockTransferBatchInput,
  VerifyTransferInput,
  ApproveTransferInput,
  RejectTransferInput,
  StockAdjustmentInput,
  ListInventoryInput,
  ListMovementsInput,
  CreateReconciliationInput,
  ResolveReconciliationInput,
  ShipmentStatus,
  CreateShipmentInput,
  UpdateShipmentLinesInput,
  ShipmentTransitionInput,
  VerifyShipmentInput,
  CancelShipmentInput,
  ListShipmentsInput,
  GetShipmentInput,
  CreateWarehouseInput,
  UpdateWarehouseInput,
  ListWarehousesInput,
} from './inventory';

// Logistics validators
export {
  createProviderSchema,
  updateProviderSchema,
  listProvidersSchema,
  createLocationSchema,
  updateLocationSchema,
  listLocationsSchema,
  createRemittanceSchema,
  listRemittancesSchema,
  markRemittanceReceivedSchema,
  submitDeliveryConfirmationSchema,
  listDeliveryConfirmationRequestsSchema,
  approveDeliveryConfirmationSchema,
  rejectDeliveryConfirmationSchema,
  createDeliveryRemittanceSchema,
  updateDeliveryRemittanceSchema,
  listDeliveryRemittancesSchema,
  listDeliveryRemittanceEligibleOrdersSchema,
  markDeliveryRemittanceReceivedSchema,
  getDeliveryRemittanceSchema,
  disputeDeliveryRemittanceSchema,
} from './logistics';

export type {
  CreateProviderInput,
  UpdateProviderInput,
  ListProvidersInput,
  CreateLocationInput,
  UpdateLocationInput,
  ListLocationsInput,
  CreateRemittanceInput,
  ListRemittancesInput,
  MarkRemittanceReceivedInput,
  SubmitDeliveryConfirmationInput,
  ListDeliveryConfirmationRequestsInput,
  ApproveDeliveryConfirmationInput,
  RejectDeliveryConfirmationInput,
  CreateDeliveryRemittanceInput,
  UpdateDeliveryRemittanceInput,
  ListDeliveryRemittancesInput,
  ListDeliveryRemittanceEligibleOrdersInput,
  MarkDeliveryRemittanceReceivedInput,
  GetDeliveryRemittanceInput,
  DisputeDeliveryRemittanceInput,
} from './logistics';

// Marketing validators
export {
  createFundingSchema,
  verifyFundingSchema,
  listFundingSchema,
  fundingStatusCountsSchema,
  fundingRequestStatusCountsSchema,
  fundingDirectionSummarySchema,
  listFundingRequestsSchema,
  approveFundingRequestSchema,
  rejectFundingRequestSchema,
  getFundingBalanceSchema,
  createAdSpendSchema,
  createAdSpendWithBranchSchema,
  createAdSpendLogFormSchema,
  createAdSpendBatchSchema,
  createAdSpendBatchWithBranchSchema,
  adPlatformSchema,
  adPlatformValues,
  expenseCategorySchema,
  expenseCategoryValues,
  listAdSpendSchema,
  listAdSpendGroupedSchema,
  adSpendStatusCountsSchema,
  approveAdSpendSchema,
  rejectAdSpendSchema,
  updateAdSpendSchema,
  previewAdSpendIntervalSchema,
  campaignOrderTotalForBatchSchema,
  logDailyAdSpendSchema,
  logDailyAdSpendWithBranchSchema,
  updateDailyAdSpendSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  archiveAllOfferTemplatesForProductSchema,
  createOfferGroupSchema,
  updateOfferGroupSchema,
  listOfferGroupsSchema,
  getOfferGroupSchema,
  clearLegacyOfferTemplatesSchema,
  createCampaignSchema,
  createCampaignProcedureSchema,
  updateCampaignSchema,
  listCampaignsSchema,
  fundingLedgerSchema,
  customFormFieldSchema,
  formConfigSchema,
  getMissingRequiredCustomFormLabels,
  FORM_FIELD_TYPES,
  createMbFundTransferSchema,
  approveMbFundTransferSchema,
  rejectMbFundTransferSchema,
  acceptMbFundTransferSchema,
  listMbFundTransfersSchema,
} from './marketing';

export type {
  CreateFundingInput,
  VerifyFundingInput,
  ListFundingInput,
  FundingStatusCountsInput,
  FundingRequestStatusCountsInput,
  FundingDirectionSummaryInput,
  ListFundingRequestsInput,
  ApproveFundingRequestInput,
  RejectFundingRequestInput,
  GetFundingBalanceInput,
  CreateAdSpendInput,
  CreateAdSpendLogFormInput,
  CreateAdSpendBatchInput,
  AdPlatform,
  ListAdSpendInput,
  ListAdSpendGroupedInput,
  AdSpendStatusCountsInput,
  ApproveAdSpendInput,
  RejectAdSpendInput,
  UpdateAdSpendInput,
  PreviewAdSpendIntervalInput,
  CampaignOrderTotalForBatchInput,
  LogDailyAdSpendInput,
  UpdateDailyAdSpendInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  ArchiveAllOfferTemplatesForProductInput,
  CreateOfferGroupInput,
  UpdateOfferGroupInput,
  ListOfferGroupsInput,
  GetOfferGroupInput,
  ClearLegacyOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
  FundingLedgerInput,
  CustomFormField,
  FormConfig,
  FormFieldType,
  CreateMbFundTransferInput,
  ListMbFundTransfersInput,
} from './marketing';

// Finance validators
export {
  updateInvoiceStatusSchema,
  listInvoicesSchema,
  createApprovalRequestSchema,
  processApprovalSchema,
  listApprovalRequestsSchema,
  setBudgetSchema,
  profitReportSchema,
  profitByShipmentSchema,
  generalLedgerSchema,
} from './finance';

export type {
  UpdateInvoiceStatusInput,
  ListInvoicesInput,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  ListApprovalRequestsInput,
  SetBudgetInput,
  ProfitReportInput,
  ProfitByShipmentInput,
  ProductProfitBreakdownRow,
  GeneralLedgerInput,
} from './finance';

// Double-entry general ledger validators (Phase 1)
export {
  glLineSchema,
  createJournalEntrySchema,
  listJournalEntriesSchema,
  getJournalEntrySchema,
  reverseJournalEntrySchema,
  listAccountsSchema,
  createAccountSchema,
  listFiscalYearsSchema,
  createFiscalYearSchema,
  closeFiscalYearSchema,
  reopenFiscalYearSchema,
  approveJournalEntrySchema,
  trialBalanceSchema,
  seedChartOfAccountsSchema,
  profitAndLossSchema,
  balanceSheetSchema,
  cashFlowSchema,
  agingSchema,
  openingBalanceLineSchema,
  postOpeningBalancesSchema,
  financialKPIsSchema,
} from './general-ledger';

export type {
  GlLineInput,
  CreateJournalEntryInput,
  ListJournalEntriesInput,
  GetJournalEntryInput,
  ReverseJournalEntryInput,
  ListAccountsInput,
  CreateAccountInput,
  ListFiscalYearsInput,
  CreateFiscalYearInput,
  CloseFiscalYearInput,
  ReopenFiscalYearInput,
  ApproveJournalEntryInput,
  TrialBalanceInput,
  SeedChartOfAccountsInput,
  ProfitAndLossInput,
  BalanceSheetInput,
  CashFlowInput,
  AgingInput,
  OpeningBalanceLineInput,
  PostOpeningBalancesInput,
  FinancialKPIsInput,
  FinancialKPIs,
} from './general-ledger';

// Asset register validators (Phase 4A)
export {
  createAssetSchema,
  listAssetsSchema,
  getAssetSchema,
  disposeAssetSchema,
  runDepreciationSchema,
} from './asset-register';

export type {
  CreateAssetInput,
  ListAssetsInput,
  GetAssetInput,
  DisposeAssetInput,
  RunDepreciationInput,
} from './asset-register';

// Notification validators
export {
  listNotificationsSchema,
  markNotificationsReadSchema,
  createNotificationSchema,
  notificationPreferencesSchema,
  updateMyNotificationPreferencesSchema,
} from './notifications';

export type {
  ListNotificationsInput,
  MarkNotificationsReadInput,
  CreateNotificationInput,
  NotificationPreferences,
  UpdateMyNotificationPreferencesInput,
} from './notifications';

// System settings validators
export {
  updateSystemSettingSchema,
  notificationEmailConfigSchema,
} from './settings';

export type {
  UpdateSystemSettingInput,
  NotificationEmailConfig,
} from './settings';

// UI / client config
export {
  APP_THEME_IDS,
  appThemeIdSchema,
  CLIENT_UI_CONFIG_KEY,
  clientUiConfigSchema,
  updateMyAppThemeSchema,
  updateClientUiConfigSchema,
  FONT_SCALE_IDS,
  fontScaleIdSchema,
  updateMyFontScaleSchema,
} from './ui';

export type { AppThemeId, ClientUiConfig, UpdateMyAppThemeInput, FontScaleId, UpdateMyFontScaleInput } from './ui';

// Reports / Export validators
export {
  exportReportKeySchema,
  exportDatePresetSchema,
  exportDateRangeSchema,
  reportColumnsByKey,
  exportReportSchema,
} from './reports';

export type {
  ExportReportKey,
  ExportDatePreset,
  ExportDateRange,
  ExportReportInput,
} from './reports';

// HR & Payroll validators
export {
  commissionRulesSchema,
  commissionOrderRateTierSchema,
  createCommissionPlanSchema,
  updateCommissionPlanSchema,
  listCommissionPlansSchema,
  generatePayoutsSchema,
  approvePayoutSchema,
  listPayoutsSchema,
  createAdjustmentSchema,
  approveAdjustmentSchema,
  setSettlementConfigSchema,
  payrollDepartmentSchema,
  payrollBatchStatusSchema,
  generateBatchSchema,
  generateBatchesBulkSchema,
  submitBatchSchema,
  approveBatchSchema,
  rejectBatchSchema,
  markBatchPaidSchema,
  listMonthlyPayrollsSchema,
  getBatchSchema,
  addBatchAdjustmentSchema,
} from './hr';

export type {
  CommissionRules,
  CreateCommissionPlanInput,
  UpdateCommissionPlanInput,
  ListCommissionPlansInput,
  GeneratePayoutsInput,
  ApprovePayoutInput,
  ListPayoutsInput,
  CreateAdjustmentInput,
  ApproveAdjustmentInput,
  SetSettlementConfigInput,
  PayrollDepartment,
  PayrollBatchStatus,
  GenerateBatchInput,
  GenerateBatchesBulkInput,
  SubmitBatchInput,
  ApproveBatchInput,
  RejectBatchInput,
  MarkBatchPaidInput,
  ListMonthlyPayrollsInput,
  GetBatchInput,
  AddBatchAdjustmentInput,
} from './hr';

// Staff Onboarding validators
export {
  onboardingStatusSchema,
  staffGenderSchema,
  updateOnboardingProfileSchema,
  hrUpdateOnboardingSchema,
  submitOnboardingSchema,
  approveOnboardingSchema,
  requestOnboardingChangesSchema,
  getOnboardingSchema,
  staffOnboardingDocumentsFilterStatusSchema,
  listStaffOnboardingDocumentsSchema,
} from './staff-onboarding';

export type {
  OnboardingStatus,
  StaffGender,
  SupportingDocument,
  UpdateOnboardingProfileInput,
  HrUpdateOnboardingInput,
  SubmitOnboardingInput,
  ApproveOnboardingInput,
  RequestOnboardingChangesInput,
  GetOnboardingInput,
  ListStaffOnboardingDocumentsInput,
} from './staff-onboarding';

// Push Notification Center validators
export {
  savePushSubscriptionSchema,
  removePushSubscriptionSchema,
  updatePushInstallModeSchema,
  pushInstallModeSchema,
  broadcastPushSchema,
  getPushDeliveryLogSchema,
  resendPushSchema,
  bulkResendPushSchema,
  pushAckSchema,
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
  toggleAutomationRuleSchema,
} from './push';

// Cart Orders validators
export {
  listCartOrdersSchema,
  cartOrderDetailSchema,
  assignCartOrderSchema,
  bulkAssignCartOrdersSchema,
  transitionCartOrderSchema,
  updateCartOrderSchema,
  createCartOrderRoutingRuleSchema,
  updateCartOrderRoutingRuleSchema,
  deleteCartOrderRoutingRuleSchema,
  listCartOrderRoutingRulesSchema,
  listCartOrderSyncLogsSchema,
} from './cart-orders';

export type {
  ListCartOrdersInput,
  AssignCartOrderInput,
  BulkAssignCartOrdersInput,
  TransitionCartOrderInput,
  UpdateCartOrderInput,
  CreateCartOrderRoutingRuleInput,
  UpdateCartOrderRoutingRuleInput,
  ListCartOrderRoutingRulesInput,
} from './cart-orders';

// Expense submission validators (Phase 4B)
export {
  submitExpenseSchema,
  approveExpenseSchema,
  rejectExpenseSchema,
  listExpensesSchema,
  getExpenseSchema,
} from './expense-submissions';

export type {
  SubmitExpenseInput,
  ApproveExpenseInput,
  RejectExpenseInput,
  ListExpensesInput,
  GetExpenseInput,
} from './expense-submissions';

// WHT deductions / Budget vs Actual / VAT return / Consolidated report validators (Phase 6)
export {
  recordWhtSchema,
  listWhtSchema,
  generateWhtCertificateSchema,
  budgetVsActualSchema,
  vatReturnSummarySchema,
  consolidatedPLSchema,
  consolidatedBSSchema,
  consolidatedCFSchema,
} from './wht-deductions';

export type {
  RecordWhtInput,
  ListWhtInput,
  GenerateWhtCertificateInput,
  BudgetVsActualInput,
  BudgetVsActualRow,
  VatReturnSummaryInput,
  VatReturnSummary,
  VatTransaction,
  ConsolidatedPLInput,
  ConsolidatedBSInput,
  ConsolidatedCFInput,
} from './wht-deductions';

// Bank reconciliation validators (Phase 6D)
export {
  createReconciliationSchema as createBankReconciliationSchema,
  matchLineSchema,
  unmatchLineSchema,
  completeReconciliationSchema as completeBankReconciliationSchema,
  listReconciliationsSchema as listBankReconciliationsSchema,
  getReconciliationSchema as getBankReconciliationSchema,
} from './bank-reconciliation';

export type {
  CreateReconciliationInput as CreateBankReconciliationInput,
  MatchLineInput,
  UnmatchLineInput,
  CompleteReconciliationInput as CompleteBankReconciliationInput,
  ListReconciliationsInput as ListBankReconciliationsInput,
  GetReconciliationInput as GetBankReconciliationInput,
} from './bank-reconciliation';

// User filter preferences validators
export {
  pageKeySchema,
  filterValueSchema,
  upsertFilterPreferenceSchema,
  deleteFilterPreferenceSchema,
  getFilterPreferenceSchema,
} from './user-filter-preferences';

export type {
  UpsertFilterPreferenceInput,
  DeleteFilterPreferenceInput,
  GetFilterPreferenceInput,
} from './user-filter-preferences';

export type {
  SavePushSubscriptionInput,
  RemovePushSubscriptionInput,
  UpdatePushInstallModeInput,
  PushInstallMode,
  BroadcastPushInput,
  GetPushDeliveryLogInput,
  ResendPushInput,
  BulkResendPushInput,
  PushAckInput,
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
  ToggleAutomationRuleInput,
} from './push';
