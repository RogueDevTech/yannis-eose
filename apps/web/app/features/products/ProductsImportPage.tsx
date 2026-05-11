/**
 * ProductsImportPage — thin column-config wrapper around `<ImportBulkData>`,
 * mounted at `/admin/products/import`. The import action lives on the products
 * index route (`/admin/products?index` with `intent=importProduct`), so the
 * existing per-row permission gate, RLS, and audit triggers all apply per row.
 */

import { useMemo } from 'react';
import {
  ImportBulkData,
  type ImportColumn,
  importCellInputClass,
} from '~/components/ui/import-bulk-data';
import {
  type CategoryInfo,
  type ParsedRow,
  type ResolvedRow,
  makeEmptyParsedRow,
  pickHeaderValue,
  resolveRow,
} from './products-import-shared';
import { ProductsImportColumnsReference } from './ProductsImportColumnsReference';
import { downloadProductsImportTemplate } from './products-import-template';

interface ProductsImportPageProps {
  categories: CategoryInfo[];
}

export function ProductsImportPage({ categories }: ProductsImportPageProps) {
  const columns: ImportColumn<ResolvedRow>[] = useMemo(
    () => [
      {
        header: 'Name',
        headerClassName: 'min-w-[12rem]',
        errorTokens: ['name must be'],
        errorLabel: 'Name',
        getDisplayValue: (row) => row.name,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.name}
            onChange={(e) => patch({ name: e.target.value } as Partial<ResolvedRow>)}
            disabled={disabled}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Base price',
        headerClassName: 'min-w-[7rem]',
        errorTokens: ['base price must be'],
        errorLabel: 'Base price',
        getDisplayValue: (row) => row.basePriceInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            inputMode="decimal"
            value={row.basePriceInput}
            onChange={(e) =>
              patch({ basePriceInput: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="30000"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Cost price',
        headerClassName: 'min-w-[7rem]',
        errorTokens: ['cost price must be'],
        errorLabel: 'Cost price',
        getDisplayValue: (row) => row.costPriceInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            inputMode="decimal"
            value={row.costPriceInput}
            onChange={(e) =>
              patch({ costPriceInput: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="18000"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
      {
        header: 'Category',
        headerClassName: 'min-w-[10rem]',
        errorTokens: ['unknown category'],
        errorLabel: 'Category',
        getDisplayValue: (row) => row.categoryInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <select
            value={row.categoryId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              const cat = categories.find((c) => c.id === id);
              patch({ categoryInput: cat?.name ?? '' } as Partial<ResolvedRow>);
            }}
            disabled={disabled || categories.length === 0}
            className={importCellInputClass(errored)}
          >
            <option value="">— None —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ),
      },
      {
        header: 'Description',
        headerClassName: 'min-w-[14rem]',
        errorTokens: [],
        errorLabel: 'Description',
        getDisplayValue: (row) => row.description,
        hideErrorInfo: true,
        renderCell: ({ row, disabled, patch }) => (
          <input
            type="text"
            value={row.description}
            onChange={(e) =>
              patch({ description: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            className={importCellInputClass(false)}
          />
        ),
      },
      {
        header: 'Gallery URLs',
        headerClassName: 'min-w-[16rem]',
        errorTokens: ['gallery url'],
        errorLabel: 'Gallery URLs',
        getDisplayValue: (row) => row.galleryUrlsInput,
        renderCell: ({ row, disabled, errored, patch }) => (
          <input
            type="text"
            value={row.galleryUrlsInput}
            onChange={(e) =>
              patch({ galleryUrlsInput: e.target.value } as Partial<ResolvedRow>)
            }
            disabled={disabled}
            placeholder="https://…, https://…"
            aria-invalid={errored || undefined}
            className={importCellInputClass(errored)}
          />
        ),
      },
    ],
    [categories],
  );

  return (
    <ImportBulkData<ParsedRow, ResolvedRow>
      title="Import products"
      description="Upload a spreadsheet, fix any rows the editor flags, then import. Each row is created one at a time so a single bad row doesn't block the rest."
      backHref="/admin/products"
      backLabel="← Back to products"
      resourceLabel="product"
      actionPath="/admin/products?index"
      actionIntent="importProduct"
      maxRows={500}
      columns={columns}
      parseSheetRow={(row, sheetRowIndex) => ({
        rowIndex: sheetRowIndex,
        name: pickHeaderValue(row, 'name'),
        basePriceInput: pickHeaderValue(row, 'base_price'),
        costPriceInput: pickHeaderValue(row, 'cost_price'),
        categoryInput: pickHeaderValue(row, 'category'),
        description: pickHeaderValue(row, 'description'),
        galleryUrlsInput: pickHeaderValue(row, 'gallery_urls'),
      })}
      resolveRow={(parsed) => resolveRow(parsed, categories)}
      makeEmptyRow={(sheetRowIndex) => makeEmptyParsedRow(sheetRowIndex)}
      buildFormData={(row) => {
        const fd = new FormData();
        fd.set('name', row.name);
        fd.set('basePrice', String(row.basePrice as number));
        fd.set('costPrice', String(row.costPrice as number));
        if (row.description) fd.set('description', row.description);
        if (row.categoryId) fd.set('categoryId', row.categoryId);
        if (row.categoryName) fd.set('category', row.categoryName);
        if (row.galleryUrls.length > 0) {
          fd.set('galleryImageUrls', JSON.stringify(row.galleryUrls));
        }
        return fd;
      }}
      downloadTemplate={() => downloadProductsImportTemplate(categories)}
      downloadTemplateDisabled={categories.length === 0}
      referenceContent={<ProductsImportColumnsReference categories={categories} />}
      redirectOnComplete
    />
  );
}
