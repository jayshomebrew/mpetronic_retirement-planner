import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Trash2,
  Calendar,
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  WifiOff,
  History,
  X,
  Sparkles,
  Utensils,
  ShoppingCart,
  Zap,
  HeartPulse,
  Plane,
  Home,
  Car,
  Film,
  Gift,
  Tag,
  Search,
  ChevronDown,
  Delete,
  Cloud,
  Menu,
  User,
  LogIn,
  LogOut,
  Info,
  Pencil,
  Check,
  Smartphone,
} from 'lucide-react';
import { getStorageAdapter, AwsCloudStorageAdapter, PlanSyncService } from '../../shared/storage';
import { ActualExpense, ExpenseCategory } from '../../shared/types/expenses';
import { resolveLoggedInPayerName } from '../../shared/utils/profileNames';
import { AuthService } from '../../shared/auth/AuthService';
import { isLocalhostEnvironment } from '../../shared/utils/appMode';
import { CloudAuthModal } from '../../components/CloudAuthModal';
import { AboutDialog } from '../../components/AboutDialog';
import { getVersionInfo } from '../../utils/version';
import {
  getPlannerExpenseCatalog,
  getPlannerCategories,
  mergeWithCustomCategories,
  savePlannerExpenseLineItem,
  syncPlannerCatalogToCloudStorage,
  PlannerExpenseLineItem,
} from '../../shared/utils/plannerCategories';

const ICON_MAP: Record<string, React.ReactNode> = {
  Utensils: <Utensils className="w-4 h-4" />,
  ShoppingCart: <ShoppingCart className="w-4 h-4" />,
  Zap: <Zap className="w-4 h-4" />,
  HeartPulse: <HeartPulse className="w-4 h-4" />,
  Plane: <Plane className="w-4 h-4" />,
  Home: <Home className="w-4 h-4" />,
  Car: <Car className="w-4 h-4" />,
  Film: <Film className="w-4 h-4" />,
  Gift: <Gift className="w-4 h-4" />,
  Tag: <Tag className="w-4 h-4" />,
};

const COLOR_PRESETS = [
  '#f97316', // orange
  '#10b981', // emerald
  '#06b6d4', // cyan
  '#ef4444', // red
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6b7280', // gray
];

/**
 * Detects whether the current client is running on an actual mobile device
 * (smartphone/tablet) or running as an installed standalone PWA.
 * The Android Phone Simulator frame is intended exclusively for desktop browsers.
 */
const checkIsMobileOrInstalledPwa = (): boolean => {
  if (typeof window === 'undefined') return false;

  // 1. Installed Standalone PWA detection (Web App manifest display mode)
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: fullscreen)').matches ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://');

  // 2. Physical Mobile / Phone detection (Android, iPhone, etc.)
  const isMobileUserAgent =
    /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);
  const isTouchPhoneScreen =
    Boolean(window.matchMedia?.('(pointer: coarse) and (max-width: 768px)').matches);

  return isStandalone || isMobileUserAgent || isTouchPhoneScreen;
};

