export type AutomationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type AutomationRuleKind = 'EVENT' | 'SEGMENT';

export interface AutomationTemplateRow {
  id: string;
  name: string;
  channels: AutomationChannel[];
  subject: string | null;
  body: string;
  status: 'ACTIVE' | 'ARCHIVED';
  createdAt: string;
}

export interface TargetGroupFilter {
  minOrders?: number;
  maxOrders?: number;
  statuses?: string[];
  branchIds?: string[];
  sinceDays?: number;
  orderSource?: 'edge-form' | 'offline' | 'any';
}

export interface TargetGroupRow {
  id: string;
  name: string;
  description: string | null;
  sourceKind: 'RULE' | 'UPLOAD' | 'MANUAL';
  filter: TargetGroupFilter;
  enabled: boolean;
  memberCount: number;
  createdAt: string;
}

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
