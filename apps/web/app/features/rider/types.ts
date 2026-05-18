export interface Order {
  id: string;
  customerName: string;
  customerPhoneDisplay: string;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  totalAmount: string | null;
  status: string;
  items: unknown;
}
