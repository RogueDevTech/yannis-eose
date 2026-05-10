import { useEffect, useMemo, useRef, useState } from 'react';
import { Form, useFetcher, useRevalidator } from '@remix-run/react';
import type { CsRoutingRelationshipMode } from '@yannis/shared';
import { PageHeader } from '~/components/ui/page-header';
import { Card, CardBody, CardHeader } from '~/components/ui/card';
import { Button } from '~/components/ui/button';
import { FormSelect } from '~/components/ui/form-select';
import { TextInput } from '~/components/ui/text-input';
import { Checkbox } from '~/components/ui/checkbox';
import { Modal } from '~/components/ui/modal';
import { CompactTable } from '~/components/ui/compact-table';
import { EmptyState } from '~/components/ui/empty-state';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { TableActionButton } from '~/components/ui/table-action-button';
import { RadioGroup } from '~/components/ui/radio-group';
import { useFetcherToast, useToast } from '~/components/ui/toast';

export interface CsRoutingRuleRow {
  id: string;
  ownerBranchId: string;
  productId: string | null;
  priority: number;
  enabled: boolean;
  strategy: 'WEIGHTED' | 'EQUAL';
  targets: Array<{ id: string; servicingBranchId: string; teamId: string | null; weight: number }>;
}

interface BranchOpt {
  id: string;
  name: string;
  code?: string | null;
}

interface ProductOpt {
  id: string;
  name: string;
}

interface TeamOpt {
  id: string;
  label: string;
}

interface CsOrderRoutingSettingsPageProps {
  branches: BranchOpt[];
  products: ProductOpt[];
  /** CS squads keyed by branch id (optional teams when routing uses branch-wide pool). */
  teamsByBranchId: Record<string, TeamOpt[]>;
  rules: CsRoutingRuleRow[];
  selectedBranchId: string | null;
  branchAdminLocked: boolean;
  relationshipMode: CsRoutingRelationshipMode | null;
}

type TargetDraft = { servicingBranchId: string; teamId: string; weight: number };

