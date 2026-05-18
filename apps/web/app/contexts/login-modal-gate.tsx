import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';

/**
 * Serializes login-time prompts so only one modal is visible at a time.
 * Onboarding nudge holds `blocking` while open; push banner schedules only when `clear`.
 */
export type OnboardingModalGate = 'pending' | 'clear' | 'blocking';

const LoginModalGateContext = createContext<{
  onboardingGate: OnboardingModalGate;
  setOnboardingGate: Dispatch<SetStateAction<OnboardingModalGate>>;
} | null>(null);

export const LoginModalGateProvider = LoginModalGateContext.Provider;

export function useLoginModalGate() {
  const ctx = useContext(LoginModalGateContext);
  if (!ctx) {
    throw new Error('useLoginModalGate must be used within LoginModalGateProvider');
  }
  return ctx;
}
