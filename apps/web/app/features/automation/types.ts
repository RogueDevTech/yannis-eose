export type AutomationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type AutomationRuleKind = 'EVENT' | 'SEGMENT';

export interface AutomationRuleRow {
  id: string;
  name: string;
  kind: AutomationRuleKind;
  channels: AutomationChannel[];
  templateId: string | null;
  delayMinutes: number | null;
  scheduleCron: string | null;
  respectOptOut: boolean;
  priority: number;
  enabled: boolean;
  sourceBranchId: string | null;
  createdAt: string;
}