export const ExpenserApp: React.FC = () => {
  const adapter = useMemo(() => getStorageAdapter(), []);
  const [payerName, setPayerName] = useState<string>(() => resolveLoggedInPayerName());

  // State
  const [amountStr, setAmountStr] = useState<string>('0');
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [categorySearchQuery, setCategorySearchQuery] = useState<string>('');
  const [isCategorySearchOpen, setIsCategorySearchOpen] = useState<boolean>(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);
  const [expenseDate, setExpenseDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState<string>('');
  const [recentExpenses, setRecentExpenses] = useState<ActualExpense[]>([]);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isOnline, setIsOnline] = useState<boolean>(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [showSuccessBadge, setShowSuccessBadge] = useState<boolean>(false);
  const [showRecentModal, setShowRecentModal] = useState<boolean>(false);
  const [showCategoryModal, setShowCategoryModal] = useState<boolean>(false);
  const [showDateModal, setShowDateModal] = useState<boolean>(false);
  const [showCloudModal, setShowCloudModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isSyncingPlan, setIsSyncingPlan] = useState<boolean>(false);
  const [pullDistance, setPullDistance] = useState<number>(0);
  const [syncFeedback, setSyncFeedback] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const touchStartRef = useRef<{ y: number; x: number; active: boolean }>({ y: 0, x: 0, active: false });
  const [currentUserEmail, setCurrentUserEmail] = useState<string>(() => AuthService.getSession()?.email || '');
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => AuthService.isAuthenticated());
  const versionInfo = useMemo(() => getVersionInfo(), []);

  const storageSyncMessage = useMemo(() => {
    if (isLocalhostEnvironment()) {
      return 'Saved changes will update your local browser storage.';
    }
    if (isAuthenticated) {
      return 'Saved changes will synchronize directly to your cloud storage.';
    }
    return 'Saved changes will update your expense ledger.';
  }, [isAuthenticated]);

  // Selection and editing state for Recent Expenses
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);
  const [editingExpense, setEditingExpense] = useState<ActualExpense | null>(null);
  const [editAmountStr, setEditAmountStr] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editCategoryId, setEditCategoryId] = useState<string>('');
  const [editCategoryQuery, setEditCategoryQuery] = useState<string>('');
  const [isEditCategoryPickerOpen, setIsEditCategoryPickerOpen] = useState<boolean>(false);
  const [editNotes, setEditNotes] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Mobile / PWA vs Desktop Browser Detection
  const [isMobileOrPwa, setIsMobileOrPwa] = useState<boolean>(() => checkIsMobileOrInstalledPwa());

  useEffect(() => {
    const handleDeviceCheck = () => {
      setIsMobileOrPwa(checkIsMobileOrInstalledPwa());
    };
    window.addEventListener('resize', handleDeviceCheck);
    return () => window.removeEventListener('resize', handleDeviceCheck);
  }, []);

  // Sync document title and register Service Worker for offline PWA installation
  useEffect(() => {
    document.title = 'Expenser - Retirement Companion';
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator && (import.meta.env.PROD || process.env.NODE_ENV === 'production')) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.update().catch(() => {});
        })
        .catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
    }
  }, []);

  // Android Phone Simulation Mode (useful for desktop / Debian browser simulation)
  const [isSimulatePhone, setIsSimulatePhone] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('simulate') === 'android' || urlParams.get('phone') === '1') {
        return true;
      }
      return window.localStorage.getItem('expenser_simulate_android') === 'true';
    } catch {
      return false;
    }
  });

  const toggleSimulatePhone = useCallback(() => {
    setIsSimulatePhone(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('expenser_simulate_android', String(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  }, []);

  // Recent Expenses sort order: 'occurred' (expense date, default) or 'entered' (date logged)
  const [recentSortBy, setRecentSortBy] = useState<'occurred' | 'entered'>(() => {
    if (typeof window === 'undefined') return 'occurred';
    try {
      const saved = window.localStorage.getItem('expenser_recent_sort');
      if (saved === 'occurred' || saved === 'entered') return saved;
      return 'occurred';
    } catch {
      return 'occurred';
    }
  });

  const handleToggleSort = useCallback(async (newSort: 'occurred' | 'entered') => {
    setRecentSortBy(newSort);
    try {
      window.localStorage.setItem('expenser_recent_sort', newSort);
    } catch {
      // ignore
    }
    try {
      const recents = await adapter.getRecentExpenses(50, newSort);
      setRecentExpenses(recents);
    } catch (err) {
      console.error('Failed to load sorted recent expenses:', err);
    }
  }, [adapter]);

  const [planVersion, setPlanVersion] = useState<number>(0);
  const allowedPlannerCategories = useMemo(() => {
    // Reference planVersion so catalog re-reads from localStorage on cloud sync
    void planVersion;
    return getPlannerCategories();
  }, [planVersion]);

  // New Category Modal form
  const [newCatGroup, setNewCatGroup] = useState<string>(() => {
    const cats = getPlannerCategories();
    return cats[0] || 'Living';
  });
  const [newCatName, setNewCatName] = useState<string>('');
  const [newCatBudget, setNewCatBudget] = useState<string>('0');
  const [newCatColor, setNewCatColor] = useState<string>(COLOR_PRESETS[0]);
  const [newCatIcon, setNewCatIcon] = useState<string>('Tag');

  // Unified Catalog Items (Planner detailed line items + custom categories)
  const allCatalogItems: PlannerExpenseLineItem[] = useMemo(() => {
    void planVersion;
    const plannerItems = getPlannerExpenseCatalog();
    const merged = mergeWithCustomCategories(plannerItems, categories, allowedPlannerCategories);

    return merged.filter(item => {
      const groupLower = item.groupCategory.trim().toLowerCase();
      if (allowedPlannerCategories.length > 0 && !allowedPlannerCategories.some(c => c.trim().toLowerCase() === groupLower)) {
        return false;
      }
      return true;
    });
  }, [categories, allowedPlannerCategories, planVersion]);

  // Filtered Catalog Items by Search Query
  const filteredCatalogItems: PlannerExpenseLineItem[] = useMemo(() => {
    const query = categorySearchQuery.trim().toLowerCase();
    if (!query) return allCatalogItems;
    return allCatalogItems.filter(item => {
      const full = `${item.groupCategory} ${item.name} ${item.displayName}`.toLowerCase();
      return full.includes(query);
    });
  }, [allCatalogItems, categorySearchQuery]);

  // Reset highlighted index when filtered list changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredCatalogItems]);

  // Filtered Catalog Items for Edit Modal
  const filteredEditCatalogItems = useMemo(() => {
    const query = editCategoryQuery.trim().toLowerCase();
    if (!query) return allCatalogItems;
    return allCatalogItems.filter(item => {
      const full = `${item.groupCategory} ${item.name} ${item.displayName}`.toLowerCase();
      return full.includes(query);
    });
  }, [allCatalogItems, editCategoryQuery]);

  const editSelectedCategoryObj = allCatalogItems.find(c => c.id === editCategoryId);

  // Keyboard Navigation for Category Search
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isCategorySearchOpen) {
        setIsCategorySearchOpen(true);
        setHighlightedIndex(0);
      } else if (filteredCatalogItems.length > 0) {
        setHighlightedIndex(prev => (prev + 1) % filteredCatalogItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isCategorySearchOpen) {
        setIsCategorySearchOpen(true);
        setHighlightedIndex(Math.max(0, filteredCatalogItems.length - 1));
      } else if (filteredCatalogItems.length > 0) {
        setHighlightedIndex(prev => (prev <= 0 ? filteredCatalogItems.length - 1 : prev - 1));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isCategorySearchOpen && filteredCatalogItems.length > 0) {
        const targetItem = filteredCatalogItems[highlightedIndex] || filteredCatalogItems[0];
        if (targetItem) {
          triggerHaptic(10);
          setSelectedCategoryId(targetItem.id);
          setCategorySearchQuery('');
          setIsCategorySearchOpen(false);
        }
      } else if (categorySearchQuery.trim()) {
        setNewCatName(categorySearchQuery.trim());
        setShowCategoryModal(true);
        setIsCategorySearchOpen(false);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsCategorySearchOpen(false);
    }
  };

  // Frequently Logged Line Items (Smart Recents based on actual usage)
  const frequentShortcutItems: PlannerExpenseLineItem[] = useMemo(() => {
    if (!recentExpenses || recentExpenses.length === 0) {
      return [];
    }

    const counts: Record<string, number> = {};
    const firstSeenIndex: Record<string, number> = {};

    recentExpenses.forEach((exp, idx) => {
      const key = exp.catalogId || exp.categoryId || exp.name;
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
      if (firstSeenIndex[key] === undefined) {
        firstSeenIndex[key] = idx;
      }
    });

    const itemsMap = new Map<string, PlannerExpenseLineItem>();
    allCatalogItems.forEach(item => itemsMap.set(item.id, item));

    const sortedIds = Object.keys(counts).sort((a, b) => {
      if (counts[b] !== counts[a]) {
        return counts[b] - counts[a]; // Highest frequency first
      }
      return firstSeenIndex[a] - firstSeenIndex[b]; // Most recent first
    });

    return sortedIds
      .map(id => itemsMap.get(id))
      .filter((item): item is PlannerExpenseLineItem => {
        if (!item) return false;
        const groupLower = item.groupCategory.trim().toLowerCase();
        if (allowedPlannerCategories.length > 0 && !allowedPlannerCategories.some(c => c.trim().toLowerCase() === groupLower)) {
          return false;
        }
        return true;
      })
      .slice(0, 8);
  }, [recentExpenses, allCatalogItems, allowedPlannerCategories]);

  // Load Categories & Expenses
  const loadInFlightRef = useRef<boolean>(false);
  const loadRerunRef = useRef<boolean>(false);

  const loadDataOnce = useCallback(async () => {
    try {
      // 1. Read Detailed Expenses SSOT from localStorage
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem('retirement_planner_inputs') : null;
      let detailedExpenses = null;
      let activeState: string | undefined;
      let profileNames: { primaryName: string; spouseName: string; isSingleFiler: boolean } | undefined;

      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          detailedExpenses = parsed.detailedExpenses;
          const currentYear = new Date().getFullYear();
          const relocYear = parsed.jurisdiction?.relocationYear;
          activeState = (relocYear !== null && relocYear !== undefined && currentYear >= Number(relocYear))
            ? (parsed.jurisdiction?.targetState || parsed.jurisdiction?.currentState || 'MD')
            : (parsed.jurisdiction?.currentState || 'MD');
          profileNames = {
            primaryName: parsed.you?.name || 'Primary',
            spouseName: parsed.wife?.name || 'Spouse',
            isSingleFiler: Boolean(parsed.isSingleFiler),
          };
        } catch {
          // ignore
        }
      }

      // 2. Actively purge obsolete/stale categories (e.g. Housing - Home Maintenance & Repairs) from storage
      if (detailedExpenses) {
        await syncPlannerCatalogToCloudStorage(detailedExpenses, adapter, profileNames, activeState);
      }

      // 3. Fetch pruned categories
      const cats = await adapter.getCategories();
      setCategories(cats);

      const plannerItems = getPlannerExpenseCatalog(activeState);
      const allowedCategories = getPlannerCategories();
      const merged = mergeWithCustomCategories(plannerItems, cats, allowedCategories);
      if (merged.length > 0 && !selectedCategoryId) {
        setSelectedCategoryId(merged[0].id);
      }

      const recents = await adapter.getRecentExpenses(50, recentSortBy);
      setRecentExpenses(recents);

      const pending = await adapter.getPendingSyncExpenses();
      setPendingCount(pending.length);
      setPlanVersion(v => v + 1);
    } catch (err) {
      console.error('Failed to load storage data:', err);
    }
  }, [adapter, selectedCategoryId, recentSortBy]);

  // Loads run one at a time. Overlapping runs (creating an expense name fires several
  // storage events) would otherwise act on a stale plan and purge the brand-new item.
  const loadData = useCallback(async () => {
    if (loadInFlightRef.current) {
      loadRerunRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    try {
      do {
        loadRerunRef.current = false;
        await loadDataOnce();
      } while (loadRerunRef.current);
    } finally {
      loadInFlightRef.current = false;
    }
  }, [loadDataOnce]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // One-time cache migration & flush for unified schema version 2
  useEffect(() => {
    const checkSchemaVersionAndFlush = async () => {
      if (typeof window === 'undefined') return;
      const currentVersion = window.localStorage.getItem('expenser_schema_version');
      if (currentVersion !== '2') {
        try {
          if (adapter.clearAllExpenses) {
            await adapter.clearAllExpenses();
          }
          window.localStorage.setItem('expenser_schema_version', '2');
          if (navigator.onLine && AuthService.isAuthenticated() && adapter.getAllExpensesFromCloud) {
            await adapter.getAllExpensesFromCloud();
          }
          setSyncFeedback({
            message: 'Expense cache updated to unified schema.',
            type: 'info',
          });
          setTimeout(() => setSyncFeedback(null), 3000);
          await loadData();
        } catch (err) {
          console.warn('Failed to perform schema cache refresh:', err);
        }
      }
    };
    checkSchemaVersionAndFlush();
  }, [adapter, loadData]);

  // Online / Offline & Cloud Sync Listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleCloudSync = () => {
      setPayerName(resolveLoggedInPayerName());
      setPlanVersion(v => v + 1);
      loadData();
    };
    const unsubscribeAuth = AuthService.subscribe(s => {
      setIsAuthenticated(Boolean(s));
      setCurrentUserEmail(s?.email || '');
      setPayerName(resolveLoggedInPayerName());
      loadData();
    });

    const handleStorage = () => {
      setPayerName(resolveLoggedInPayerName());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('cloud_categories_synced', handleCloudSync);
    window.addEventListener('cloud_expenses_synced', handleCloudSync);
    window.addEventListener('cloud_sync_completed', handleCloudSync);
    window.addEventListener('retirement_planner_inputs_updated', handleCloudSync);
    window.addEventListener('retirement_planner_plan_synced', handleCloudSync);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('cloud_categories_synced', handleCloudSync);
      window.removeEventListener('cloud_expenses_synced', handleCloudSync);
      window.removeEventListener('cloud_sync_completed', handleCloudSync);
      window.removeEventListener('retirement_planner_inputs_updated', handleCloudSync);
      window.removeEventListener('retirement_planner_plan_synced', handleCloudSync);
      window.removeEventListener('storage', handleStorage);
      unsubscribeAuth();
    };
  }, [loadData]);

  // Keep trying to push the offline queue: on startup, when connectivity returns, when the
  // app is brought back to the foreground, and periodically while anything is still queued.
  const retryQueuedSync = useCallback(async (): Promise<string | null> => {
    if (!(adapter instanceof AwsCloudStorageAdapter)) return null;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Offline';
    if (!AuthService.isAuthenticated()) return 'Not signed in - sign in to sync queued expenses';
    try {
      await adapter.flushPendingExpenses();
    } catch (err) {
      console.warn('Queued expense retry failed:', err);
    }
    const pending = await adapter.getPendingSyncExpenses();
    setPendingCount(pending.length);
    return pending.length > 0 ? adapter.getLastSyncError() || 'Unknown sync failure' : null;
  }, [adapter]);

  useEffect(() => {
    retryQueuedSync();
    const handleVisible = () => {
      if (document.visibilityState === 'visible') retryQueuedSync();
    };
    window.addEventListener('online', handleVisible);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.removeEventListener('online', handleVisible);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, [retryQueuedSync]);

  useEffect(() => {
    if (pendingCount <= 0) return;
    const timer = window.setInterval(() => {
      retryQueuedSync();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [pendingCount, retryQueuedSync]);

  const handleSyncPillTap = async () => {
    if (pendingCount > 0) {
      const reason = await retryQueuedSync();
      if (reason) {
        alert(`Queued expenses are not synced yet.\n\n${reason}`);
      }
    } else {
      await syncPlanAndCategories(true);
    }
  };

  // Haptic feedback helper
  const triggerHaptic = (ms = 10) => {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore */
      }
    }
  };

  // Synchronize Planner categories & settings with AWS cloud
  const syncPlanAndCategories = useCallback(async (isManual = false): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (isManual) {
        setSyncFeedback({ message: 'Offline - cannot sync with cloud', type: 'error' });
        setTimeout(() => setSyncFeedback(null), 3000);
      }
      return false;
    }
    if (!AuthService.isAuthenticated()) {
      if (isManual) {
        setSyncFeedback({ message: 'Sign in to sync with planner', type: 'info' });
        setTimeout(() => setSyncFeedback(null), 3000);
      }
      return false;
    }

    setIsSyncingPlan(true);
    try {
      // 1. Sync remote plan from AWS DynamoDB to localStorage
      const result = await PlanSyncService.syncPlanNow();

      // 2. Invalidate in-memory category cache and flush pending items
      if (adapter instanceof AwsCloudStorageAdapter) {
        adapter.invalidateCategoryCache();
        await adapter.getCategories(true);
        await adapter.flushPendingExpenses();
      }

      // 3. Reload Expenser local state
      await loadData();

      if (isManual) {
        const msg = result.action === 'downloaded'
          ? 'Categories & Plan updated from cloud!'
          : 'Categories are up to date';
        setSyncFeedback({ message: msg, type: 'success' });
        triggerHaptic(15);
        setTimeout(() => setSyncFeedback(null), 2500);
      }
      return true;
    } catch (err) {
      console.warn('Sync plan and categories failed:', err);
      if (isManual) {
        setSyncFeedback({ message: 'Sync failed - check connection', type: 'error' });
        setTimeout(() => setSyncFeedback(null), 3000);
      }
      return false;
    } finally {
      setIsSyncingPlan(false);
    }
  }, [adapter, loadData]);

  // Automatic throttled background sync of plan & categories on app startup / resume (15-min TTL)
  useEffect(() => {
    const PLAN_SYNC_TTL_MS = 15 * 60 * 1000;
    const checkAndSyncPlan = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (!AuthService.isAuthenticated()) return;
      const lastSyncRaw = typeof window !== 'undefined' ? window.localStorage.getItem('retirement_planner_plan_synced_at') : null;
      const lastSyncTime = lastSyncRaw ? new Date(lastSyncRaw).getTime() : 0;
      const now = Date.now();
      if (now - lastSyncTime > PLAN_SYNC_TTL_MS) {
        syncPlanAndCategories(false).catch(() => {});
      }
    };

    checkAndSyncPlan();
    document.addEventListener('visibilitychange', checkAndSyncPlan);
    window.addEventListener('online', checkAndSyncPlan);
    return () => {
      document.removeEventListener('visibilitychange', checkAndSyncPlan);
      window.removeEventListener('online', checkAndSyncPlan);
    };
  }, [syncPlanAndCategories]);

  // Pull-To-Refresh Touch Gesture Handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (
      showRecentModal ||
      showCategoryModal ||
      showDateModal ||
      showCloudModal ||
      showAboutModal ||
      isMenuOpen ||
      isSavingEdit ||
      isCategorySearchOpen ||
      isEditCategoryPickerOpen
    ) {
      touchStartRef.current.active = false;
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [data-scrollable="true"]')) {
      touchStartRef.current.active = false;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = { y: touch.clientY, x: touch.clientX, active: true };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current.active || isSyncingPlan) return;
    const touch = e.touches[0];
    const dy = touch.clientY - touchStartRef.current.y;
    const dx = touch.clientX - touchStartRef.current.x;

    // Only process downward pulls that are distinctly vertical
    if (dy > 12 && dy > Math.abs(dx) * 1.25) {
      const distance = Math.min(75, Math.pow(dy, 0.85));
      setPullDistance(distance);
      if (distance >= 55 && pullDistance < 55) {
        triggerHaptic(8);
      }
    } else if (dy < 0 && pullDistance > 0) {
      setPullDistance(0);
    }
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current.active) return;
    touchStartRef.current.active = false;
    if (pullDistance >= 55 && !isSyncingPlan) {
      triggerHaptic(15);
      syncPlanAndCategories(true);
    }
    setPullDistance(0);
  };

  const handleTouchCancel = () => {
    touchStartRef.current.active = false;
    setPullDistance(0);
  };

  // Keypad Handlers
  const handleKeypadPress = useCallback((key: string) => {
    triggerHaptic(10);
    if (key === 'CLEAR') {
      setAmountStr('0');
      return;
    }
    if (key === 'BACKSPACE') {
      setAmountStr(prev => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
      return;
    }
    if (key === '.') {
      setAmountStr(prev => (prev.includes('.') ? prev : prev + '.'));
      return;
    }

    // Number key
    setAmountStr(prev => {
      // Prevent more than 2 decimal places
      if (prev.includes('.')) {
        const parts = prev.split('.');
        if (parts[1].length >= 2) return prev;
      }
      // Prevent leading zero accumulation
      if (prev === '0') {
        return key;
      }
      // Max amount reasonable check ($999,999.99)
      if (prev.replace('.', '').length >= 8) return prev;
      return prev + key;
    });
  }, []);

  // Physical Keyboard Support for Desktop Users
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // If user is typing inside an input or textarea or modal, don't intercept keypad keys
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      // If any modal is open, don't intercept keypad
      if (showCategoryModal || showDateModal || showRecentModal) {
        return;
      }

      const key = e.key;

      if (key >= '0' && key <= '9') {
        e.preventDefault();
        handleKeypadPress(key);
      } else if (key === '.' || key === ',') {
        e.preventDefault();
        handleKeypadPress('.');
      } else if (key === 'Backspace' || key === 'Delete') {
        e.preventDefault();
        handleKeypadPress('BACKSPACE');
      } else if (key.toLowerCase() === 'c') {
        e.preventDefault();
        handleKeypadPress('CLEAR');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [showCategoryModal, showDateModal, showRecentModal, handleKeypadPress]);

  const parsedAmount = parseFloat(amountStr) || 0;

  // Save Expense
  const handleSaveExpense = async () => {
    if (parsedAmount <= 0) return;
    if (!selectedCategoryId) return;

    triggerHaptic(25);
    setIsSubmitting(true);

    try {
      const selectedItem = allCatalogItems.find(c => c.id === selectedCategoryId);
      const activePayer = payerName || resolveLoggedInPayerName();
      const category = selectedItem?.groupCategory || 'Uncategorized';
      const name = selectedItem?.name || selectedItem?.displayName || 'Expense';

      await adapter.saveExpense({
        date: expenseDate,
        amount: parsedAmount,
        catalogId: selectedCategoryId,
        category,
        name,
        categoryId: selectedCategoryId,
        categoryName: `${category} - ${name}`,
        enteredBy: activePayer,
        notes: notes.trim() || undefined,
      });

      // Show success indicator
      setShowSuccessBadge(true);
      setTimeout(() => setShowSuccessBadge(false), 1800);

      // Reset entry inputs
      setAmountStr('0');
      setNotes('');
      setCategorySearchQuery('');
      setIsCategorySearchOpen(false);

      // Refresh list
      await loadData();
    } catch (err) {
      console.error('Failed to save expense:', err);
      alert('Error saving expense to local storage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create Category on the Fly
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const group = newCatGroup.trim() || 'Living';
    const itemName = newCatName.trim();
    const formattedDisplayName = `${group} - ${itemName}`;
    const newId = `item_custom_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const budgetVal = parseFloat(newCatBudget) || 0;

    // 1. Permanently register in Planner SSOT detailedExpenses catalog in localStorage
    savePlannerExpenseLineItem({
      id: newId,
      name: itemName,
      groupCategory: group,
      plannedMonthlyDefault: budgetVal,
    });

    // Mark the local plan as newer than the cloud copy and upload it, so the next plan sync
    // does not overwrite the new item and the desktop Planner receives it.
    try {
      const rawInputs = window.localStorage.getItem('retirement_planner_inputs');
      if (rawInputs) {
        const rawSavedPlans = window.localStorage.getItem('retirement_planner_saved_plans');
        PlanSyncService.scheduleAutoSave(JSON.parse(rawInputs), rawSavedPlans ? JSON.parse(rawSavedPlans) : []);
      }
    } catch (err) {
      console.warn('Failed to schedule plan upload after creating expense name:', err);
    }

    // 2. Persist to Expenser Storage Adapter
    const created = await adapter.saveCategory({
      id: newId,
      name: formattedDisplayName,
      plannedMonthlyDefault: budgetVal,
      color: newCatColor,
      icon: newCatIcon,
      isCustom: true,
    });

    setCategories(prev => [...prev, created]);
    setSelectedCategoryId(created.id);
    setNewCatName('');
    setNewCatBudget('0');
    setCategorySearchQuery('');
    setShowCategoryModal(false);
    setIsCategorySearchOpen(false);
  };

  // Toggle selection for bulk actions
  const handleToggleSelectExpense = (id: string) => {
    setSelectedExpenseIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllExpenses = () => {
    if (selectedExpenseIds.length === recentExpenses.length) {
      setSelectedExpenseIds([]);
    } else {
      setSelectedExpenseIds(recentExpenses.map(e => e.expenseId));
    }
  };

  // Delete Expense (single)
  const handleDeleteExpense = async (id: string) => {
    if (window.confirm('Delete this expense?')) {
      await adapter.deleteExpense(id);
      setSelectedExpenseIds(prev => prev.filter(item => item !== id));
      if (editingExpense?.expenseId === id) {
        setEditingExpense(null);
      }
      await loadData();
    }
  };

  // Delete Selected Expenses (bulk)
  const handleDeleteSelectedExpenses = async () => {
    if (selectedExpenseIds.length === 0) return;
    const count = selectedExpenseIds.length;
    if (window.confirm(`Delete ${count} selected expense${count > 1 ? 's' : ''}?`)) {
      for (const id of selectedExpenseIds) {
        await adapter.deleteExpense(id);
      }
      setSelectedExpenseIds([]);
      if (editingExpense && selectedExpenseIds.includes(editingExpense.expenseId)) {
        setEditingExpense(null);
      }
      await loadData();
    }
  };

  // Start editing an expense
  const handleStartEditExpense = (exp: ActualExpense) => {
    setEditingExpense(exp);
    setEditAmountStr(exp.amount.toFixed(2));
    setEditDate(exp.date);
    setEditCategoryId(exp.catalogId || exp.categoryId || '');
    setEditCategoryQuery('');
    setIsEditCategoryPickerOpen(false);
    setEditNotes(exp.notes || '');
    setEditError(null);
  };

  // Save edited expense
  const handleSaveEditExpense = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!editingExpense) return;

    const parsedAmount = parseFloat(editAmountStr);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setEditError('Please enter a valid amount greater than $0.00');
      return;
    }

    if (!editDate) {
      setEditError('Please select a valid date');
      return;
    }

    if (!editCategoryId) {
      setEditError('Please select a category');
      return;
    }

    const targetCategory = allCatalogItems.find(c => c.id === editCategoryId);
    const category = targetCategory?.groupCategory || editingExpense.category || 'Uncategorized';
    const name = targetCategory?.name || targetCategory?.displayName || editingExpense.name || 'Expense';

    setIsSavingEdit(true);
    setEditError(null);

    try {
      await adapter.updateExpense(editingExpense.expenseId, {
        amount: Math.round(parsedAmount * 100) / 100,
        date: editDate,
        catalogId: editCategoryId,
        category,
        name,
        categoryId: editCategoryId,
        categoryName: `${category} - ${name}`,
        notes: editNotes.trim() || undefined,
      });

      await loadData();
      setEditingExpense(null);
      setShowSuccessBadge(true);
      setTimeout(() => setShowSuccessBadge(false), 2500);
    } catch (err: unknown) {
      console.error('Failed to update expense:', err);
      setEditError(err instanceof Error ? err.message : 'Failed to update expense');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Calculate Today's Total
  const todayStr = new Date().toISOString().split('T')[0];
  const todayTotal = recentExpenses
    .filter(e => e.date === todayStr)
    .reduce((sum, e) => sum + e.amount, 0);

  const selectedCategoryObj = allCatalogItems.find(c => c.id === selectedCategoryId);

  const appContent = (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      className="h-full w-full max-h-full overflow-hidden bg-slate-950 text-slate-100 flex flex-col select-none font-sans antialiased relative pb-safe"
    >
      {/* Top App Header */}
      <header className="px-4 py-2.5 bg-slate-900/90 backdrop-blur border-b border-slate-800/80 shrink-0 z-30 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-lg shadow-emerald-900/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-white">
              Expenser
            </h1>
            <p className="text-[11px] text-slate-400">Retirement Actuals Tracker</p>
          </div>
        </div>

        {/* Status & Hamburger Action */}
        <div className="flex items-center space-x-2">
          {/* Sync / Offline Pill */}
          <button
            type="button"
            onClick={handleSyncPillTap}
            title={pendingCount > 0 ? 'Tap to retry syncing queued expenses' : 'Tap to sync plan & categories'}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              isOnline
                ? pendingCount > 0
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 cursor-pointer hover:bg-amber-500/20'
                  : isSyncingPlan
                  ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30 cursor-pointer'
                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-pointer hover:bg-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border-rose-500/30 cursor-default'
            }`}
          >
            {isOnline ? (
              <>
                {isSyncingPlan ? (
                  <>
                    <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" />
                    <span>Syncing...</span>
                  </>
                ) : (
                  <>
                    <span className={`w-1.5 h-1.5 rounded-full ${pendingCount > 0 ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                    <span>{pendingCount > 0 ? `${pendingCount} Queued` : 'Synced'}</span>
                  </>
                )}
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-rose-400" />
                <span>Offline</span>
              </>
            )}
          </button>

          {/* Android Phone Simulation Toggle Button (Visible exclusively in desktop browsers) */}
          {!isMobileOrPwa && (
            <button
              type="button"
              onClick={toggleSimulatePhone}
              className={`p-2 rounded-xl border transition-colors flex items-center justify-center cursor-pointer ${
                isSimulatePhone
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm shadow-emerald-950'
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border-slate-700/60'
              }`}
              title={isSimulatePhone ? 'Exit Android Phone Simulation (360 × 806)' : 'Simulate Android Phone Layout (360 × 806 / 720 × 1612)'}
              aria-label="Toggle Android phone layout simulation"
            >
              <Smartphone className="w-4 h-4" />
            </button>
          )}

          {/* Hamburger Menu Toggle Button */}
          <button
            type="button"
            onClick={() => setIsMenuOpen(prev => !prev)}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/60 transition-colors relative"
            aria-label="Toggle navigation menu"
            aria-expanded={isMenuOpen}
          >
            {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            {recentExpenses.length > 0 && !isMenuOpen && (
              <span className="absolute 1 top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-slate-900" />
            )}
          </button>
        </div>
      </header>

      {/* Pull-To-Refresh Indicator */}
      {(pullDistance > 0 || isSyncingPlan) && (
        <div
          className="w-full overflow-hidden transition-all duration-150 ease-out flex items-center justify-center pointer-events-none z-20 shrink-0"
          style={{
            height: isSyncingPlan ? '42px' : `${pullDistance}px`,
            opacity: isSyncingPlan ? 1 : Math.min(1, pullDistance / 35),
          }}
        >
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900/95 border border-slate-700/80 shadow-lg text-xs font-medium text-slate-200">
            <RefreshCw
              className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingPlan ? 'animate-spin' : ''}`}
              style={{ transform: !isSyncingPlan ? `rotate(${pullDistance * 4}deg)` : undefined }}
            />
            <span>
              {isSyncingPlan
                ? 'Syncing categories...'
                : pullDistance >= 55
                ? 'Release to sync categories'
                : 'Pull down to refresh'}
            </span>
          </div>
        </div>
      )}

      {/* Floating Sync Feedback Toast */}
      {syncFeedback && (
        <div className="absolute top-14 left-4 right-4 z-50 flex items-center justify-center pointer-events-none animate-in fade-in slide-in-from-top-2 duration-200">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-xl shadow-xl text-xs font-medium border backdrop-blur-md ${
              syncFeedback.type === 'success'
                ? 'bg-emerald-950/95 text-emerald-200 border-emerald-500/40 shadow-emerald-950/60'
                : syncFeedback.type === 'error'
                ? 'bg-rose-950/95 text-rose-200 border-rose-500/40 shadow-rose-950/60'
                : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-950/60'
            }`}
          >
            {syncFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{syncFeedback.message}</span>
          </div>
        </div>
      )}

      {/* Hamburger Navigation Menu Dropdown */}
      {isMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-xs flex flex-col justify-start max-w-md mx-auto pt-16 px-4 animate-in fade-in duration-150"
          onClick={() => setIsMenuOpen(false)}
        >
          <div
            className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 space-y-1.5 backdrop-blur-md"
            onClick={e => e.stopPropagation()}
          >
            {/* Account Status Header */}
            {isAuthenticated ? (
              <div className="px-3.5 py-2.5 bg-slate-950/60 rounded-xl border border-slate-800 mb-1 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Household Cloud Active</span>
                  </div>
                  <p className="text-[11px] text-slate-300 truncate mt-0.5">
                    {currentUserEmail || 'Signed in'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="px-3.5 py-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 mb-1">
                <div className="text-xs font-semibold text-amber-300">
                  Local Storage Mode
                </div>
                <p className="text-[11px] text-amber-200/70 truncate mt-0.5">
                  Sign in to sync with planner & passkeys
                </p>
              </div>
            )}

            {/* Menu Item 1: Recent Expenses */}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setShowRecentModal(true);
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-200 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">Recent Expenses</div>
                  <div className="text-[11px] text-slate-400">View logged history & delete records</div>
                </div>
              </div>
              {recentExpenses.length > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {recentExpenses.length}
                </span>
              )}
            </button>

            {/* Menu Item 2: Sync Plan & Categories */}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                syncPlanAndCategories(true);
              }}
              disabled={isSyncingPlan}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-200 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center border border-cyan-500/20">
                  <RefreshCw className={`w-4 h-4 ${isSyncingPlan ? 'animate-spin' : ''}`} />
                </div>
                <div>
                  <div className="text-sm font-medium">Sync Plan & Categories</div>
                  <div className="text-[11px] text-slate-400">
                    {isSyncingPlan ? 'Syncing with cloud...' : 'Refresh categories from planner'}
                  </div>
                </div>
              </div>
            </button>

            {/* Menu Item 3: Sign In / Cloud Account & Passkeys */}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setShowCloudModal(true);
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-200 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center border border-teal-500/20">
                  {isAuthenticated ? <User className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {isAuthenticated ? 'Cloud Account & Passkeys' : 'Sign In to Cloud'}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {isAuthenticated ? 'Manage devices, passkeys & sync' : 'Connect AWS Cognito household sync'}
                  </div>
                </div>
              </div>
            </button>

            {/* Menu Item 3: About Expenser */}
            <button
              type="button"
              onClick={() => {
                setIsMenuOpen(false);
                setShowAboutModal(true);
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-200 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                  <Info className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-medium">About Expenser</div>
                  <div className="text-[11px] text-slate-400">Version & build details ({versionInfo.displayVersion})</div>
                </div>
              </div>
            </button>

            {/* Menu Item 4: Sign Out (if authenticated) */}
            {isAuthenticated && (
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  AuthService.signOut();
                }}
                className="w-full flex items-center space-x-3 px-3.5 py-2 rounded-xl hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-lg bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
                  <LogOut className="w-4 h-4" />
                </div>
                <div className="text-sm font-medium">Sign Out</div>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Unauthenticated / Connect Cloud Callout Banner */}
      {!isAuthenticated && (
        <div
          onClick={() => setShowCloudModal(true)}
          className="mx-4 mt-3 p-3 bg-gradient-to-r from-amber-500/20 to-orange-500/10 hover:from-amber-500/30 hover:to-orange-500/20 border border-amber-500/40 rounded-2xl flex items-center justify-between cursor-pointer transition-all shadow-lg shadow-amber-950/20 group"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-amber-200 truncate">
                Sign in to Household Cloud
              </p>
              <p className="text-[11px] text-amber-300/80 truncate">
                Sync categories & live actuals with your desktop planner
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold shrink-0 ml-2 shadow-sm group-hover:bg-amber-400 transition-colors">
            Sign In
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col p-3 sm:p-4 gap-2.5 overflow-hidden min-h-0">
        {/* Amount Display with Today's Stat & Interactive Date Link */}
        <div className="bg-gradient-to-b from-slate-900/90 to-slate-900/50 rounded-2xl p-2.5 sm:p-3 border border-slate-800/80 shadow-inner flex flex-col items-center justify-center relative overflow-hidden shrink-0">
          {/* Header Row: Clickable Date Selector (Left) & Today's Total (Right) */}
          <div className="w-full flex items-center justify-between text-xs text-slate-400 mb-1">
            <button
              type="button"
              onClick={() => {
                triggerHaptic(8);
                setShowDateModal(true);
              }}
              className={`flex items-center gap-1.5 px-2 py-0.5 -ml-1 rounded-lg text-xs font-medium transition-all cursor-pointer group active:scale-95 border ${
                expenseDate === todayStr
                  ? 'text-slate-300 hover:text-emerald-300 bg-slate-800/40 hover:bg-slate-800/80 border-slate-700/40 hover:border-emerald-500/40'
                  : 'text-amber-300 bg-amber-500/15 border-amber-500/40 shadow-sm'
              }`}
              title="Click to change expense date"
            >
              <Calendar className={`w-3.5 h-3.5 ${expenseDate === todayStr ? 'text-emerald-400' : 'text-amber-400'} group-hover:scale-110 transition-transform`} />
              <span className="underline decoration-current underline-offset-2 font-medium">
                {expenseDate === todayStr ? 'Today' : expenseDate}
              </span>
            </button>
            <span className="font-medium text-slate-300 text-[11px] sm:text-xs">
              Today's Total: <strong className="text-emerald-400">${todayTotal.toFixed(2)}</strong>
            </span>
          </div>

          {/* Big Amount Number */}
          <div className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white my-1 sm:my-1.5 flex items-baseline justify-center">
            <span className="text-xl sm:text-2xl text-slate-500 mr-1 font-semibold">$</span>
            <span>{amountStr}</span>
          </div>

          {/* Active Category & Payer Sub-badge */}
          <div className="flex items-center space-x-1.5 text-xs">
            {selectedCategoryObj && (
              <span
                className="px-2.5 py-0.5 rounded-full font-medium text-white flex items-center gap-1 shadow-sm text-[11px] sm:text-xs"
                style={{ backgroundColor: selectedCategoryObj.color || '#3b82f6' }}
              >
                {ICON_MAP[selectedCategoryObj.icon || 'Tag'] || <Tag className="w-3.5 h-3.5" />}
                {selectedCategoryObj.name}
              </span>
            )}
            <span className="px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700 font-medium text-[11px] sm:text-xs">
              👤 {payerName}
            </span>
            {notes && (
              <span className="px-2.5 py-0.5 rounded-full bg-slate-800/80 text-amber-300 border border-amber-500/30 flex items-center gap-1 text-[11px] sm:text-xs">
                <FileText className="w-3 h-3" /> Note
              </span>
            )}
          </div>

          {/* Success Checkmark Banner Overlay */}
          {showSuccessBadge && (
            <div className="absolute inset-0 bg-emerald-600/95 backdrop-blur flex items-center justify-center space-x-2 text-white text-lg font-bold animate-in fade-in zoom-in duration-150">
              <CheckCircle2 className="w-7 h-7 text-white animate-bounce" />
              <span>Expense Logged!</span>
            </div>
          )}
        </div>

        {/* Category Search & Autocomplete Selector */}
        <div className="relative z-20 shrink-0">
          <div className="flex items-center justify-between text-[11px] sm:text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 px-1">
            <span>Expense Name & Category</span>
            <button
              onClick={() => {
                if (categorySearchQuery.trim()) {
                  setNewCatName(categorySearchQuery.trim());
                }
                setShowCategoryModal(true);
              }}
              className="text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5 lowercase font-normal cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> new expense name
            </button>
          </div>

          {/* Search / Select Bar */}
          <div className="relative">
            <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 sm:py-2 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all">
              <Search className="w-4 h-4 text-slate-500 shrink-0 mr-2" />
              <input
                type="text"
                value={categorySearchQuery}
                onFocus={() => setIsCategorySearchOpen(true)}
                onKeyDown={handleSearchKeyDown}
                onChange={e => {
                  setCategorySearchQuery(e.target.value);
                  setIsCategorySearchOpen(true);
                }}
                placeholder={
                  selectedCategoryObj
                    ? `${selectedCategoryObj.groupCategory} - ${selectedCategoryObj.name}`
                    : 'Search expense names or categories...'
                }
                className="w-full bg-transparent text-xs text-white placeholder-slate-400 focus:outline-none"
              />
              {categorySearchQuery ? (
                <button
                  type="button"
                  onClick={() => {
                    setCategorySearchQuery('');
                    setIsCategorySearchOpen(false);
                  }}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCategorySearchOpen(prev => !prev)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Autocomplete Dropdown List */}
            {isCategorySearchOpen && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/98 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl max-h-52 overflow-y-auto z-50 p-1 divide-y divide-slate-800/60 custom-scrollbar animate-in fade-in zoom-in-95">
                {filteredCatalogItems.length === 0 ? (
                  <div className="p-3 text-center space-y-2">
                    <p className="text-xs text-slate-400">
                      No expense names matching &ldquo;<span className="text-white font-medium">{categorySearchQuery}</span>&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setNewCatName(categorySearchQuery.trim());
                        setShowCategoryModal(true);
                        setIsCategorySearchOpen(false);
                      }}
                      className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-xl text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add as new expense name
                    </button>
                  </div>
                ) : (
                  filteredCatalogItems.map((item, index) => {
                    const isSelected = item.id === selectedCategoryId;
                    const isHighlighted = index === highlightedIndex;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => {
                          triggerHaptic(10);
                          setSelectedCategoryId(item.id);
                          setCategorySearchQuery('');
                          setIsCategorySearchOpen(false);
                        }}
                        className={`w-full p-2 rounded-xl text-left flex items-center justify-between transition-all cursor-pointer ${
                          isHighlighted
                            ? 'bg-emerald-500/25 border border-emerald-500/60 text-white ring-1 ring-emerald-500/40 shadow-sm'
                            : isSelected
                            ? 'bg-emerald-500/10 border border-emerald-500/30 text-white'
                            : 'hover:bg-slate-800/80 text-slate-300 hover:text-white border border-transparent'
                        }`}
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider text-slate-900 shrink-0"
                            style={{ backgroundColor: item.color || '#3b82f6' }}
                          >
                            {item.groupCategory}
                          </span>
                          <span className="text-xs font-semibold truncate">{item.name}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 shrink-0 ml-2 font-mono">
                          {item.displayName}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Frequently Logged Shortcuts */}
          {frequentShortcutItems.length > 0 && (
            <div className="flex space-x-1.5 overflow-x-auto pt-1 pb-0.5 scrollbar-none snap-x items-center">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider shrink-0 mr-0.5">
                Frequent:
              </span>
              {frequentShortcutItems.map(item => {
                const isSelected = item.id === selectedCategoryId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setSelectedCategoryId(item.id);
                      setCategorySearchQuery('');
                      setIsCategorySearchOpen(false);
                    }}
                    className={`flex-shrink-0 snap-start px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg text-[11px] font-medium flex items-center space-x-1.5 transition-all border cursor-pointer ${
                      isSelected
                        ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/60 shadow-sm'
                        : 'bg-slate-900/90 text-slate-400 hover:text-slate-200 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: item.color || '#3b82f6' }}
                    />
                    <span>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Note Edit Field (Always Visible & Optional) */}
        <div className="relative shrink-0">
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 transition-all">
            <FileText className={`w-3.5 h-3.5 shrink-0 mr-2 transition-colors ${notes ? 'text-amber-400' : 'text-slate-500'}`} />
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Note (optional, e.g. Costco, dinner tag)..."
              className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
            />
            {notes && (
              <button
                type="button"
                onClick={() => setNotes('')}
                className="p-0.5 text-slate-500 hover:text-slate-300 ml-1 transition-colors cursor-pointer"
                title="Clear note"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Touch Numeric Keypad */}
        <div className="grid grid-cols-3 gap-2 flex-1 min-h-[200px] items-stretch">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'BACKSPACE'].map(key => {
            const isBackspace = key === 'BACKSPACE';
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleKeypadPress(key)}
                aria-label={isBackspace ? 'Backspace' : key}
                title={isBackspace ? 'Backspace' : undefined}
                className={`h-full min-h-[44px] rounded-xl sm:rounded-2xl font-bold text-xl sm:text-2xl flex items-center justify-center transition-all active:scale-95 shadow-sm cursor-pointer ${
                  isBackspace
                    ? 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border border-slate-800'
                    : 'bg-slate-900 hover:bg-slate-800/90 text-white border border-slate-800/80 hover:border-slate-700'
                }`}
              >
                {isBackspace ? <Delete className="w-5 h-5 text-slate-300" /> : key}
              </button>
            );
          })}
        </div>

        {/* Big Save Button */}
        <button
          type="button"
          disabled={parsedAmount <= 0 || isSubmitting}
          onClick={handleSaveExpense}
          className={`w-full py-3.5 sm:py-4 rounded-xl sm:rounded-2xl font-bold text-base sm:text-lg flex items-center justify-center space-x-2 transition-all shadow-xl shrink-0 cursor-pointer ${
            parsedAmount > 0
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 shadow-emerald-950/40 active:scale-[0.98]'
              : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed'
          }`}
        >
          {isSubmitting ? (
            <RefreshCw className="w-5 h-5 animate-spin" />
          ) : (
            <>
              <CheckCircle2 className="w-5 h-5" />
              <span>Log ${amountStr} Expense</span>
            </>
          )}
        </button>
      </main>

      {/* Recent Expenses Modal / Drawer */}
      {showRecentModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex flex-col justify-end sm:justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-t-3xl sm:rounded-3xl max-h-[85vh] flex flex-col max-w-md w-full mx-auto shadow-2xl overflow-hidden">
            {/* Header: Normal or Multi-Select Action Bar */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              {selectedExpenseIds.length > 0 ? (
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      {selectedExpenseIds.length} selected
                    </span>
                    <button
                      type="button"
                      onClick={handleSelectAllExpenses}
                      className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                    >
                      {selectedExpenseIds.length === recentExpenses.length ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleDeleteSelectedExpenses}
                      className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-semibold cursor-pointer transition-colors"
                      title="Delete selected entries"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete ({selectedExpenseIds.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedExpenseIds([])}
                      className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                      title="Cancel selection"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center space-x-2">
                    <History className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-base font-bold text-white">Recent Transactions</h2>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium">
                      {recentExpenses.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowRecentModal(false);
                      setSelectedExpenseIds([]);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {/* Sort Order Selector */}
            <div className="px-4 py-2 bg-slate-950/70 border-b border-slate-800/80 flex items-center justify-between text-xs shrink-0">
              <span className="text-[11px] font-medium text-slate-400">Order by:</span>
              <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => handleToggleSort('occurred')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    recentSortBy === 'occurred'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Expense Date (Occurred)
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSort('entered')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    recentSortBy === 'entered'
                      ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  Date Logged (Entered)
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1 divide-y divide-slate-800/60 custom-scrollbar">
              {recentExpenses.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">
                  No expenses logged yet.
                </div>
              ) : (
                recentExpenses.map(exp => {
                  const isSelected = selectedExpenseIds.includes(exp.expenseId);
                  return (
                    <div
                      key={exp.expenseId}
                      className={`pt-2.5 pb-2.5 px-2 first:pt-1 rounded-xl flex items-center justify-between transition-colors ${
                        isSelected
                          ? 'bg-emerald-500/10 border border-emerald-500/30'
                          : 'hover:bg-slate-800/40 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-3 min-w-0 flex-1">
                        {/* Selection Checkbox */}
                        <button
                          type="button"
                          onClick={() => handleToggleSelectExpense(exp.expenseId)}
                          className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all cursor-pointer shrink-0 ${
                            isSelected
                              ? 'bg-emerald-500 border-emerald-400 text-slate-950'
                              : 'bg-slate-950 border-slate-700 hover:border-slate-500 text-transparent'
                          }`}
                          title={isSelected ? 'Deselect' : 'Select'}
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </button>

                        {/* Transaction Details (clickable to Edit) */}
                        <div
                          onClick={() => handleStartEditExpense(exp)}
                          className="min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="flex items-center space-x-1.5">
                            <span className="font-semibold text-sm text-white">${exp.amount.toFixed(2)}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-medium truncate max-w-[170px]" title={exp.category && exp.name ? `${exp.category} • ${exp.name}` : exp.categoryName}>
                              {exp.category && exp.name ? `${exp.name}` : exp.categoryName}
                              {exp.category && <span className="text-slate-500 ml-1">({exp.category})</span>}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 flex items-center space-x-1.5 flex-wrap">
                            <span className={recentSortBy === 'occurred' ? 'text-emerald-300 font-semibold' : 'text-slate-300'}>
                              {exp.date}
                            </span>
                            {exp.createdAt && (
                              <>
                                <span className="text-slate-600">•</span>
                                <span
                                  className={`text-[10px] ${recentSortBy === 'entered' ? 'text-emerald-300 font-semibold' : 'text-slate-500'}`}
                                  title={`Logged at ${exp.createdAt}`}
                                >
                                  Logged {exp.createdAt.slice(0, 10)}
                                </span>
                              </>
                            )}
                            <span className="text-slate-600">•</span>
                            <span>{exp.enteredBy}</span>
                            {exp.notes && (
                              <>
                                <span className="text-slate-600">•</span>
                                <span className="text-amber-300 truncate max-w-[130px]">{exp.notes}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Row Action Buttons */}
                      <div className="flex items-center space-x-1 shrink-0 ml-2">
                        <button
                          type="button"
                          onClick={() => handleStartEditExpense(exp)}
                          className="p-2 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Edit transaction"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteExpense(exp.expenseId)}
                          className="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                          title="Delete entry"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 bg-slate-950/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>{recentExpenses.length} transactions stored locally</span>
              <button
                type="button"
                onClick={() => {
                  setShowRecentModal(false);
                  setSelectedExpenseIds([]);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Expense Modal */}
      {editingExpense && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-sm w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <Pencil className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-white">Edit Expense</h2>
                  <p className="text-[10px] text-slate-400">Update details & save changes</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingExpense(null)}
                className="p-1 rounded-lg bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editError && (
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-1.5">
                <X className="w-3.5 h-3.5 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEditExpense} className="space-y-3.5">
              {/* Amount */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Amount ($) *
                </label>
                <div className="relative flex items-center bg-slate-950 border border-slate-800 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 rounded-xl px-3 py-2 transition-all">
                  <span className="text-emerald-400 font-bold text-base mr-1.5">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={editAmountStr}
                    onChange={e => setEditAmountStr(e.target.value)}
                    className="w-full bg-transparent text-lg font-bold text-white focus:outline-none"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Date */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-slate-300">
                    Date *
                  </label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditDate(new Date().toISOString().split('T')[0])}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 font-medium px-1.5 py-0.5 bg-emerald-500/10 rounded cursor-pointer"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const y = new Date();
                        y.setDate(y.getDate() - 1);
                        setEditDate(y.toISOString().split('T')[0]);
                      }}
                      className="text-[10px] text-slate-400 hover:text-slate-200 font-medium px-1.5 py-0.5 bg-slate-800 rounded cursor-pointer"
                    >
                      Yesterday
                    </button>
                  </div>
                </div>
                <div className="flex items-center bg-slate-950 border border-slate-800 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 rounded-xl px-3 py-2 transition-all">
                  <Calendar className="w-4 h-4 text-slate-500 mr-2 shrink-0" />
                  <input
                    type="date"
                    value={editDate}
                    onChange={e => setEditDate(e.target.value)}
                    className="w-full bg-transparent text-xs text-white focus:outline-none [color-scheme:dark]"
                    required
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Category *
                </label>
                {!isEditCategoryPickerOpen ? (
                  <button
                    type="button"
                    onClick={() => setIsEditCategoryPickerOpen(true)}
                    className="w-full p-2.5 rounded-xl bg-slate-950 border border-slate-800 hover:border-slate-700 flex items-center justify-between text-left transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: editSelectedCategoryObj?.color || '#10b981' }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-white truncate">
                          {editSelectedCategoryObj ? `${editSelectedCategoryObj.groupCategory} - ${editSelectedCategoryObj.name}` : (editingExpense.category ? `${editingExpense.category} - ${editingExpense.name}` : editingExpense.categoryName || '')}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {editSelectedCategoryObj?.groupCategory || editingExpense.category || 'Expense Name'}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-emerald-400 group-hover:text-emerald-300 shrink-0">
                      Change
                    </span>
                  </button>
                ) : (
                  <div className="space-y-2 p-2 bg-slate-950 rounded-2xl border border-slate-800">
                    <div className="relative flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5">
                      <Search className="w-3.5 h-3.5 text-slate-500 mr-1.5 shrink-0" />
                      <input
                        type="text"
                        value={editCategoryQuery}
                        onChange={e => setEditCategoryQuery(e.target.value)}
                        placeholder="Search categories..."
                        className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                        autoFocus
                      />
                      {editCategoryQuery && (
                        <button
                          type="button"
                          onClick={() => setEditCategoryQuery('')}
                          className="p-0.5 text-slate-400 hover:text-white"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-800/60 custom-scrollbar pr-1">
                      {filteredEditCatalogItems.length === 0 ? (
                        <div className="py-3 text-center text-xs text-slate-500">
                          No matching categories
                        </div>
                      ) : (
                        filteredEditCatalogItems.map(cat => {
                          const isCatSelected = cat.id === editCategoryId;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => {
                                setEditCategoryId(cat.id);
                                setIsEditCategoryPickerOpen(false);
                              }}
                              className={`w-full p-2 text-left rounded-lg flex items-center justify-between text-xs transition-colors cursor-pointer ${
                                isCatSelected
                                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                                  : 'hover:bg-slate-900 text-slate-300'
                              }`}
                            >
                              <div className="flex items-center space-x-2 truncate">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: cat.color || '#3b82f6' }}
                                />
                                <span className="truncate">{cat.displayName || cat.name}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0 ml-1">
                                {cat.groupCategory}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Note / Memo (Optional)
                </label>
                <div className="flex items-center bg-slate-950 border border-slate-800 focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 rounded-xl px-3 py-2 transition-all">
                  <FileText className="w-4 h-4 text-slate-500 mr-2 shrink-0" />
                  <input
                    type="text"
                    value={editNotes}
                    onChange={e => setEditNotes(e.target.value)}
                    placeholder="e.g. Costco grocery haul"
                    maxLength={200}
                    className="w-full bg-transparent text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Cloud Sync info */}
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-950/60 p-2 rounded-xl border border-slate-800/80">
                <Cloud className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{storageSyncMessage}</span>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditingExpense(null)}
                  disabled={isSavingEdit}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingEdit}
                  className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {isSavingEdit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* On-The-Fly Category Creator Modal */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Plus className="w-4 h-4 text-emerald-400" /> New Expense Category
              </h2>
              <button
                onClick={() => setShowCategoryModal(false)}
                className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCategory} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Parent Group Category *
                </label>
                <div className="grid grid-cols-3 gap-1.5 mb-1.5">
                  {(allowedPlannerCategories.length > 0
                    ? allowedPlannerCategories
                    : ['Living', 'Home', 'Transportation', 'Healthcare', 'Leisure', 'Charities']
                  ).map(grp => (
                    <button
                      key={grp}
                      type="button"
                      onClick={() => setNewCatGroup(grp)}
                      className={`py-1 rounded-lg text-xs font-semibold border transition-all ${
                        newCatGroup === grp
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
                      }`}
                    >
                      {grp}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="Or enter custom group name..."
                  value={newCatGroup}
                  onChange={e => setNewCatGroup(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Expense Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Lawn Care, Pet Vet, Groceries"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Estimated Monthly Budget (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-slate-500 text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    placeholder="0"
                    value={newCatBudget}
                    onChange={e => setNewCatBudget(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-7 pr-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Color Tag
                </label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewCatColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        newCatColor === c ? 'border-white scale-110 shadow' : 'border-transparent opacity-70'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Icon
                </label>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(ICON_MAP).map(iconName => (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setNewCatIcon(iconName)}
                      className={`p-1.5 rounded-lg border transition-all ${
                        newCatIcon === iconName
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 scale-105'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {ICON_MAP[iconName]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowCategoryModal(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-900/30"
                >
                  Create Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Date Selector Modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-xs w-full p-4 shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-emerald-400" /> Select Expense Date
              </h2>
              <button
                onClick={() => setShowDateModal(false)}
                className="p-1 rounded bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Presets */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  setExpenseDate(todayStr);
                  setShowDateModal(false);
                }}
                className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                  expenseDate === todayStr
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic(10);
                  const d = new Date();
                  d.setDate(d.getDate() - 1);
                  setExpenseDate(d.toISOString().split('T')[0]);
                  setShowDateModal(false);
                }}
                className="py-2 rounded-xl text-xs font-semibold bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800 transition-all"
              >
                Yesterday
              </button>
            </div>

            {/* Custom Date Input */}
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-slate-400">
                Custom Calendar Date
              </label>
              <input
                type="date"
                value={expenseDate}
                onChange={e => {
                  if (e.target.value) {
                    setExpenseDate(e.target.value);
                  }
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 [color-scheme:dark]"
              />
            </div>

            <button
              type="button"
              onClick={() => setShowDateModal(false)}
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Cloud Authentication & Sync Modal */}
      <CloudAuthModal
        isOpen={showCloudModal}
        onClose={() => setShowCloudModal(false)}
        onSyncComplete={loadData}
      />

      {/* About & Version Details Dialog */}
      <AboutDialog
        isOpen={showAboutModal}
        onClose={() => setShowAboutModal(false)}
        title="Expenser"
        subtitle="Retirement Actuals Tracker & Mobile Companion"
      />
    </div>
  );

  if (isSimulatePhone && !isMobileOrPwa) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-start sm:justify-center p-2 sm:p-4 selection:bg-emerald-500/30 font-sans antialiased overflow-y-auto">
        {/* Simulator Control Banner */}
        <div className="mb-2 flex items-center justify-between w-full max-w-[380px] px-2 text-xs text-slate-400 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-slate-200 font-semibold">Android Simulation</span>
            <span className="text-slate-500 text-[11px] font-mono">360 × 806 (720 × 1612)</span>
          </div>
          <button
            type="button"
            onClick={toggleSimulatePhone}
            className="text-xs text-slate-300 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-700/80 px-2.5 py-1 rounded-lg transition-colors cursor-pointer shadow-sm"
          >
            Exit Frame
          </button>
        </div>

        {/* Realistic Android Phone Bezel Shell - Strict fixed dimensions matching phone screen size */}
        <div className="w-[380px] h-[826px] min-w-[380px] max-w-[380px] min-h-[826px] max-h-[826px] rounded-[42px] border-[10px] border-slate-800 bg-slate-950 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)] relative overflow-hidden flex flex-col ring-1 ring-slate-700/60 [transform:translateZ(0)] shrink-0">
          {/* Top Status Bar with Camera Punch Hole */}
          <div className="h-7 w-full bg-slate-900/90 border-b border-slate-800/40 flex items-center justify-between px-5 text-[11px] font-medium text-slate-400 shrink-0 z-30 select-none">
            <span>9:41</span>
            {/* Top Camera Punch Hole */}
            <div className="w-3.5 h-3.5 rounded-full bg-slate-950 border border-slate-700/80 shadow-inner" />
            <div className="flex items-center space-x-1.5 text-[10px]">
              <span>5G</span>
              <span>100%</span>
            </div>
          </div>

          {/* Inner Phone Viewport - Exactly 360px wide, fills the remaining 758px height */}
          <div className="flex-1 w-full overflow-hidden flex flex-col relative">
            {appContent}
          </div>

          {/* Android Home Navigation Gesture Bar Area */}
          <div className="h-5 w-full bg-slate-950 flex items-center justify-center shrink-0 z-30 pointer-events-none">
            <div className="w-28 h-1 bg-slate-600/70 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen h-[100dvh] max-h-screen max-h-[100dvh] overflow-hidden bg-slate-950 text-slate-100 flex flex-col select-none font-sans antialiased w-full max-w-md mx-auto shadow-2xl relative sm:border-x sm:border-slate-800/60 pb-safe">
      {appContent}
    </div>
  );
};
