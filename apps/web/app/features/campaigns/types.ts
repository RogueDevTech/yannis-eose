export interface Campaign {
  id: string;
  mediaBuyerId: string;
  name: string;
  productIds: string[] | null;
  deploymentType: string;
  formConfig: Record<string, string> | null;
  status: string;
  createdAt: string;
}

export interface Product {
  id: string;
  name: string;
  baseSalePrice: string;
}

export interface FormsPageProps {
  forms: Campaign[];
  totalForms: number;
  products: Promise<Product[]>;
}

/** Streaming-aware loader shape for the forms route */
export interface FormsStreamData {
  forms: Campaign[];
  totalForms: number;
  products: Promise<Product[]>;
}
