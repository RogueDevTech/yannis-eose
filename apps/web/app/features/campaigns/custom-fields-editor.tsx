import { useState, type ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import { Checkbox } from '~/components/ui/checkbox';
import { FIELD_TYPE_META } from './form-config-custom-preview';
import type { CustomFormField, CustomFormFieldType } from './types';

const ALL_FIELD_TYPES = Object.keys(FIELD_TYPE_META) as CustomFormFieldType[];

function newFieldId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function makeBlankField(type: CustomFormFieldType, order: number): CustomFormField {
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

export interface CustomFieldsEditorProps {
  fields: CustomFormField[];
  onFieldsChange: (next: CustomFormField[]) => void;
  /** Shown under the field list (e.g. link to forms list vs create-page hint). */
  footnote?: ReactNode;
}

/**
 * Custom field builder: editable list. Live full-form preview is rendered in the page layout.
 * Controlled via `fields` / `onFieldsChange` for hidden JSON on save.
 */
export function CustomFieldsEditor({ fields, onFieldsChange, footnote }: CustomFieldsEditorProps) {
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [showAddPicker, setShowAddPicker] = useState(false);

  const editingField = editingFieldId ? fields.find((f) => f.id === editingFieldId) ?? null : null;

  function handleAddField(type: CustomFormFieldType) {
    const next = makeBlankField(type, fields.length);
    onFieldsChange([...fields, next]);
    setShowAddPicker(false);
    setEditingFieldId(next.id);
  }

  function handleUpdateField(id: string, patch: Partial<CustomFormField>) {
    onFieldsChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function handleDeleteField(id: string) {
    onFieldsChange(
      fields.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })),
    );
    if (editingFieldId === id) setEditingFieldId(null);
  }

  return (
    <>
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
              <Button variant="primary" size="sm" type="button" onClick={() => setShowAddPicker(true)}>
                + Add a field
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {fields.map((field, index) => (
                <FieldRow
                  key={field.id}
                  field={field}
                  onEdit={() => setEditingFieldId(field.id)}
                  onDelete={() => handleDeleteField(field.id)}
                  onUpdateRequired={(id, required) => handleUpdateField(id, { required })}
                />
              ))}
              <Button
                type="button"
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

        {footnote ? <div className="text-xs text-app-fg-muted px-2">{footnote}</div> : null}
      </div>

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

      {editingField && (
        <FieldEditorModal
          key={editingField.id}
          field={editingField}
          onClose={() => setEditingFieldId(null)}
          onSave={(patch) => {
            handleUpdateField(editingField.id, patch);
            setEditingFieldId(null);
          }}
        />
      )}
    </>
  );
}

function FieldRow({
  field,
  onEdit,
  onDelete,
  onUpdateRequired,
}: {
  field: CustomFormField;
  onEdit: () => void;
  onDelete: () => void;
  onUpdateRequired: (id: string, required: boolean) => void;
}) {
  return (
    <div
      className={[
        'group flex items-center gap-2 rounded-lg border bg-app-elevated p-3 transition-colors',
        'border-app-border hover:border-app-border-strong',
      ].join(' ')}
    >
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
      <label
        className="flex items-center gap-1.5 shrink-0 text-app-fg-muted"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        title="Require this field on the public form"
      >
        <Checkbox
          checked={!!field.required}
          onChange={(e) => onUpdateRequired(field.id, e.target.checked)}
        />
        <span className="text-xs">Required</span>
      </label>
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

function FieldEditorModal({
  field,
  onClose,
  onSave,
}: {
  field: CustomFormField;
  onClose: () => void;
  onSave: (patch: Partial<CustomFormField>) => void;
}) {
  const [draft, setDraft] = useState<CustomFormField>(() => ({
    ...field,
    required: field.required === true,
  }));
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
        <p className="text-xs text-app-fg-muted mt-0.5">
          {meta.label} · {meta.description}
        </p>
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

      <FormSelect
        label="Type"
        value={draft.type}
        onChange={(e) => {
          const newType = e.target.value as CustomFormFieldType;
          const nextMeta = FIELD_TYPE_META[newType];
          setDraft((prev) => ({
            ...prev,
            type: newType,
            options: nextMeta.needsOptions ? (prev.options ?? ['Option 1', 'Option 2']) : undefined,
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
          {optionsInvalid && <p className="text-xs text-danger-600 mt-1">At least one option is required.</p>}
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
        placeholder="Shown below the field. Explain what to enter."
      />

      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={!!draft.required} onChange={(e) => update('required', e.target.checked)} />
        <span className="text-sm text-app-fg">Required. Customer must fill this in.</span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
        <Button variant="secondary" size="sm" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={() => onSave(draft)} disabled={labelInvalid || optionsInvalid}>
          Save field
        </Button>
      </div>
    </Modal>
  );
}