export function CsOrderRoutingSettingsPage({
  branches,
  products,
  teamsByBranchId,
  rules,
  selectedBranchId,
  branchAdminLocked,
  relationshipMode: relationshipModeProp,
}: CsOrderRoutingSettingsPageProps) {
  const rev = useRevalidator();
  const toast = useToast();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const modeFetcher = useFetcher<{ success?: boolean; error?: string }>();
  const handledSuccessRef = useRef(false);
  const handledModeSuccessRef = useRef(false);

  const activeRelationshipMode: CsRoutingRelationshipMode = selectedBranchId
    ? relationshipModeProp ?? 'BRANCH_DEFAULT'
    : 'BRANCH_DEFAULT';

  const [relationshipDraft, setRelationshipDraft] = useState<CsRoutingRelationshipMode>(activeRelationshipMode);

  useEffect(() => {
    setRelationshipDraft(activeRelationshipMode);
  }, [activeRelationshipMode, selectedBranchId]);

  useFetcherToast(fetcher.data, {
    successMessage: 'Saved',
    skipErrorToast: false,
  });

  useFetcherToast(modeFetcher.data, {
    successMessage: 'Relationship mode saved',
    skipErrorToast: false,
  });

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CsRoutingRuleRow | null>(null);
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null);

  const [priority, setPriority] = useState('0');
  const [enabled, setEnabled] = useState(true);
  const [strategy, setStrategy] = useState<'WEIGHTED' | 'EQUAL'>('EQUAL');
  const [productId, setProductId] = useState('');
  const [targets, setTargets] = useState<TargetDraft[]>([{ servicingBranchId: '', teamId: '', weight: 1 }]);

  const productNameById = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const branchNameById = useMemo(
    () => new Map(branches.map((b) => [b.id, b.code ? `${b.name} (${b.code})` : b.name])),
    [branches],
  );

  const resetDraft = () => {
    setEditingRule(null);
    setPriority('0');
    setEnabled(true);
    setStrategy('EQUAL');
    setProductId('');
    const defaultServicing = selectedBranchId ?? branches[0]?.id ?? '';
    setTargets([{ servicingBranchId: defaultServicing, teamId: '', weight: 1 }]);
  };

  const openCreate = () => {
    resetDraft();
    setEditorOpen(true);
  };

  const openEdit = (r: CsRoutingRuleRow) => {
    setEditingRule(r);
    setPriority(String(r.priority));
    setEnabled(r.enabled);
    setStrategy(r.strategy);
    setProductId(r.productId ?? '');
    setTargets(
      r.targets.length > 0
        ? r.targets.map((t) => ({
            servicingBranchId: t.servicingBranchId,
            teamId: t.teamId ?? '',
            weight: t.weight,
          }))
        : [{ servicingBranchId: selectedBranchId ?? branches[0]?.id ?? '', teamId: '', weight: 1 }],
    );
    setEditorOpen(true);
  };

  useEffect(() => {
    if (fetcher.state !== 'idle') {
      handledSuccessRef.current = false;
      return;
    }
    if (!fetcher.data?.success || handledSuccessRef.current) return;
    handledSuccessRef.current = true;
    setEditorOpen(false);
    resetDraft();
    rev.revalidate();
  }, [fetcher.state, fetcher.data, rev]);

  useEffect(() => {
    if (modeFetcher.state !== 'idle') {
      handledModeSuccessRef.current = false;
      return;
    }
    if (!modeFetcher.data?.success || handledModeSuccessRef.current) return;
    handledModeSuccessRef.current = true;
    rev.revalidate();
  }, [modeFetcher.state, modeFetcher.data, rev]);

  const busy = fetcher.state !== 'idle';
  const modeBusy = modeFetcher.state !== 'idle';

  const saveRelationshipMode = () => {
    if (!selectedBranchId) return;
    const fd = new FormData();
    fd.set(
      'json',
      JSON.stringify({
        intent: 'setCsRoutingRelationshipMode',
        ownerBranchId: selectedBranchId,
        relationshipMode: relationshipDraft,
      }),
    );
    modeFetcher.submit(fd, { method: 'post' });
  };

  const saveRule = () => {
    if (!selectedBranchId) return;
    if (activeRelationshipMode === 'PRODUCT_ALLOCATION' && !productId.trim()) {
      toast.toast.error('Product required', 'Choose a product for each allocation rule.');
      return;
    }

    const cleanedTargets = targets
      .filter((t) => t.servicingBranchId)
      .map((t) => ({
        servicingBranchId: t.servicingBranchId,
        teamId: t.teamId.trim() ? t.teamId : null,
        weight: Math.max(1, Math.floor(Number(t.weight) || 1)),
      }));
    if (cleanedTargets.length === 0) return;

    const resolvedProductId = activeRelationshipMode === 'BRANCH_DEFAULT' ? null : productId.trim() || null;

    const payload = editingRule
      ? {
          intent: 'updateCsRoutingRule',
          ruleId: editingRule.id,
          productId: resolvedProductId,
          priority: Math.max(0, Math.floor(Number(priority) || 0)),
          enabled,
          strategy,
          targets: cleanedTargets,
        }
      : {
          intent: 'createCsRoutingRule',
          ownerBranchId: selectedBranchId,
          productId: resolvedProductId,
          priority: Math.max(0, Math.floor(Number(priority) || 0)),
          enabled,
          strategy,
          targets: cleanedTargets,
        };

    const fd = new FormData();
    fd.set('json', JSON.stringify(payload));
    fetcher.submit(fd, { method: 'post' });
  };

  const confirmDelete = () => {
    if (!deleteRuleId) return;
    const fd = new FormData();
    fd.set('json', JSON.stringify({ intent: 'deleteCsRoutingRule', ruleId: deleteRuleId }));
    fetcher.submit(fd, { method: 'post' });
    setDeleteRuleId(null);
  };

  const defaultServicing = selectedBranchId ?? branches[0]?.id ?? '';

  const formatTargetLine = (r: CsRoutingRuleRow, t: CsRoutingRuleRow['targets'][0]) => {
    const b = branchNameById.get(t.servicingBranchId) ?? t.servicingBranchId;
    const teamLabel =
      t.teamId && teamsByBranchId[t.servicingBranchId]
        ? teamsByBranchId[t.servicingBranchId]!.find((x) => x.id === t.teamId)?.label ?? t.teamId
        : null;
    const narrow = teamLabel ? teamLabel : 'All CS closers';
    return `${b} · ${narrow}${r.strategy === 'WEIGHTED' ? ` ×${t.weight}` : ''}`;
  };

  const ruleColumns = [
    {
      key: 'priority',
      header: 'Priority',
      render: (r: CsRoutingRuleRow) => <span className="tabular-nums">{r.priority}</span>,
    },
    ...(activeRelationshipMode === 'PRODUCT_ALLOCATION'
      ? [
          {
            key: 'product',
            header: 'Product',
            render: (r: CsRoutingRuleRow) =>
              r.productId ? (
                <span className="truncate max-w-[14rem]" title={productNameById.get(r.productId) ?? r.productId}>
                  {productNameById.get(r.productId) ?? r.productId}
                </span>
              ) : (
                <span className="text-app-fg-muted">—</span>
              ),
          },
        ]
      : []),
    {
      key: 'strategy',
      header: 'Strategy',
      render: (r: CsRoutingRuleRow) => <span className="text-xs font-medium text-app-fg">{r.strategy}</span>,
    },
    {
      key: 'enabled',
      header: 'Enabled',
      render: (r: CsRoutingRuleRow) => <span className="text-xs text-app-fg-muted">{r.enabled ? 'Yes' : 'No'}</span>,
    },
    {
      key: 'targets',
      header: 'Servicing targets',
      render: (r: CsRoutingRuleRow) => (
        <span className="text-xs text-app-fg-muted">{r.targets.map((t) => formatTargetLine(r, t)).join(' · ')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      mobileShowLabel: false,
      render: (r: CsRoutingRuleRow) => (
        <div className="flex justify-end gap-2">
          <TableActionButton type="button" variant="neutral" onClick={() => openEdit(r)}>
            Edit
          </TableActionButton>
          <TableActionButton type="button" variant="danger" onClick={() => setDeleteRuleId(r.id)}>
            Delete
          </TableActionButton>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="CS order routing" />

      <Card>
        <CardHeader title="Funnel branch" />
        <CardBody className="space-y-4">
          <Form method="get" className="flex flex-wrap gap-3 items-end">
            <div className="min-w-[min(100%,18rem)] flex-1">
              <FormSelect
                label="Campaign / order branch"
                hint="Rules below apply only to orders attributed to this branch."
                id="branchId"
                name="branchId"
                disabled={branchAdminLocked}
                defaultValue={selectedBranchId ?? ''}
                options={[
                  { value: '', label: branchAdminLocked ? 'Your branch (fixed)' : 'Choose a branch…' },
                  ...branches.map((b) => ({
                    value: b.id,
                    label: b.code ? `${b.name} (${b.code})` : b.name,
                  })),
                ]}
              />
            </div>
            {!branchAdminLocked ? (
              <Button type="submit" variant="secondary" size="sm">
                Load rules for this branch
              </Button>
            ) : null}
          </Form>
        </CardBody>
      </Card>

      {selectedBranchId ? (
        <>
          <Card>
            <CardHeader title="Relationship mode" />
            <CardBody className="space-y-4">
              <RadioGroup<CsRoutingRelationshipMode>
                name="csRoutingRelationshipMode"
                layout="card"
                label="Match rules for this funnel branch"
                value={relationshipDraft}
                onChange={setRelationshipDraft}
                options={[
                  {
                    value: 'BRANCH_DEFAULT',
                    label: 'Branch relationship',
                    description: 'Rules route by servicing branch / team only (no product filter).',
                  },
                  {
                    value: 'PRODUCT_ALLOCATION',
                    label: 'Product allocation',
                    description: 'Each rule maps one product to the CS branch (and optional team) that handles it.',
                  },
                ]}
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={modeBusy}
                  loadingText="Saving…"
                  disabled={relationshipDraft === activeRelationshipMode || modeBusy}
                  onClick={saveRelationshipMode}
                >
                  Save relationship mode
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={activeRelationshipMode === 'PRODUCT_ALLOCATION' ? 'Product → CS routing' : 'Servicing targets'}
              actions={
                <Button type="button" variant="primary" size="sm" onClick={openCreate} disabled={branches.length === 0}>
                  + Add rule
                </Button>
              }
            />
            <CardBody>
              {rules.length === 0 ? (
                <EmptyState
                  title="No rules yet"
                  description={
                    activeRelationshipMode === 'PRODUCT_ALLOCATION'
                      ? 'Add a rule: pick a product and the CS servicing branch.'
                      : 'Add a rule: set which branch supplies CS capacity (and optional team).'
                  }
                />
              ) : (
                <CompactTable<CsRoutingRuleRow>
                  rows={rules}
                  rowKey={(r, _i) => r.id}
                  columns={ruleColumns}
                />
              )}
            </CardBody>
          </Card>
        </>
      ) : (
        <EmptyState title="Select a funnel branch" description="Choose a branch and load rules to add or edit rows." />
      )}

      <Modal
        open={editorOpen}
        onClose={() => {
          if (!busy && !modeBusy) setEditorOpen(false);
        }}
        maxWidth="max-w-lg"
        backdropBlur
        contentClassName="p-6 flex flex-col gap-4 border border-app-border bg-app-elevated"
        aria-labelledby="cs-routing-editor-title"
      >
        <h3 id="cs-routing-editor-title" className="text-lg font-semibold text-app-fg">
          {editingRule ? 'Edit routing rule' : 'New routing rule'}
        </h3>
        <div className="space-y-4">
          <TextInput label="Priority" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <FormSelect
            label="Strategy"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as 'WEIGHTED' | 'EQUAL')}
            options={[
              { value: 'EQUAL', label: 'Equal split (stable hash per order)' },
              { value: 'WEIGHTED', label: 'Weighted' },
            ]}
          />
          {activeRelationshipMode === 'PRODUCT_ALLOCATION' ? (
            <FormSelect
              label="Product"
              required
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              options={[{ value: '', label: 'Select product…' }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
            />
          ) : null}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-app-fg">Servicing targets</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() =>
                  setTargets((prev) => [...prev, { servicingBranchId: defaultServicing, teamId: '', weight: 1 }])
                }
              >
                + Target
              </Button>
            </div>
            {targets.map((row, idx) => (
              <div key={idx} className="flex flex-col gap-2 border border-app-border rounded-md p-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[12rem]">
                    <FormSelect
                      label={idx === 0 ? 'Servicing branch (CS capacity)' : undefined}
                      value={row.servicingBranchId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTargets((prev) =>
                          prev.map((t, i) => (i === idx ? { ...t, servicingBranchId: v, teamId: '' } : t)),
                        );
                      }}
                      options={branches.map((b) => ({
                        value: b.id,
                        label: b.code ? `${b.name} (${b.code})` : b.name,
                      }))}
                    />
                  </div>
                  <div className="flex-1 min-w-[12rem]">
                    <FormSelect
                      label={idx === 0 ? 'CS team (optional)' : undefined}
                      value={row.teamId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTargets((prev) => prev.map((t, i) => (i === idx ? { ...t, teamId: v } : t)));
                      }}
                      options={[
                        { value: '', label: 'All CS closers on servicing branch' },
                        ...(teamsByBranchId[row.servicingBranchId] ?? []).map((x) => ({
                          value: x.id,
                          label: x.label,
                        })),
                      ]}
                    />
                  </div>
                  <div className="w-28">
                    <TextInput
                      label={idx === 0 ? 'Weight' : undefined}
                      type="number"
                      min={1}
                      value={String(row.weight)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTargets((prev) =>
                          prev.map((t, i) => (i === idx ? { ...t, weight: Math.max(1, Number(v) || 1) } : t)),
                        );
                      }}
                    />
                  </div>
                  {targets.length > 1 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setTargets((prev) => prev.filter((_, i) => i !== idx))}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
          <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)} disabled={busy || modeBusy}>
            Cancel
          </Button>
          <Button type="button" variant="primary" loading={busy} loadingText="Saving…" disabled={modeBusy} onClick={saveRule}>
            Save
          </Button>
        </div>
      </Modal>

      <ConfirmActionModal
        open={!!deleteRuleId}
        onClose={() => setDeleteRuleId(null)}
        title="Delete routing rule?"
        description="Dispatch uses default servicing when nothing matches."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
