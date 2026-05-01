export interface AuthActionData {
  error?: string;
  success?: string;
}

export interface AuthPageProps {
  needsSetup: boolean;
  /** Allowed deep link after sign-in (from `?redirectTo=`); echoed in hidden form fields so POST keeps it. */
  redirectTo: string | null;
  actionData?: AuthActionData;
}
