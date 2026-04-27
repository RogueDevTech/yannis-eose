import { Button } from '~/components/ui/button';
import { Checkbox } from '~/components/ui/checkbox';
import type { StandardFieldConfig, StandardFieldKey } from './types';
import { STANDARD_FIELD_LABELS, STANDARD_FIELD_ORDER } from './standard-fields';

interface StandardFieldsEditorProps {
  fields: StandardFieldConfig[];
  onFieldsChange: (next: StandardFieldConfig[]) => void;
}

export function StandardFieldsEditor({ fields, onFieldsChange }: StandardFieldsEditorProps) {
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

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-app-fg">Standard fields</h2>
          <span className="text-xs text-app-fg-muted">{fields.length} of {STANDARD_FIELD_ORDER.length}</span>
        </div>

        {fields.length === 0 ? (
          <div className="border border-dashed border-app-border rounded-lg p-8 text-center">
            <p className="text-sm font-medium text-app-fg mb-1">No standard fields added</p>
            <p className="text-xs text-app-fg-muted mb-4">Add built-in fields like Delivery State and mark each as optional or required.</p>
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
              <div key={field.key} className="group flex items-center gap-2 rounded-lg border bg-app-elevated p-3 border-app-border hover:border-app-border-strong transition-colors">
                <span className="w-7 h-7 inline-flex items-center justify-center rounded bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 text-sm font-mono shrink-0">
                  •
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-app-fg truncate">
                    {STANDARD_FIELD_LABELS[field.key]}
                    {field.required && <span className="text-danger-500 ml-1">*</span>}
                  </p>
                  <p className="text-xs text-app-fg-muted">Standard field</p>
                </div>
                <label className="flex items-center gap-1.5 shrink-0 text-app-fg-muted" title="Require this field on the public form">
                  <Checkbox checked={field.required} onChange={(e) => updateRequired(field.key, e.target.checked)} />
                  <span className="text-xs">Required</span>
                </label>
                <Button type="button" variant="ghost" size="sm" className="text-xs text-danger-600 hover:text-danger-700" onClick={() => removeField(field.key)}>
                  Remove
                </Button>
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
