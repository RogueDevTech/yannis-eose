import { useState } from 'react';
import { permissionCodeDisplaySplit } from '@yannis/shared';
import { Button } from '~/components/ui/button';
import { DescriptionList, type DescriptionItem } from '~/components/ui/description-list';
import { formatPermissionCode } from '~/lib/permission-codes';

export interface PermissionCodeDetailPanelProps {
  code: string;
  description: string | null;
  legacyAliases?: string[];
  onClose: () => void;
  titleId?: string;
}

export function PermissionCodeDetailPanel({
  code,
  description,
  legacyAliases = [],
  onClose,
  titleId = 'permission-code-detail-title',
}: PermissionCodeDetailPanelProps) {
  const { resource, action } = permissionCodeDisplaySplit(code);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const items: DescriptionItem[] = [
    {
      label: 'Resource',
      value: <span className="font-mono text-sm text-app-fg">{resource || '—'}</span>,
    },
    {
      label: 'Action',
      value: <span className="font-mono text-sm text-app-fg">{action || '—'}</span>,
    },
    {
      label: 'What it allows',
      value: description ? (
        <span className="text-sm text-app-fg whitespace-pre-wrap">{description}</span>
      ) : (
        <span className="text-sm text-app-fg-muted italic">
          No catalog description yet. Ask a Super Admin to extend the permission seed metadata if this needs
          documentation.
        </span>
      ),
      fullWidth: true,
    },
  ];

  if (legacyAliases.length > 0) {
    items.push({
      label: 'Also known as (legacy codes)',
      value: (
        <ul className="list-disc pl-4 text-sm font-mono text-app-fg space-y-0.5">
          {legacyAliases.map((alias) => (
            <li key={alias}>{alias}</li>
          ))}
        </ul>
      ),
      fullWidth: true,
    });
  }

  return (
    <>
      <div className="space-y-1">
        <h2 id={titleId} className="text-lg font-semibold text-app-fg">
          {formatPermissionCode(code)}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-xs text-app-fg-muted break-all flex-1 min-w-0">{code}</p>
          <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={copyCode}>
            {copied ? 'Copied' : 'Copy code'}
          </Button>
        </div>
      </div>
      <DescriptionList layout="stacked" divided items={items} />
      <div className="flex justify-end pt-1">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    </>
  );
}
