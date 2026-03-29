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
  showPaymentMethod?: boolean | string;
  deliveryStateOptions?: string[];
  preferredDeliveryDateOptions?: string[];
}

export interface Campaign {
  id: string;
  mediaBuyerId: string;
  name: string;
  productIds: string[] | null;
  deploymentType: string;
  formConfig: CampaignFormConfig | null;
  status: string;
  createdAt: string;
  /** Resolved in list when available (HoM/SuperAdmin). */
  mediaBuyerName?: string | null;
}

export interface Product {
  id: string;
  name: string;
  baseSalePrice: string;
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
}
