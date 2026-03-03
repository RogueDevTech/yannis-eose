export interface AuthActionData {
  error?: string;
  success?: string;
}

export interface AuthPageProps {
  needsSetup: boolean;
  actionData?: AuthActionData;
}
