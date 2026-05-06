import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import { Textarea } from '~/components/ui/textarea';
import { ChipInput } from '~/components/ui/chip-input';
import type { StandardFieldConfig, StandardFieldKey } from './types';
import {
  ADDITIONAL_FIELD_OPTION_KEYS,
  type AdditionalFieldSelectOptionsState,
  joinOptionLines,
  parseOptionLines,
  STANDARD_FIELD_LABELS,
  STANDARD_FIELD_ORDER,
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
  const selected = new Set(fields.map((f) => f.key));
  const remaining = STANDARD_FIELD_ORDER.filter((key) => !selected.has(key));

  function addField(key: StandardFieldKey) {
    onFieldsChange([...fields, { key, required: false }]);
  }

  function removeField(key: StandardFieldKey) {
    onFieldsChange(fields.filter((f) => f.key !== key));
  }

  function updateRequired(key: StandardFieldKey, required: boolean) {
    onFieldsChange(fields.map((f) => (f.key === key ? { ...f, required } : f)));
  }

  function patchSelectOptions(patch: Partial<AdditionalFieldSelectOptionsState>) {
    onSelectOptionsChange({ ...selectOptions, ...patch });
  }

  function optionBlock(key: StandardFieldKey) {
    if (!(ADDITIONAL_FIELD_OPTION_KEYS as readonly StandardFieldKey[]).includes(key)) return null;

    if (key === 'deliveryState') {
      return (
        <div className="mt-2 pt-2 border-t border-app-border">
          <label className="block text-xs font-medium text-app-fg-muted mb-1">Delivery state options</label>
          <Textarea
            rows={5}
            value={joinOptionLines(selectOptions.deliveryStateOptions)}
            onChange={(e) => patchSelectOptions({ deliveryStateOptions: parseOptionLines(e.target.value) })}
            className="textarea textarea-bordered text-sm font-mono"
            placeholder="One option per line"
          />
          <p className="text-[11px] text-app-fg-muted mt-1">
            One per line. Starts from the default Nigerian states list; clear all and save to use that default on the live
            form.
          </p>
        </div>
      );
    }
    if (key === 'preferredDeliveryDate') {
      return (
        <div className="mt-2 pt-2 border-t border-app-border">
          <ChipInput
            label="Preferred delivery date options"
            value={selectOptions.preferredDeliveryDateOptions}
            onChange={(next) => patchSelectOptions({ preferredDeliveryDateOptions: next })}
            placeholder="Type an option and press Enter…"
            hint="Press Enter to add. Backspace on empty input removes the last chip. Clear all and save to use the default timing choices on the live form."
          />
        </div>
      );
    }
    return (
      <div className="mt-2 pt-2 border-t border-app-border">
        <label className="block text-xs font-medium text-app-fg-muted mb-1">Gender options</label>
        <Textarea
          rows={3}
          value={joinOptionLines(selectOptions.genderOptions)}
          onChange={(e) => patchSelectOptions({ genderOptions: parseOptionLines(e.target.value) })}
          className="textarea textarea-bordered text-sm font-mono"
          placeholder="One option per line"
        />
        <p className="text-[11px] text-app-fg-muted mt-1">
          One per line. Clear all and save to use Male / Female on the live form.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex justify-end mb-2">
          <span className="text-xs text-app-fg-muted">
            {fields.length} of {STANDARD_FIELD_ORDER.length} selected
          </span>
        </div>

        {fields.length === 0 ? (
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
            {fields.map((field) => (
              <div
                key={field.key}
                className="group rounded-lg border bg-app-elevated p-3 border-app-border hover:border-app-border-strong transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 inline-flex items-center justify-center rounded bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-sm font-mono shrink-0">
                    •
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-app-fg truncate">
                      {STANDARD_FIELD_LABELS[field.key]}
                      {field.required && <span className="text-danger-500 ml-1">*</span>}
                    </p>
                    <p className="text-xs text-app-fg-muted">Additional field</p>
                  </div>
                  <label className="flex items-center gap-1.5 shrink-0 text-app-fg-muted" title="Require this field on the public form">
                    <Checkbox checked={field.required} onChange={(e) => updateRequired(field.key, e.target.checked)} />
                    <span className="text-xs">Required</span>
                  </label>
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
                {optionBlock(field.key)}
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
    </div>
  );
}
