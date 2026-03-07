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
  resetPasswordSchema,
  processEmailChangeSchema,
} from './users';

export type {
  SetupSuperAdminInput,
  UserCompensationInput,
  CreateStaffInput,
  UpdateStaffInput,
  ListUsersInput,
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
  listFundingRequestsSchema,
  approveFundingRequestSchema,
  rejectFundingRequestSchema,
  getFundingBalanceSchema,
  createAdSpendSchema,
  listAdSpendSchema,
  approveAdSpendSchema,
  createOfferTemplateSchema,
  updateOfferTemplateSchema,
  listOfferTemplatesSchema,
  createCampaignSchema,
  updateCampaignSchema,
  listCampaignsSchema,
} from './marketing';

export type {
  CreateFundingInput,
  VerifyFundingInput,
  ListFundingInput,
  ListFundingRequestsInput,
  ApproveFundingRequestInput,
  RejectFundingRequestInput,
  GetFundingBalanceInput,
  CreateAdSpendInput,
  ListAdSpendInput,
  ApproveAdSpendInput,
  CreateOfferTemplateInput,
  UpdateOfferTemplateInput,
  ListOfferTemplatesInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  ListCampaignsInput,
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
} from './hr';
