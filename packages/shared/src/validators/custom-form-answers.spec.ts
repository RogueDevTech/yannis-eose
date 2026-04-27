import { describe, it, expect } from 'vitest';
import { getMissingRequiredCustomFormLabels, type CustomFormField } from './marketing';

const FID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const FID2 = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';

const base = (id: string, type: CustomFormField['type'], required: boolean, order: number): CustomFormField => ({
  id,
  type,
  label: 'L',
  required,
  order,
});

describe('getMissingRequiredCustomFormLabels', () => {
  it('returns empty when no required fields', () => {
    const fields: CustomFormField[] = [base(FID, 'text', false, 0)];
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: '' })).toEqual([]);
  });

  it('flags required text when empty or missing', () => {
    const fields: CustomFormField[] = [base(FID, 'text', true, 0)];
    expect(getMissingRequiredCustomFormLabels(fields, {})).toEqual(['L']);
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: '  ' })).toEqual(['L']);
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: 'ok' })).toEqual([]);
  });

  it('allows number 0 for required number', () => {
    const fields: CustomFormField[] = [base(FID, 'number', true, 0)];
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: 0 })).toEqual([]);
  });

  it('requires at least one checkbox in required checkbox_group', () => {
    const fields: CustomFormField[] = [base(FID, 'checkbox_group', true, 0)];
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: [] })).toEqual(['L']);
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: ['A'] })).toEqual([]);
  });

  it('required toggle is satisfied only by true', () => {
    const fields: CustomFormField[] = [base(FID, 'toggle', true, 0)];
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: false })).toEqual(['L']);
    expect(getMissingRequiredCustomFormLabels(fields, { [FID]: true })).toEqual([]);
  });

  it('collects multiple missing labels', () => {
    const fields: CustomFormField[] = [base(FID, 'text', true, 0), { ...base(FID2, 'text', true, 1), label: 'Z' }];
    expect(getMissingRequiredCustomFormLabels(fields, {})).toEqual(['L', 'Z']);
  });
});
