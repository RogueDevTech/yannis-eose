import { useMemo, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Textarea } from '~/components/ui/textarea';
import { ChipInput } from '~/components/ui/chip-input';
import { Modal } from '~/components/ui/modal';
import { TextInput } from '~/components/ui/text-input';
import type { StandardFieldConfig, StandardFieldKey } from './types';
import {
  ADDITIONAL_FIELD_OPTION_KEYS,
  type AdditionalFieldSelectOptionsState,
  FIXED_STANDARD_FIELD_KEYS,
  getDefaultStandardFieldLabel,
  getStandardFieldLabel,
  joinOptionLines,
  parseOptionLines,
  STANDARD_FIELD_LABELS,
  TOGGLEABLE_STANDARD_FIELD_ORDER,
} from './standard-fields';

interface StandardFieldsEditorProps {
  fields: StandardFieldConfig[];
  onFieldsChange: (next: StandardFieldConfig[]) => void;
  selectOptions: AdditionalFieldSelectOptionsState;
  onSelectOptionsChange: (next: AdditionalFieldSelectOptionsState) => void;
}

export function StandardFieldsEditor({
  fields,
  onFieldsChange,
  selectOptions,
  onSelectOptionsChange,
}: StandardFieldsEditorProps) {
  const [editingFieldKey, setEditingFieldKey] = useState<StandardFieldKey | null>(null);
  const fixedSet = new Set<string>(FIXED_STANDARD_FIELD_KEYS);
  const toggleableFields = fields.filter((f) => !fixedSet.has(f.key));
  const selected = new Set(toggleableFields.map((f) => f.key));
  const remaining = TOGGLEABLE_STANDARD_FIELD_ORDER.filter((key) => !selected.has(key));
  const editingField = editingFieldKey ? fields.find((field) => field.key === editingFieldKey) ?? null : null;

  function addField(key: StandardFieldKey) {
    onFieldsChange([...fields, { key, label: getDefaultStandardFieldLabel(key), required: false }]);
  }

  function removeField(key: StandardFieldKey) {
    onFieldsChange(fields.filter((f) => f.key !== key));
    if (editingFieldKey === key) setEditingFieldKey(null);
  }

  function updateField(key: StandardFieldKey, patch: Partial<StandardFieldConfig>) {
    onFieldsChange(fields.map((f) => (f.key === key ? { ...f, ...patch } : f)));
  }

  function patchSelectOptions(patch: Partial<AdditionalFieldSelectOptionsState>) {
    onSelectOptionsChange({ ...selectOptions, ...patch });
  }

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex justify-end mb-2">
          <span className="text-xs text-app-fg-muted">
            {toggleableFields.length} of {TOGGLEABLE_STANDARD_FIELD_ORDER.length} selected
          </span>
        </div>

        {toggleableFields.length === 0 ? (
          <div className="border border-dashed border-app-border rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-app-fg mb-1">No additional fields added</p>
            <p className="text-xs text-app-fg-muted mb-4">
              Add built-in fields like delivery state, gender, or email. Dropdown choices can be edited when you add
              those fields.
            </p>
            {remaining.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-2">
                {remaining.map((key) => (
                  <Button key={key} type="button" size="sm" variant="secondary" onClick={() => addField(key)}>
                    + {STANDARD_FIELD_LABELS[key]}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            {toggleableFields.map((field) => (
              <div
                key={field.key}
                className="group rounded-lg border bg-app-elevated p-3 border-app-border hover:border-app-border-strong transition-colors"
              >
                <div className="flex items-start gap-2">
                  <span className="w-7 h-7 inline-flex items-center justify-center rounded bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-sm font-mono shrink-0">
                    •
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-app-fg truncate">
                      {getStandardFieldLabel(field)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-app-fg-muted">
                      <span>{STANDARD_FIELD_LABELS[field.key]}</span>
                      {field.required ? (
                        <span className="rounded-full bg-danger-50 px-2 py-0.5 text-danger-700 dark:bg-danger-900/20 dark:text-danger-300">
                          Required
                        </span>
                      ) : null}
                      {getStandardFieldLabel(field) !== getDefaultStandardFieldLabel(field.key) ? (
                        <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300">
                          Label edited
                        </span>
                      ) : null}
                      {(ADDITIONAL_FIELD_OPTION_KEYS as readonly StandardFieldKey[]).includes(field.key) ? (
                        <span className="rounded-full bg-app-canvas px-2 py-0.5">Options editable</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button type="button" variant="secondary" size="sm" className="text-xs" onClick={() => setEditingFieldKey(field.key)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs text-danger-600 hover:text-danger-700"
                      onClick={() => removeField(field.key)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}

            {remaining.length > 0 ? (
              <div className="pt-2 border-t border-app-border">
                <p className="text-xs font-medium text-app-fg-muted uppercase tracking-wider mb-2">Add field</p>
                <div className="flex flex-wrap gap-2">
                  {remaining.map((key) => (
                    <Button key={key} type="button" size="sm" variant="secondary" onClick={() => addField(key)}>
                      + {STANDARD_FIELD_LABELS[key]}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {editingField ? (
        <StandardFieldEditorModal
          field={editingField}
          selectOptions={selectOptions}
          onClose={() => setEditingFieldKey(null)}
          onSave={({ fieldPatch, selectOptionsPatch }) => {
            updateField(editingField.key, fieldPatch);
            if (selectOptionsPatch) patchSelectOptions(selectOptionsPatch);
            setEditingFieldKey(null);
          }}
        />
      ) : null}
    </div>
  );
}

function StandardFieldEditorModal({
  field,
  selectOptions,
  onClose,
  onSave,
}: {
  field: StandardFieldConfig;
  selectOptions: AdditionalFieldSelectOptionsState;
  onClose: () => void;
  onSave: (payload: {
    fieldPatch: Pick<StandardFieldConfig, 'label' | 'required'>;
    selectOptionsPatch?: Partial<AdditionalFieldSelectOptionsState>;
  }) => void;
}) {
  const [label, setLabel] = useState(getStandardFieldLabel(field));
  const [required, setRequired] = useState(field.required);
  const [deliveryStateOptions, setDeliveryStateOptions] = useState(joinOptionLines(selectOptions.deliveryStateOptions));
  const [preferredDeliveryDateOptions, setPreferredDeliveryDateOptions] = useState(selectOptions.preferredDeliveryDateOptions);
  const [genderOptions, setGenderOptions] = useState(joinOptionLines(selectOptions.genderOptions));

  const supportsOptions = (ADDITIONAL_FIELD_OPTION_KEYS as readonly StandardFieldKey[]).includes(field.key);
  const trimmedLabel = label.trim();
  const labelError = trimmedLabel.length === 0 ? 'Label is required' : undefined;

  const selectOptionsPatch = useMemo<Partial<AdditionalFieldSelectOptionsState> | undefined>(() => {
    if (!supportsOptions) return undefined;
    if (field.key === 'deliveryState') {
      return { deliveryStateOptions: parseOptionLines(deliveryStateOptions) };
    }
    if (field.key === 'preferredDeliveryDate') {
      return { preferredDeliveryDateOptions };
    }
    return { genderOptions: parseOptionLines(genderOptions) };
  }, [deliveryStateOptions, field.key, genderOptions, preferredDeliveryDateOptions, supportsOptions]);

  return (
    <Modal open onClose={onClose} maxWidth="max-w-lg" contentClassName="p-6 space-y-4 bg-app-elevated">
      <div>
        <h3 className="text-lg font-semibold text-app-fg">Edit additional field</h3>
        <p className="text-xs text-app-fg-muted mt-0.5">Update the label, requirement, and options for this built-in field.</p>
      </div>

      <TextInput
        label="Field label"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        maxLength={120}
        required
        error={labelError}
        placeholder={getDefaultStandardFieldLabel(field.key)}
      />

      <div className="rounded-lg border border-app-border bg-app-canvas px-3 py-2 text-xs text-app-fg-muted">
        Built-in field: <span className="font-medium text-app-fg">{STANDARD_FIELD_LABELS[field.key]}</span>
      </div>

      <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={required} onChange={(e) => setRequired(e.target.checked)} />
        <span className="text-sm text-app-fg">Required on the public form</span>
      </label>

      {supportsOptions ? (
        field.key === 'deliveryState' ? (
          <Textarea
            label="Delivery state options"
            rows={5}
            value={deliveryStateOptions}
            onChange={(e) => setDeliveryStateOptions(e.target.value)}
            className="font-mono"
            placeholder="One option per line"
            hint="One per line. Clear all and save to use the default Nigerian states list."
          />
        ) : field.key === 'preferredDeliveryDate' ? (
          <ChipInput
            label="Preferred delivery date options"
            value={preferredDeliveryDateOptions}
            onChange={setPreferredDeliveryDateOptions}
            placeholder="Type an option and press Enter…"
            hint="Press Enter to add. Clear all and save to use the default timing choices."
          />
        ) : (
          <Textarea
            label="Gender options"
            rows={3}
            value={genderOptions}
            onChange={(e) => setGenderOptions(e.target.value)}
            className="font-mono"
            placeholder="One option per line"
            hint="One per line. Clear all and save to use Male / Female."
          />
        )
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-app-border">
        <Button variant="secondary" size="sm" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() =>
            onSave({
              fieldPatch: { label: trimmedLabel, required },
              ...(selectOptionsPatch ? { selectOptionsPatch } : {}),
            })
          }
          disabled={!!labelError}
        >
          Save changes
        </Button>
      </div>
    </Modal>
  );
}
