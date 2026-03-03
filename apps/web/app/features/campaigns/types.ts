export interface OfferTemplate {
  id: string;
  productId: string;
  name: string;
  price: string;
  status: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  mediaBuyerId: string;
  name: string;
  offerTemplateId: string | null;
  productIds: string[] | null;
  deploymentType: string;
  status: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  baseSalePrice: string;
}

export interface CampaignsPageProps {
  templates: OfferTemplate[];
  totalTemplates: number;
  campaigns: Campaign[];
  totalCampaigns: number;
  products: Promise<Product[]>;
}

/** Streaming-aware loader shape for the campaigns route */
export interface CampaignsStreamData {
  templates: OfferTemplate[];
  totalTemplates: number;
  campaigns: Campaign[];
  totalCampaigns: number;
  products: Promise<Product[]>;
}
