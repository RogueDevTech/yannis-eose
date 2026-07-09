import { PageHeader } from '~/components/ui/page-header';
import { OrdersImportPage, type OrdersImportPageProps } from '~/features/orders/OrdersImportPage';

export interface ImportPageProps extends OrdersImportPageProps {}

export function ImportPage(props: ImportPageProps) {
  return (
    <div>
      <PageHeader
        title="Import"
        description="Migrate orders from a former CRM."
        backTo="/admin"
      />
      <div className="mt-4">
        <OrdersImportPage {...props} />
      </div>
    </div>
  );
}
