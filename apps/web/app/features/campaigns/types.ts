/** Field types supported by the campaign form editor. Mirrors `FORM_FIELD_TYPES` in the shared
 *  validators; kept duplicated here to avoid pulling validator types into the UI bundle. */
export type CustomFormFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'radio'
  | 'checkbox_group'
  | 'toggle';

/** A single custom field on the campaign's public form. Configured in create / edit form UI. */
export interface CustomFormField {
  id: string;
  type: CustomFormFieldType;
  label: string;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  /** Sort order — 0-indexed. Builder + renderer both honour ascending. */
  order: number;
  /** Options for dropdown / radio / checkbox_group. Ignored for other types. */
  options?: string[];
  /** Length / value bounds. text/textarea = char length, number = value, date = ISO yyyy-mm-dd. */
  min?: number | string;
  max?: number | string;
}

export type StandardFieldKey =
  | 'deliveryAddress'
  | 'deliveryNotes'
  | 'deliveryState'
  | 'gender'
  | 'preferredDeliveryDate'
  | 'customerEmail'
  | 'paymentMethod';

export interface StandardFieldConfig {
  key: StandardFieldKey;
  required: boolean;
}

export interface CampaignFormConfig {
  heading?: string;
  subtitle?: string;
  buttonText?: string;
  accentColor?: string;
  successMessage?: string;
  showDeliveryAddress?: boolean | string;
  showDeliveryNotes?: boolean | string;
  showDeliveryState?: boolean | string;
  showGender?: boolean | string;
  showPreferredDeliveryDate?: boolean | string;
  showCustomerEmail?: boolean | string;
  showPaymentMethod?: boolean | string;
  showProductImages?: boolean | string;
  requireDeliveryAddress?: boolean | string;
  requireDeliveryNotes?: boolean | string;
  requireDeliveryState?: boolean | string;
  requireGender?: boolean | string;
  requirePreferredDeliveryDate?: boolean | string;
  requireCustomerEmail?: boolean | string;
  requirePaymentMethod?: boolean | string;
  deliveryStateOptions?: string[];
  preferredDeliveryDateOptions?: string[];
  /** Dropdown choices for the Gender additional field (defaults: Male, Female). */
  genderOptions?: string[];
  standardFields?: StandardFieldConfig[];
  /** Custom fields the Media Buyer adds to their public form (create / edit). */
  customFields?: CustomFormField[];
  /** Post-submit redirect for the buyer (funnel thank-you page). */
  successCallbackUrl?: string;
  /** When set, limit Edge tiers to this subset of ACTIVE `offer_templates`; empty/omitted = all ACTIVE tiers. */
  selectedOfferTemplateIds?: string[];
}

export interface Campaign {
  id: string;
  mediaBuyerId: string;
  name: string;
  productIds: string[] | null;
  offerGroupId?: string | null;
  deploymentType: string;
  formConfig: CampaignFormConfig | null;
  status: string;
  createdAt: string;
  /** Resolved in list when available (HoM/SuperAdmin). */
  mediaBuyerName?: string | null;
}

/** Offer tier from `products.offers` (matches Edge / `products.list`). */
export interface ProductOfferRow {
  label: string;
  qty: number;
  price: string | number;
  /** Tier thumbnails (`offer_templates.image_urls`); first https URL shown when enabled. */
  imageUrls?: string[];
}

export interface Product {
  id: string;
  name: string;
  baseSalePrice: string;
  galleryImageUrls?: string[];
  /** When omitted or empty, the hosted preview hides the offer picker until product data loads. */
  offers?: ProductOfferRow[];
}

/** One row from `marketing.listOfferTemplates` (join to product name) for the Offers hub. */
export interface OfferTemplateListRow {
  id: string;
  productId: string;
  productName: string;
  name: string;
  quantity: number;
  price: string | number;
  status: string;
  imageUrls?: string[];
}

export interface OfferGroupItemRow {
  id: string;
  offerGroupId: string;
  productId: string;
  productName: string;
  label: string;
  quantity: number;
  price: string | number;
  imageUrl?: string | null;
  sortOrder: number;
  status: string;
}

export interface OfferGroupRow {
  id: string;
  name: string;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  items: OfferGroupItemRow[];
}

export interface FormsPageProps {
  forms: Campaign[];
  totalForms: number;
  products: Product[];
  /** Set when products.list failed in the loader (empty products + user-visible hint). */
  productsLoadError?: string | null;
  /** True when the current user is a Media Buyer (sees only their forms). */
  isMediaBuyer?: boolean;
  /** Show Media buyer column (HoM and SuperAdmin only). */
  showMediaBuyerColumn?: boolean;
  /** Current user display name for personalised copy. */
  currentUserName?: string;
  /** When set, list is filtered to this media buyer (for "My forms" filter). */
  mediaBuyerIdFilter?: string;
  /** Current user id (for building "My forms" link). */
  currentUserId?: string;
  /** `marketing.offerTemplate` — Offers tab tier CRUD. */
  canManageOfferTemplates?: boolean;
  /** All catalog offer packages (reusable on forms that attach the same product). */
  allOfferTemplates?: OfferTemplateListRow[];
  offersListLoadError?: string | null;
  offerGroups?: OfferGroupRow[];
  offerGroupsLoadError?: string | null;
}

/** Streaming-aware loader shape for the forms route */
export interface FormsStreamData {
  forms: Campaign[];
  totalForms: number;
  products: Product[];
  productsLoadError?: string | null;
  isMediaBuyer?: boolean;
  showMediaBuyerColumn?: boolean;
  currentUserId?: string;
  currentUserName?: string;
  mediaBuyerIdFilter?: string;
  canManageOfferTemplates?: boolean;
  allOfferTemplates?: OfferTemplateListRow[];
  offersListLoadError?: string | null;
  offerGroups?: OfferGroupRow[];
  offerGroupsLoadError?: string | null;
}
