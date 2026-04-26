import { useMemo, useState, useEffect, useRef } from 'react';
import { Link, useFetcher } from '@remix-run/react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { PageHeader } from '~/components/ui/page-header';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { ConfirmActionModal } from '~/components/ui/confirm-action-modal';
import { useFetcherToast } from '~/components/ui/toast';
import type { Campaign, CustomFormField, CustomFormFieldType } from './types';

/** UI label + sample placeholder for each field type. Kept in one place so the picker,
 *  field row, and live preview all read the same vocabulary. */
const FIELD_TYPE_META: Record<CustomFormFieldType, { label: string; icon: string; needsOptions: boolean; description: string }> = {
  text: { label: 'Short text', icon: 'Aa', needsOptions: false, description: 'Single-line text input' },
  textarea: { label: 'Long text', icon: '¶', needsOptions: false, description: 'Multi-line text area' },
  email: { label: 'Email', icon: '@', needsOptions: false, description: 'Email address with validation' },
  phone: { label: 'Phone', icon: '☎', needsOptions: false, description: 'Phone number' },
  number: { label: 'Number', icon: '#', needsOptions: false, description: 'Numeric input' },
  date: { label: 'Date', icon: '📅', needsOptions: false, description: 'Date picker' },
  dropdown: { label: 'Dropdown', icon: '▾', needsOptions: true, description: 'Pick one from a list' },
  radio: { label: 'Radio', icon: '◉', needsOptions: true, description: 'Pick one (radio buttons)' },
  checkbox_group: { label: 'Checkboxes', icon: '☑', needsOptions: true, description: 'Pick many' },
  toggle: { label: 'Yes / No', icon: '🔘', needsOptions: false, description: 'Single yes/no toggle' },
};

const ALL_FIELD_TYPES = Object.keys(FIELD_TYPE_META) as CustomFormFieldType[];

/** Generate a stable client-side UUID for a new field. Falls back to Math.random when crypto
 *  is somehow unavailable (older test envs); the server validates uuid v4 so this matches. */
function newFieldId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function makeBlankField(type: CustomFormFieldType, order: number): CustomFormField {
  const base: CustomFormField = {
    id: newFieldId(),
    type,
    label: FIELD_TYPE_META[type].label,
    required: false,
    order,
  };
  if (FIELD_TYPE_META[type].needsOptions) {
    base.options = ['Option 1', 'Option 2'];
  }
  return base;
}

export interface FormBuilderPageProps {
  campaign: Campaign;
}

/**
 * Two-pane form builder. Left: editable list of custom fields (drag-to-reorder, edit, delete).
 * Right: live preview of the public form as customers will see it. Unsaved changes are tracked
 * locally and surfaced via a sticky Save bar; navigating away with unsaved changes triggers a
 * confirm dialog.
 */
