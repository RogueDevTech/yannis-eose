/**
 * DescriptionList — renders key/value detail rows.
 * Used on order detail, user detail, product detail pages.
 *
 * Usage:
 *   <DescriptionList items={[
 *     { label: 'Name', value: 'John Doe' },
 *     { label: 'Status', value: <StatusBadge status="active" /> },
 *     { label: 'Phone', value: '0803****1234', sensitive: true },
 *   ]} />
 */

export interface DescriptionItem {
  label: string;
  value: React.ReactNode;
  /** Spans the full width (no side-by-side layout for this item) */
  fullWidth?: boolean;
  /** Shows a blurred/masked style for sensitive values */
  sensitive?: boolean;
  /** Hides the item if value is null/undefined/'' */
  hideIfEmpty?: boolean;
  /** Copy-to-clipboard button on the value */
  copyable?: boolean;
}

type DescriptionListLayout = 'stacked' | 'horizontal' | 'grid';

interface DescriptionListProps {
  items: DescriptionItem[];
  /** stacked = label above value; horizontal = label left value right; grid = 2-col */
  layout?: DescriptionListLayout;
  /** Applies only when layout="grid". Default is 2 columns. */
  gridColumns?: 2 | 3;
  /** Applies only when layout="grid" — tighter gaps and smaller value text */
  dense?: boolean;
  /** Separator line between items */
  divided?: boolean;
  className?: string;
}

function isEmptyValue(value: React.ReactNode): boolean {
  return value === null || value === undefined || value === '';
}

export function DescriptionList({
  items,
  layout = 'stacked',
  gridColumns = 2,
  dense = false,
  divided = false,
  className = '',
}: DescriptionListProps) {
  const visibleItems = items.filter((item) => !(item.hideIfEmpty && isEmptyValue(item.value)));

  if (layout === 'grid') {
    const gridColsClass =
      gridColumns === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
    const fullWidthClass = gridColumns === 3 ? 'sm:col-span-3' : 'sm:col-span-2';

    return (
      <dl
        className={[
          'grid grid-cols-1',
          dense ? 'gap-x-3 gap-y-2 sm:gap-x-4 sm:gap-y-2.5' : 'gap-x-6 gap-y-4',
          gridColsClass,
          divided ? 'divide-y divide-app-border sm:divide-y-0' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {visibleItems.map((item, i) => (
          <div
            key={i}
            className={[
              dense ? 'flex flex-col gap-px' : 'flex flex-col gap-0.5',
              item.fullWidth ? fullWidthClass : '',
              divided ? 'pt-4 first:pt-0' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <dt
              className={
                dense
                  ? 'text-micro font-semibold uppercase tracking-wide text-app-fg-muted'
                  : 'text-xs font-medium text-app-fg-muted'
              }
            >
              {item.label}
            </dt>
            <dd
              className={[
                dense ? 'text-xs text-app-fg leading-snug break-words' : 'text-sm text-app-fg break-words',
                item.sensitive ? 'blur-sm hover:blur-none transition-all select-none hover:select-auto' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {isEmptyValue(item.value) ? <span className="text-app-fg-muted">—</span> : item.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (layout === 'horizontal') {
    return (
      <dl
        className={[
          'flex flex-col',
          divided ? 'divide-y divide-app-border' : 'gap-3',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {visibleItems.map((item, i) => (
          <div
            key={i}
            className={[
              'flex items-start justify-between gap-4',
              divided ? 'py-3 first:pt-0 last:pb-0' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <dt className="shrink-0 text-sm text-app-fg-muted">{item.label}</dt>
            <dd
              className={[
                'text-right text-sm font-medium text-app-fg break-words',
                item.sensitive ? 'blur-sm hover:blur-none transition-all select-none hover:select-auto' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {isEmptyValue(item.value) ? <span className="font-normal text-app-fg-muted">—</span> : item.value}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  // stacked (default)
  return (
    <dl
      className={[
        'flex flex-col',
        divided ? 'divide-y divide-app-border' : 'gap-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {visibleItems.map((item, i) => (
        <div
          key={i}
          className={[divided ? 'py-3 first:pt-0 last:pb-0' : ''].filter(Boolean).join(' ')}
        >
          <dt className="mb-0.5 text-xs font-medium text-app-fg-muted">{item.label}</dt>
          <dd
            className={[
              'text-sm text-app-fg break-words',
              item.sensitive ? 'blur-sm hover:blur-none transition-all select-none hover:select-auto' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {isEmptyValue(item.value) ? <span className="text-app-fg-muted">—</span> : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
