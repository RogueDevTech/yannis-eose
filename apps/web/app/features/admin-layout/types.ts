export interface AdminErrorBoundaryProps {
  error: unknown;
  isResponse: boolean;
  status: number;
  errorData?: unknown;
}
