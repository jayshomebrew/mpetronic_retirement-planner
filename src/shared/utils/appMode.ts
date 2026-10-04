/**
 * Application operating mode definitions:
 * - 'demo': Ephemeral, in-memory sample demonstration mode.
 * - 'localhost': Local development mode (npm run dev) running strictly against LocalStorage with cloud mutations disabled.
 * - 'production': CloudFront production deployment running with AWS Cognito + DynamoDB backend.
 */
export type AppMode = 'demo' | 'localhost' | 'production';

export function isLocalhostEnvironment(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  const hostname = window.location.hostname || '';
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
}

export function resolveAppMode(isDemoMode: boolean, isAuthenticated: boolean = false): AppMode {
  if (isDemoMode) return 'demo';
  if (isLocalhostEnvironment()) return 'localhost';
  return isAuthenticated ? 'production' : 'localhost';
}

