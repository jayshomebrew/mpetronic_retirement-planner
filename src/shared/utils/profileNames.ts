import { AuthService } from '../auth/AuthService';

export interface PlannerProfileNames {
  primaryName: string;
  spouseName: string;
  isSingleFiler: boolean;
}

export function getPlannerProfileNames(): PlannerProfileNames {
  if (typeof window === 'undefined') {
    return { primaryName: 'Primary', spouseName: 'Spouse', isSingleFiler: false };
  }

  try {
    const rawInputs = window.localStorage.getItem('retirement_planner_inputs');
    if (rawInputs) {
      const parsed = JSON.parse(rawInputs);
      const primaryName = parsed.you?.name?.trim() || 'Primary';
      const spouseName = parsed.wife?.name?.trim() || parsed.spouse?.name?.trim() || 'Spouse';
      const isSingleFiler = Boolean(parsed.isSingleFiler);
      return { primaryName, spouseName, isSingleFiler };
    }

    const rawProfiles = window.localStorage.getItem('retirement_planner_profile_names');
    if (rawProfiles) {
      const parsed = JSON.parse(rawProfiles);
      const primaryName = parsed.primaryName?.trim() || 'Primary';
      const spouseName = parsed.spouseName?.trim() || 'Spouse';
      const isSingleFiler = Boolean(parsed.isSingleFiler);
      return { primaryName, spouseName, isSingleFiler };
    }
  } catch (err) {
    console.error('Failed to read planner profile names:', err);
  }

  return { primaryName: 'Primary', spouseName: 'Spouse', isSingleFiler: false };
}

/**
 * Resolve the current user's display payer name from Cognito AuthSession & configured household profiles
 */
export function resolveLoggedInPayerName(): string {
  const profileNames = getPlannerProfileNames();
  const session = AuthService.getSession();

  if (!session) {
    return profileNames.primaryName;
  }

  // 1. Highest priority: Cognito 'nickname' attribute if configured
  if (session.nickname && session.nickname.trim()) {
    return session.nickname.trim();
  }

  // 2. Second priority: Cognito 'given_name' attribute if configured
  if (session.givenName && session.givenName.trim()) {
    return session.givenName.trim();
  }

  if (!session.email) {
    return profileNames.primaryName;
  }

  const email = session.email.toLowerCase().trim();
  const primaryClean = profileNames.primaryName.toLowerCase().trim();
  const spouseClean = profileNames.spouseName.toLowerCase().trim();

  // If email contains configured spouse name
  if (spouseClean && spouseClean !== 'spouse' && email.includes(spouseClean)) {
    return profileNames.spouseName;
  }

  // If email contains configured primary name
  if (primaryClean && primaryClean !== 'primary' && email.includes(primaryClean)) {
    return profileNames.primaryName;
  }

  // If primary is configured with a real name (not placeholder "Primary"), default to that for the household primary owner
  if (profileNames.primaryName && profileNames.primaryName !== 'Primary') {
    return profileNames.primaryName;
  }

  // Extract a readable first name from email (e.g. user.name@example.com -> User)
  const prefix = email.split('@')[0];
  const namePart = prefix.split('.')[0];
  return namePart.charAt(0).toUpperCase() + namePart.slice(1);
}

