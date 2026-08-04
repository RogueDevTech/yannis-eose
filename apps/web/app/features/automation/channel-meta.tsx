import type { ReactElement } from 'react';
import type { AutomationChannel } from './types';

/** Display metadata for each channel: label + inline SVG icon. Used by the create
 *  form's icon checkboxes and the rules list. */
export const CHANNEL_META: Record<
  AutomationChannel,
  { label: string; icon: (props: { className?: string }) => ReactElement }
> = {
  EMAIL: {
    label: 'Email',
    icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" strokeLinejoin="round" />
        <path d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  SMS: {
    label: 'SMS',
    icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-3.9-.9L3 20l1.4-4.1A8.38 8.38 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12 3a8.5 8.5 0 0 1 9 8.5Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  WHATSAPP: {
    label: 'WhatsApp',
    icon: ({ className }) => (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.24.68-1.42 1.32-1.96 1.36-.5.04-.5.4-3.16-.66-2.66-1.06-4.32-3.79-4.45-3.97-.13-.18-1.06-1.41-1.06-2.69 0-1.28.67-1.91.91-2.17.24-.26.52-.33.7-.33.17 0 .35 0 .5.01.16.01.38-.06.59.45.24.58.8 2 .87 2.15.07.14.12.31.02.5-.09.18-.14.29-.28.45-.14.16-.29.36-.42.48-.14.13-.28.28-.12.55.16.27.71 1.17 1.53 1.9 1.05.93 1.94 1.22 2.21 1.36.27.14.43.12.59-.07.16-.19.68-.79.86-1.06.18-.27.36-.22.6-.13.24.09 1.55.73 1.82.86.27.13.45.2.51.31.07.11.07.64-.17 1.32Z" />
      </svg>
    ),
  },
};

export const ALL_CHANNELS: AutomationChannel[] = ['EMAIL', 'SMS', 'WHATSAPP'];