export function FormBuilderPage({ campaign }: FormBuilderPageProps) {
  const initialFields = useMemo<CustomFormField[]>(() => {
    const raw = (campaign.formConfig?.customFields ?? []) as CustomFormField[];
    // Defensive: ensure `order` is contiguous and sorted ascending so drag-reorder works
    // even if a previously-saved payload had gaps or was out-of-order.
    return [...raw].sort((a, b) => a.order - b.order).map((f, i) => ({ ...f, order: i }));
  }, [campaign.formConfig?.customFields]);

  const [fields, setFields] = useState<CustomFormField[]>(initialFields);
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [confirmExit, setConfirmExit] = useState<{ to: string } | null>(null);

  const isDirty = useMemo(() => {
    if (fields.length !== initialFields.length) return true;
    return JSON.stringify(fields) !== JSON.stringify(initialFields);
  }, [fields, initialFields]);

  const saveFetcher = useFetcher<{ success?: boolean; error?: string }>();
  useFetcherToast(saveFetcher.data, { successMessage: 'Form saved' });
  const isSaving = saveFetcher.state !== 'idle';

  // After a successful save, sync the "initial" snapshot so isDirty falls back to false.
  // We track the last-seen response via a ref so we only run this once per submit.
  const lastResponseRef = useRef<unknown>(null);
  useEffect(() => {
    if (saveFetcher.state !== 'idle' || !saveFetcher.data) return;
    if (saveFetcher.data === lastResponseRef.current) return;
    lastResponseRef.current = saveFetcher.data;
    if (saveFetcher.data.success) {
      // Replace the snapshot with the just-saved payload — `initialFields` is derived from
      // a useMemo whose source is the server data, so we need to re-snapshot via a state
      // copy. Cheapest path: trigger `setFields` with the same array (reference identity
      // change) and let the JSON.stringify diff settle.
      setFields((prev) => prev.map((f) => ({ ...f })));
    }
  }, [saveFetcher.state, saveFetcher.data]);

  const editingField = editingFieldId ? fields.find((f) => f.id === editingFieldId) ?? null : null;

  function handleAddField(type: CustomFormFieldType) {
    const next = makeBlankField(type, fields.length);
    setFields((prev) => [...prev, next]);
    setShowAddPicker(false);
    setEditingFieldId(next.id);
  }

  function handleUpdateField(id: string, patch: Partial<CustomFormField>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function handleDeleteField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })));
    if (editingFieldId === id) setEditingFieldId(null);
  }

  /**
   * Reorder via HTML5 drag/drop. Caller passes the dragged field id and the drop target index.
   * No external library — for vertical lists of <50 cards this is more than enough.
   */
  function handleReorder(fromId: string, toIndex: number) {
    setFields((prev) => {
      const fromIndex = prev.findIndex((f) => f.id === fromId);
      if (fromIndex === -1 || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return prev; // unreachable given the index check above; satisfies TS
      // toIndex is the position in the ORIGINAL list; account for the shift after splice.
      const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
      next.splice(insertAt, 0, moved);
      return next.map((f, i) => ({ ...f, order: i }));
    });
  }

  function handleSave() {
    saveFetcher.submit(
      { intent: 'saveCustomFields', customFields: JSON.stringify(fields) },
      { method: 'post' },
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Form Builder"
        description={
          <>
            Editing <strong className="text-app-fg">{campaign.name}</strong>
            {' — '}
            <Link to="/admin/marketing/forms" className="text-brand-600 dark:text-brand-400 hover:underline">
              back to all forms
            </Link>
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (isDirty) setConfirmExit({ to: '/admin/marketing/forms' });
                else window.location.assign('/admin/marketing/forms');
              }}
            >
              Exit
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              loading={isSaving}
              loadingText="Saving…"
              disabled={!isDirty || isSaving}
            >
              {isDirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Left pane: field list editor ────────────────────────────── */}
        <div className="space-y-3">
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-app-fg">Custom fields</h2>
              <span className="text-xs text-app-fg-muted">{fields.length} of 50</span>
            </div>

            {fields.length === 0 ? (
              <div className="border border-dashed border-app-border rounded-lg p-8 text-center">
                <p className="text-sm font-medium text-app-fg mb-1">No custom fields yet</p>
                <p className="text-xs text-app-fg-muted mb-4">
                  Add fields like Shirt size, Newsletter sign-up, or Special instructions.
                </p>
                <Button variant="primary" size="sm" onClick={() => setShowAddPicker(true)}>
                  + Add a field
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <FieldRow
                    key={field.id}
                    field={field}
                    index={index}
                    onEdit={() => setEditingFieldId(field.id)}
                    onDelete={() => handleDeleteField(field.id)}
                    onReorder={handleReorder}
                  />
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => setShowAddPicker(true)}
                  disabled={fields.length >= 50}
                >
                  + Add another field
                </Button>
              </div>
            )}
          </div>

          <div className="text-xs text-app-fg-muted px-2">
            Standard fields (Name, Phone, Address, etc.) are managed on the form's basic settings —
            edit those from the{' '}
            <Link to="/admin/marketing/forms" className="text-brand-500 hover:underline">forms list</Link>.
          </div>
        </div>

        {/* ── Right pane: live preview ──────────────────────────────── */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-app-fg">Preview</h2>
            <span className="text-xs text-app-fg-muted">As your customers will see it</span>
          </div>
          <FormPreview fields={fields} accentColor={campaign.formConfig?.accentColor ?? '#6366f1'} />
        </div>
      </div>

      {/* Field type picker — opened by "+ Add field". */}
      {showAddPicker && (
        <Modal open onClose={() => setShowAddPicker(false)} maxWidth="max-w-2xl" contentClassName="p-6">
          <h3 className="text-lg font-semibold text-app-fg mb-1">Add a field</h3>
          <p className="text-sm text-app-fg-muted mb-4">Pick the type that matches the data you want to collect.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ALL_FIELD_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => handleAddField(type)}
                className="text-left rounded-lg border border-app-border bg-app-elevated hover:bg-app-hover transition-colors p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-7 h-7 inline-flex items-center justify-center rounded bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-sm font-mono">
                    {FIELD_TYPE_META[type].icon}
                  </span>
                  <span className="text-sm font-medium text-app-fg">{FIELD_TYPE_META[type].label}</span>
                </div>
                <p className="text-xs text-app-fg-muted">{FIELD_TYPE_META[type].description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Field editor — opened by clicking a field row's edit button. */}
      {editingField && (
        <FieldEditorModal
          field={editingField}
          onClose={() => setEditingFieldId(null)}
          onSave={(patch) => {
            handleUpdateField(editingField.id, patch);
            setEditingFieldId(null);
          }}
        />
      )}

      {confirmExit && (
        <ConfirmActionModal
          open
          onClose={() => setConfirmExit(null)}
          title="Discard unsaved changes?"
          description="You have unsaved field changes. Leaving now will lose them."
          confirmLabel="Discard and exit"
          cancelLabel="Keep editing"
          variant="warning"
          onConfirm={() => {
            window.location.assign(confirmExit.to);
          }}
        />
      )}
    </div>
  );
}

/* ============================================================
 * Field row — drag handle, type icon, label, edit + delete buttons.
 * ============================================================ */
function FieldRow({
  field,
  index,
  onEdit,
  onDelete,
  onReorder,
}: {
  field: CustomFormField;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
  onReorder: (fromId: string, toIndex: number) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/yannis-field-id', field.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('text/yannis-field-id')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setIsDragOver(true);
        }
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const draggedId = e.dataTransfer.getData('text/yannis-field-id');
        if (draggedId && draggedId !== field.id) {
          onReorder(draggedId, index);
        }
      }}
      className={[
        'group flex items-center gap-2 rounded-lg border bg-app-elevated p-3 transition-colors',
        isDragOver
          ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-800'
          : 'border-app-border hover:border-app-border-strong',
      ].join(' ')}
    >
      <span
        className="cursor-grab active:cursor-grabbing text-app-fg-muted shrink-0"
        title="Drag to reorder"
        aria-hidden
      >
        ⋮⋮
      </span>
      <span className="w-7 h-7 inline-flex items-center justify-center rounded bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-sm font-mono shrink-0">
        {FIELD_TYPE_META[field.type].icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-app-fg truncate">
          {field.label}
          {field.required && <span className="text-danger-500 ml-1">*</span>}
        </p>
        <p className="text-xs text-app-fg-muted">{FIELD_TYPE_META[field.type].label}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={onEdit}>
          Edit
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-xs text-danger-600 hover:text-danger-700" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/* ============================================================
 * Field editor — modal with type-specific config (label, options, required, etc.)
 * ============================================================ */
function FieldEditorModal({
  field,
  onClose,
  onSave,
}: {
  field: CustomFormField;
  onClose: () => void;
  onSave: (patch: Partial<CustomFormField>) => void;
}) {
  const [draft, setDraft] = useState<CustomFormField>(field);
  const meta = FIELD_TYPE_META[draft.type];

  function update<K extends keyof CustomFormField>(key: K, value: CustomFormField[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateOption(idx: number, value: string) {
    const next = [...(draft.options ?? [])];
    next[idx] = value;
    update('options', next);
  }
  function addOption() {
    update('options', [...(draft.options ?? []), `Option ${(draft.options?.length ?? 0) + 1}`]);
  }
  function removeOption(idx: number) {
    const next = [...(draft.options ?? [])];
    next.splice(idx, 1);
    update('options', next);
  }

  const labelInvalid = draft.label.trim().length === 0;
  const optionsInvalid = meta.needsOptions && (draft.options?.filter((o) => o.trim()).length ?? 0) < 1;

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 bg-app-elevated">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">Edit field</h3>
        <p className="text-xs text-app-fg-muted mt-0.5">{meta.label} · {meta.description}</p>
      </div>

      <TextInput
        label="Label"
        value={draft.label}
        onChange={(e) => update('label', e.target.value)}
        required
        maxLength={120}
        error={labelInvalid ? 'Label is required' : undefined}
        placeholder={`e.g. ${meta.label}`}
      />

      {/* Type can be changed in-place — handy when MB picks "text" then realises they meant
          "number". Switching CLEARS options if the new type doesn't need them. */}
      <FormSelect
        label="Type"
        value={draft.type}
        onChange={(e) => {
          const newType = e.target.value as CustomFormFieldType;
          const nextMeta = FIELD_TYPE_META[newType];
          setDraft((prev) => ({
            ...prev,
            type: newType,
            options: nextMeta.needsOptions ? prev.options ?? ['Option 1', 'Option 2'] : undefined,
          }));
        }}
        options={ALL_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_META[t].label }))}
      />

      {meta.needsOptions && (
        <div>
          <label className="block text-sm font-medium text-app-fg-muted mb-1">Options</label>
          <div className="space-y-2">
            {(draft.options ?? []).map((opt, idx) => (
              <div key={idx} className="flex gap-2">
                <TextInput
                  value={opt}
                  onChange={(e) => updateOption(idx, e.target.value)}
                  placeholder={`Option ${idx + 1}`}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-danger-600"
                  onClick={() => removeOption(idx)}
                  disabled={(draft.options?.length ?? 0) <= 1}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" onClick={addOption}>
              + Add option
            </Button>
          </div>
          {optionsInvalid && (
            <p className="text-xs text-danger-600 mt-1">At least one option is required.</p>
          )}
        </div>
      )}

      {!meta.needsOptions && draft.type !== 'toggle' && (
        <TextInput
          label="Placeholder (optional)"
          value={draft.placeholder ?? ''}
          onChange={(e) => update('placeholder', e.target.value)}
          maxLength={120}
          placeholder="Hint text shown inside the input"
        />
      )}

      <Textarea
        label="Help text (optional)"
        value={draft.helpText ?? ''}
        onChange={(e) => update('helpText', e.target.value)}
        rows={2}
        maxLength={240}
        placeholder="Shown below the field — explain what to enter."
      />

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={draft.required}
          onChange={(e) => update('required', e.target.checked)}
          className="rounded border-app-border-strong text-brand-500 focus:ring-brand-500"
        />
        <span className="text-sm text-app-fg">Required — customer must fill this in</span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => onSave(draft)}
          disabled={labelInvalid || optionsInvalid}
        >
          Save field
        </Button>
      </div>
    </Modal>
  );
}

/* ============================================================
 * Live preview — renders the form as the customer will see it.
 * Read-only; just visualises shape + accent colour.
 * ============================================================ */
function FormPreview({ fields, accentColor }: { fields: CustomFormField[]; accentColor: string }) {
  if (fields.length === 0) {
    return (
      <div className="border border-dashed border-app-border rounded-lg p-8 text-center text-sm text-app-fg-muted">
        Add a field to see it here.
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-lg bg-app-canvas p-4 border border-app-border">
      {fields.map((field) => (
        <PreviewField key={field.id} field={field} accentColor={accentColor} />
      ))}
    </div>
  );
}

function PreviewField({ field, accentColor }: { field: CustomFormField; accentColor: string }) {
  const labelEl = (
    <label className="block text-sm font-medium text-app-fg mb-1">
      {field.label}
      {field.required && <span className="text-danger-500 ml-0.5">*</span>}
    </label>
  );
  const helpEl = field.helpText ? (
    <p className="mt-1 text-xs text-app-fg-muted">{field.helpText}</p>
  ) : null;
  switch (field.type) {
    case 'text':
    case 'email':
    case 'phone':
    case 'number':
    case 'date':
      return (
        <div>
          {labelEl}
          <TextInput
            type={field.type === 'phone' ? 'tel' : field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : field.type === 'email' ? 'email' : 'text'}
            placeholder={field.placeholder}
            disabled
            readOnly
            wrapperClassName="pointer-events-none"
          />
          {helpEl}
        </div>
      );
    case 'textarea':
      return (
        <div>
          {labelEl}
          <Textarea rows={3} placeholder={field.placeholder} disabled readOnly wrapperClassName="pointer-events-none" />
          {helpEl}
        </div>
      );
    case 'dropdown':
      return (
        <div>
          {labelEl}
          <FormSelect
            disabled
            placeholder="Select..."
            options={(field.options ?? []).map((opt, i) => ({ value: `opt-${i}`, label: opt }))}
            defaultValue=""
            wrapperClassName="pointer-events-none"
          />
          {helpEl}
        </div>
      );
    case 'radio':
      return (
        <div>
          {labelEl}
          <div className="space-y-1">
            {(field.options ?? []).map((opt, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-app-fg">
                <input type="radio" name={field.id} disabled style={{ accentColor }} />
                {opt}
              </label>
            ))}
          </div>
          {helpEl}
        </div>
      );
    case 'checkbox_group':
      return (
        <div>
          {labelEl}
          <div className="space-y-1">
            {(field.options ?? []).map((opt, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-app-fg">
                <input type="checkbox" disabled style={{ accentColor }} />
                {opt}
              </label>
            ))}
          </div>
          {helpEl}
        </div>
      );
    case 'toggle':
      return (
        <div>
          <label className="flex items-center gap-2 text-sm text-app-fg">
            <input type="checkbox" disabled style={{ accentColor }} />
            {field.label}
            {field.required && <span className="text-danger-500 ml-0.5">*</span>}
          </label>
          {helpEl}
        </div>
      );
  }
}
