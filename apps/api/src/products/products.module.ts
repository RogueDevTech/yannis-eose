import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductCategoriesService } from './product-categories.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  providers: [ProductsService, ProductCategoriesService],
  exports: [ProductsService, ProductCategoriesService],
})
export class ProductsModule {}
