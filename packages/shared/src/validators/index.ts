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
  transitionOrderSchema,
  updateOrderSchema,
  requestOrderLinePriceChangeSchema,
  requestOrderDeletionSchema,
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
  TransitionOrderInput,
  UpdateOrderInput,
  RequestOrderLinePriceChangeInput,
  RequestOrderDeletionInput,
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
  PROBATION_INELIGIBLE_ROLES,
  isRoleProbationEligible,
  DEFAULT_PROBATION_DAYS,
  defaultProbationUntilFromNow,
  setProbationSchema,
  extendProbationSchema,
  markProbationPermanentSchema,
  terminateProbationSchema,
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
  SetProbationInput,
  ExtendProbationInput,
  MarkProbationPermanentInput,
  TerminateProbationInput,
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
} from './products';

export type {
  ProductOffer,
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
  RequestProductArchiveInput,
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
  listAdSpendSchema,
  listAdSpendGroupedSchema,
  adSpendStatusCountsSchema,
  approveAdSpendSchema,
  rejectAdSpendSchema,
  updateAdSpendSchema,
  previewAdSpendIntervalSchema,
  campaignOrderTotalForBatchSchema,
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
  customFormFieldSchema,
  formConfigSchema,
  getMissingRequiredCustomFormLabels,
  FORM_FIELD_TYPES,
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
  CustomFormField,
  FormConfig,
  FormFieldType,
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
} from './finance';

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
