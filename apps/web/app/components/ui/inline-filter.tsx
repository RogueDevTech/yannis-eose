/**
 * InlineFilter — consistent wrapper for toolbar filter controls.
 *
 * Encapsulates the `<div className="relative"> + FilterDismiss + control` pattern
 * used across every list page. Controls render at `controlSize="sm"` by default
 * so filter bars blend with stat strips.
 *
 * Usage:
 *   <InlineFilter
 *     type="select"
 *     value={status}
 *     onChange={(v) => setFilter('status', v)}
 *     options={statusOptions}
 *     defaultValue="ALL"
 *     width="status"
 *   />
 *
 *   <InlineFilter
 *     type="searchable"
 *     value={mediaBuyerId}
 *     onChange={(v) => setFilter('mediaBuyerId', v)}
 *     options={mediaBuyerOptions}
 *     defaultValue="ALL"
 *     placeholder="All media buyers"
 *     searchPlaceholder="Search buyers…"
 *     width="user"
 *   />
 */

import type { SearchableSelectOption } from './searchable-select';
import { FormSelect } from './form-select';
import { SearchableSelect } from './searchable-select';
import { FilterDismiss } from './filter-dismiss';

type FilterWidth = 'status' | 'role' | 'department' | 'branch' | 'user' | 'location' | 'product' | 'sort';

const WIDTH_CLASSES: Record<FilterWidth, string> = {
  status: 'w-full min-w-0 sm:w-40',
  role: 'w-full min-w-0 sm:w-48',
  department: 'w-full min-w-0 sm:w-40',
  branch: 'w-full min-w-0 sm:w-52',
  user: 'w-full min-w-0 sm:w-56',
  location: 'w-full min-w-0 sm:w-52',
  product: 'w-full min-w-0 sm:w-48',
  sort: 'w-full min-w-0 sm:w-44',
};

interface BaseProps {
  /** Current value. */
  value: string;
  /** Called when value changes. */
  onChange: (value: string) => void;
  /** The "default" / inactive value (e.g. 'ALL', ''). When value !== defaultValue, FilterDismiss shows. */
  defaultValue?: string;
  /** Called when FilterDismiss is clicked. Defaults to `onChange(defaultValue)`. */
  onClear?: () => void;
  /** Semantic width preset. Pass a string className to override. */
  width?: FilterWidth | (string & {});
  /** Disable the control. */
  disabled?: boolean;
}

interface SelectFilterProps extends BaseProps {
  type: 'select';
  options: Array<{ value: string; label: string }>;
  /** FormSelect groups — mutually exclusive with options when using grouped rendering. */
  groups?: Array<{ label: string; options: Array<{ value: string; label: string }> }>;
  label?: string;
}

interface SearchableFilterProps extends BaseProps {
  type: 'searchable';
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  id?: string;
  label?: string;
}

export type InlineFilterProps = SelectFilterProps | SearchableFilterProps;

export function InlineFilter(props: InlineFilterProps) {
  const { value, onChange, defaultValue = '', disabled } = props;
  const isActive = value !== defaultValue;
  const handleClear = props.onClear ?? (() => onChange(defaultValue));

  const widthClass =
    props.width && props.width in WIDTH_CLASSES
      ? WIDTH_CLASSES[props.width as FilterWidth]
      : props.width ?? WIDTH_CLASSES.status;

  return (
    <div className="relative">
      {isActive && <FilterDismiss onClear={handleClear} />}
      {props.type === 'select' ? (
        <FormSelect
          label={props.label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={props.options}
          groups={props.groups}
          controlSize="sm"
          disabled={disabled}
          wrapperClassName={widthClass}
        />
      ) : (
        <SearchableSelect
          id={props.id}
          label={props.label}
          value={value}
          onChange={onChange}
          options={props.options}
          controlSize="sm"
          disabled={disabled}
          placeholder={props.placeholder}
          searchPlaceholder={props.searchPlaceholder}
          wrapperClassName={widthClass}
        />
      )}
    </div>
  );
}
