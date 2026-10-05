import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getInitialActiveView, syncViewToUrl, VALID_VIEWS } from './useActiveView';
import { ActiveViewType } from '../components/SidebarNavigation';

describe('useActiveView navigation utilities', () => {
  const originalWindow = (globalThis as unknown as { window?: unknown }).window;
  const mockSessionStorage = new Map<string, string>();
  const mockLocalStorage = new Map<string, string>();
  let currentHref = 'http://localhost:5173/planner';

  beforeEach(() => {
    mockSessionStorage.clear();
    mockLocalStorage.clear();
    currentHref = 'http://localhost:5173/planner';

    const mockWindow = {
      location: {
        get search() {
          return new URL(currentHref).search;
        },
        get hash() {
          return new URL(currentHref).hash;
        },
        get href() {
          return currentHref;
        },
        get pathname() {
          return new URL(currentHref).pathname;
        },
      },
      sessionStorage: {
        getItem: (k: string) => mockSessionStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockSessionStorage.set(k, v);
        },
        removeItem: (k: string) => {
          mockSessionStorage.delete(k);
        },
        clear: () => {
          mockSessionStorage.clear();
        },
      },
      localStorage: {
        getItem: (k: string) => mockLocalStorage.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mockLocalStorage.set(k, v);
        },
        removeItem: (k: string) => {
          mockLocalStorage.delete(k);
        },
        clear: () => {
          mockLocalStorage.clear();
        },
      },
      history: {
        replaceState: (_data: unknown, _unused: string, url: string) => {
          currentHref = new URL(url, 'http://localhost:5173').href;
        },
        pushState: (_data: unknown, _unused: string, url: string) => {
          currentHref = new URL(url, 'http://localhost:5173').href;
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    (globalThis as unknown as { window: typeof mockWindow }).window = mockWindow;
  });

  afterEach(() => {
    (globalThis as unknown as { window: typeof originalWindow }).window = originalWindow;
  });

  describe('VALID_VIEWS', () => {
    it('contains all core workspaces and parameter tabs', () => {
      expect(VALID_VIEWS.has('overview')).toBe(true);
      expect(VALID_VIEWS.has('taxable-income')).toBe(true);
      expect(VALID_VIEWS.has('lookback-ledger')).toBe(true);
      expect(VALID_VIEWS.has('monte-carlo')).toBe(true);
      expect(VALID_VIEWS.has('compare')).toBe(true);
      expect(VALID_VIEWS.has('actuals')).toBe(true);
      expect(VALID_VIEWS.has('bucket-management')).toBe(true);
      expect(VALID_VIEWS.has('params-expenses')).toBe(true);
    });

    it('rejects invalid view names', () => {
      expect(VALID_VIEWS.has('invalid-view' as unknown as ActiveViewType)).toBe(false);
      expect(VALID_VIEWS.has('unknown' as unknown as ActiveViewType)).toBe(false);
    });
  });

  describe('getInitialActiveView', () => {
    it('defaults to overview when no URL param or session storage exists', () => {
      currentHref = 'http://localhost:5173/planner';
      expect(getInitialActiveView()).toBe('overview');
    });

    it('reads valid view from URL search params ?view=...', () => {
      currentHref = 'http://localhost:5173/planner?view=taxable-income';
      expect(getInitialActiveView()).toBe('taxable-income');
    });

    it('ignores invalid view in URL search params and falls back to session/default', () => {
      currentHref = 'http://localhost:5173/planner?view=bogus-section';
      expect(getInitialActiveView()).toBe('overview');
    });

    it('reads valid view from URL hash as fallback', () => {
      currentHref = 'http://localhost:5173/planner#bucket-management';
      expect(getInitialActiveView()).toBe('bucket-management');
    });

    it('reads from sessionStorage when no URL param exists', () => {
      currentHref = 'http://localhost:5173/planner';
      mockSessionStorage.set('retirement_planner_active_view', 'monte-carlo');
      expect(getInitialActiveView()).toBe('monte-carlo');
    });

    it('prioritizes URL search param over sessionStorage', () => {
      currentHref = 'http://localhost:5173/planner?view=actuals';
      mockSessionStorage.set('retirement_planner_active_view', 'compare');
      expect(getInitialActiveView()).toBe('actuals');
    });

    it('cleans up legacy localStorage key to prevent cross-tab mirroring', () => {
      mockLocalStorage.set('retirement_planner_active_view', 'overview');
      getInitialActiveView();
      expect(mockLocalStorage.get('retirement_planner_active_view')).toBeUndefined();
    });
  });

  describe('syncViewToUrl', () => {
    it('sets the ?view= search parameter without reloading', () => {
      currentHref = 'http://localhost:5173/planner';
      syncViewToUrl('taxable-income', true);
      expect(currentHref).toBe('http://localhost:5173/planner?view=taxable-income');
    });

    it('updates URL search parameter when navigating to another view', () => {
      currentHref = 'http://localhost:5173/planner?view=overview';
      syncViewToUrl('bucket-management', false);
      expect(currentHref).toBe('http://localhost:5173/planner?view=bucket-management');
    });
  });
});
