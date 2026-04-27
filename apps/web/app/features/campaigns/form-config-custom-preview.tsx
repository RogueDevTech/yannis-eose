import { TextInput } from '~/components/ui/text-input';
import { Textarea } from '~/components/ui/textarea';
import { FormSelect } from '~/components/ui/form-select';
import type { CustomFormField, CustomFormFieldType } from './types';

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

export { FIELD_TYPE_META };

export interface FormConfigCustomFieldsPreviewProps {
  fields: CustomFormField[];
  accentColor: string;
  /** If false, the outer border/wrap is omitted (e.g. nested in another card). */
  withOuterWrap?: boolean;
  emptyMessage?: string;
  className?: string;
}

/**
 * Read-only preview of custom form fields (same as hosted Edge order of custom field types).
 */
export function FormConfigCustomFieldsPreview({
  fields,
  accentColor,
  withOuterWrap = true,
  emptyMessage = 'Add a custom field in the list to see it here.',
  className = '',
}: FormConfigCustomFieldsPreviewProps) {
  if (fields.length === 0) {
    return (
      <div
        className={[
          withOuterWrap
            ? 'border border-dashed border-app-border rounded-lg p-6 text-center text-sm text-app-fg-muted'
            : 'text-center text-xs text-app-fg-muted py-2',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {emptyMessage}
      </div>
    );
  }
  const inner = (
    <div className={['space-y-4', withOuterWrap ? 'rounded-lg bg-app-canvas p-4 border border-app-border' : 'space-y-3', className].filter(Boolean).join(' ')}>
      {fields.map((field) => (
        <FormConfigCustomFieldBlock key={field.id} field={field} accentColor={accentColor} />
      ))}
    </div>
  );
  return inner;
}

function FormConfigCustomFieldBlock({ field, accentColor }: { field: CustomFormField; accentColor: string }) {
  const labelEl = (
    <label className="block text-sm font-medium text-app-fg mb-1">
      {field.label}
      {field.required && <span className="text-danger-500 ml-0.5">*</span>}
    </label>
  );
  const helpEl = field.helpText ? <p className="mt-1 text-xs text-app-fg-muted">{field.helpText}</p> : null;
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
            type={
              field.type === 'phone'
                ? 'tel'
                : field.type === 'date'
                  ? 'date'
                  : field.type === 'number'
                    ? 'number'
                    : field.type === 'email'
                      ? 'email'
                      : 'text'
            }
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
