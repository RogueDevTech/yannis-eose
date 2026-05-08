export interface AdminErrorBoundaryProps {
  error: unknown;
  isResponse: boolean;
  status: number;
  errorData?: unknown;
  /**
   * Home path to send users to from the 403 / 404 / generic-server error screens
   * and the modal "Go back" fallback when there's no browser history. Default
   * `/admin` (back-compat for admin + HR). Pass `/tpl` for the TPL portal,
   * `/rider` for the rider PWA, etc.
   */
  homePath?: string;
  /**
   * Label shown on the "Back to <home>" buttons. Default `Dashboard`. Pass
   * `Home` for portals where "Dashboard" doesn't fit.
   */
  homeLabel?: string;
}
