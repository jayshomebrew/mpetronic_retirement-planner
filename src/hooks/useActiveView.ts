import { useState, useEffect, useCallback } from 'react';
import { ActiveViewType } from '../components/SidebarNavigation';

export const VALID_VIEWS: Set<ActiveViewType> = new Set([
  'overview',
  'taxable-income',
  'lookback-ledger',
  'monte-carlo',
  'compare',
  'actuals',
  'bucket-management',
  'params-profiles',
  'params-filing-status',
  'params-residency',
  'params-healthcare',
  'params-accounts',
  'params-expenses',
  'params-charity',
  'params-data',
  'params-reset',
]);

const SESSION_STORAGE_KEY = 'retirement_planner_active_view';
const LEGACY_LOCAL_STORAGE_KEY = 'retirement_planner_active_view';

/**
 * Reads the active view from the URL query params (?view=...),
 * URL hash (#...), sessionStorage, or falls back to 'overview'.
 */
export function getInitialActiveView(): ActiveViewType {
  if (typeof window === 'undefined') return 'overview';

  // 1. Query parameter: ?view=<view>
  try {
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view') as ActiveViewType | null;
    if (viewParam && VALID_VIEWS.has(viewParam)) {
      return viewParam;
    }
  } catch (err) {
    console.warn('Failed to parse URL search params for active view:', err);
  }

  // 2. Hash fallback: #<view>
  try {
    const hash = window.location.hash.replace(/^#/, '') as ActiveViewType;
    if (hash && VALID_VIEWS.has(hash)) {
      return hash;
    }
  } catch (err) {
    console.warn('Failed to parse URL hash for active view:', err);
  }

  // 3. Tab-isolated session storage fallback
  try {
    const sessionVal = window.sessionStorage.getItem(SESSION_STORAGE_KEY) as ActiveViewType | null;
    if (sessionVal && VALID_VIEWS.has(sessionVal)) {
      return sessionVal;
    }
  } catch (err) {
    console.warn('Failed to read sessionStorage for active view:', err);
  }

  // Clean up legacy localStorage key to stop cross-tab mirroring
  try {
    window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // Ignore
  }

  return 'overview';
}

/**
 * Updates the browser's URL search parameter (?view=...) without full page reload.
 */
export function syncViewToUrl(view: ActiveViewType, replace: boolean = false) {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('view', view);
    const targetUrl = url.pathname + url.search + url.hash;

    if (replace) {
      window.history.replaceState({ view }, '', targetUrl);
    } else {
      window.history.pushState({ view }, '', targetUrl);
    }
  } catch (err) {
    console.warn('Failed to sync active view to URL:', err);
  }
}

/**
 * Custom hook providing URL-driven, tab-isolated active workspace navigation.
 * Each tab independently manages its own workspace view in the URL and sessionStorage.
 */
export function useActiveView(defaultView: ActiveViewType = 'overview'): [
  ActiveViewType,
  (next: ActiveViewType | ((prev: ActiveViewType) => ActiveViewType)) => void
] {
  const [activeView, setActiveViewState] = useState<ActiveViewType>(() => {
    const initial = getInitialActiveView();
    return VALID_VIEWS.has(initial) ? initial : defaultView;
  });

  // Ensure initial URL reflects current view if missing ?view=
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('view')) {
        syncViewToUrl(activeView, true);
      }
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, activeView);
      window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    } catch (err) {
      console.warn('Failed to initialize active view URL state:', err);
    }
  }, [activeView]);

  // Handle browser Back / Forward buttons (popstate events)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const viewParam = params.get('view') as ActiveViewType | null;
        if (viewParam && VALID_VIEWS.has(viewParam)) {
          setActiveViewState(viewParam);
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, viewParam);
          return;
        }

        const hash = window.location.hash.replace(/^#/, '') as ActiveViewType;
        if (hash && VALID_VIEWS.has(hash)) {
          setActiveViewState(hash);
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, hash);
          return;
        }

        setActiveViewState(defaultView);
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, defaultView);
      } catch (err) {
        console.warn('Error handling popstate for active view:', err);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [defaultView]);

  const setActiveView = useCallback(
    (next: ActiveViewType | ((prev: ActiveViewType) => ActiveViewType)) => {
      setActiveViewState((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        if (!VALID_VIEWS.has(resolved) || resolved === prev) {
          return prev;
        }

        try {
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, resolved);
        } catch (err) {
          console.warn('Failed to write active view to sessionStorage:', err);
        }

        syncViewToUrl(resolved, false);
        return resolved;
      });
    },
    []
  );

  return [activeView, setActiveView];
}
