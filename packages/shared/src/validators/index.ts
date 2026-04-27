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
  assignOrderSchema,
  bulkReassignSchema,
  listOrdersSchema,
} from './orders';

export { saveCartSchema } from './cart';
export type { SaveCartInput } from './cart';

export type {
  OrderStatusInput,
  CreateOrderInput,
  CreateOfflineOrderInput,
  TransitionOrderInput,
  UpdateOrderInput,
  AssignOrderInput,
  BulkReassignInput,
  ListOrdersInput,
} from './orders';

// User validators
export {
  userRoleSchema,
  visibleOrderStatusSchema,
  setupSuperAdminSchema,
  userCompensationSchema,
  createStaffSchema,
  updateStaffSchema,
  listUsersSchema,
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
  SearchUsersForPushTargetInput,
  ResetPasswordInput,
  ProcessEmailChangeInput,
} from './users';

// Product validators
export {
  productOfferSchema,
  createProductSchema,
  updateProductSchema,
  listProductsSchema,
} from './products';

export type {
  ProductOffer,
  CreateProductInput,
  UpdateProductInput,
  ListProductsInput,
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
  verifyTransferSchema,
  stockAdjustmentSchema,
  listInventorySchema,
  listMovementsSchema,
  createReconciliationSchema,
  resolveReconciliationSchema,
} from './inventory';

export type {
  StockIntakeInput,
  StockTransferInput,
  VerifyTransferInput,
  StockAdjustmentInput,
  ListInventoryInput,
  ListMovementsInput,
  CreateReconciliationInput,
  ResolveReconciliationInput,
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
  createAdSpendLogFormSchema,
  listAdSpendSchema,
  adSpendStatusCountsSchema,
  approveAdSpendSchema,
  rejectAdSpendSchema,
  updateAdSpendSchema,
  previewAdSpendIntervalSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  createCampaignSchema,
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
  ListAdSpendInput,
  AdSpendStatusCountsInput,
  ApproveAdSpendInput,
  RejectAdSpendInput,
  UpdateAdSpendInput,
  PreviewAdSpendIntervalInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
  CustomFormField,
  FormConfig,
  FormFieldType,
} from './marketing';

// Finance validators
export {
  createInvoiceSchema,
  updateInvoiceStatusSchema,
  listInvoicesSchema,
  createApprovalRequestSchema,
  processApprovalSchema,
  listApprovalRequestsSchema,
  setBudgetSchema,
  profitReportSchema,
} from './finance';

export type {
  CreateInvoiceInput,
  UpdateInvoiceStatusInput,
  ListInvoicesInput,
  CreateApprovalRequestInput,
  ProcessApprovalInput,
  ListApprovalRequestsInput,
  SetBudgetInput,
  ProfitReportInput,
} from './finance';

// Notification validators
export {
  listNotificationsSchema,
  markNotificationsReadSchema,
  createNotificationSchema,
} from './notifications';

export type {
  ListNotificationsInput,
  MarkNotificationsReadInput,
  CreateNotificationInput,
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
  submitBatchSchema,
  approveBatchSchema,
  rejectBatchSchema,
  markBatchPaidSchema,
  listMonthlyPayrollsSchema,
  getBatchSchema,
  addBatchAdjustmentSchema,
} from './hr';

export type {
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
  SubmitBatchInput,
  ApproveBatchInput,
  RejectBatchInput,
  MarkBatchPaidInput,
  ListMonthlyPayrollsInput,
  GetBatchInput,
  AddBatchAdjustmentInput,
} from './hr';

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
