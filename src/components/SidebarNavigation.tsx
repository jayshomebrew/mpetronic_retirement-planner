import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Calculator,
  TableProperties,
  TrendingUp,
  ArrowRightLeft,
  ClipboardCheck,
  Sliders,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  Wallet,
  Flame,
  FileSpreadsheet,
  RefreshCw,
  BookOpen,
  Info,
  Layers,
  Settings,
  HeartPulse,
  Scale,
  MapPin,
  HeartHandshake,
  Smartphone,
  Cloud,
} from 'lucide-react';
import { getVersionInfo } from '../utils/version';

export type ActiveViewType =
  | 'overview'
  | 'taxable-income'
  | 'lookback-ledger'
  | 'monte-carlo'
  | 'compare'
  | 'actuals'
  | 'bucket-management'
  | 'params-profiles'
  | 'params-filing-status'
  | 'params-residency'
  | 'params-healthcare'
  | 'params-accounts'
  | 'params-expenses'
  | 'params-charity'
  | 'params-data'
  | 'params-reset';

interface NavItem {
  id: ActiveViewType;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  badge?: string;
}

const PRIMARY_NAV_ITEMS: NavItem[] = [
  {
    id: 'overview',
    label: 'Overview',
    shortLabel: 'Overview',
    icon: TrendingUp,
    description: 'Cash flow & estate trajectory',
  },
  {
    id: 'taxable-income',
    label: 'Taxable Income Planner',
    shortLabel: 'Taxable',
    icon: Calculator,
    description: 'Brackets & IRMAA tiers',
  },
  {
    id: 'lookback-ledger',
    label: 'Lookback Ledger',
    shortLabel: 'Ledger',
    icon: TableProperties,
    description: '35-year cashflow accounting',
  },
  {
    id: 'monte-carlo',
    label: 'Monte Carlo',
    shortLabel: 'Monte Carlo',
    icon: TrendingUp,
    description: 'Stochastic stress testing',
  },
  {
    id: 'compare',
    label: 'Compare Plans',
    shortLabel: 'Compare',
    icon: ArrowRightLeft,
    description: 'Multi-plan delta analysis',
  },
  {
    id: 'actuals',
    label: 'Actuals & Guardrails',
    shortLabel: 'Actuals',
    icon: ClipboardCheck,
    description: 'Reconciliation & spending rules',
  },
  {
    id: 'bucket-management',
    label: 'Bucket Management',
    shortLabel: 'Buckets',
    icon: Layers,
    description: '3-Bucket strategy & bond ladder',
  },
];

const PARAMETER_NAV_ITEMS: NavItem[] = [
  {
    id: 'params-profiles',
    label: 'Profiles & Family',
    shortLabel: 'Profiles',
    icon: Users,
    description: 'Ages, Social Security, Salaries',
  },
  {
    id: 'params-filing-status',
    label: 'Tax Filing Status',
    shortLabel: 'Filing Status',
    icon: Scale,
    description: 'MFJ vs Single, Survivor Analysis',
  },
  {
    id: 'params-residency',
    label: 'Tax Residency & States',
    shortLabel: 'Residency',
    icon: MapPin,
    description: 'MD & FL Relocation Planning',
  },
  {
    id: 'params-healthcare',
    label: 'Healthcare & Medicare',
    shortLabel: 'Healthcare',
    icon: HeartPulse,
    description: 'Pre-65 ACA, Medicare & Out-of-Pocket',
  },
  {
    id: 'params-accounts',
    label: 'Accounts & Balances',
    shortLabel: 'Accounts',
    icon: Wallet,
    description: 'Pre-tax, Roth, Taxable, Cash',
  },
  {
    id: 'params-expenses',
    label: 'Living Expenses & Budget',
    shortLabel: 'Expenses',
    icon: Flame,
    description: 'Living budget & Itemized catalog',
  },
  {
    id: 'params-charity',
    label: 'Charitable Giving & QCD',
    shortLabel: 'Charity',
    icon: HeartHandshake,
    description: 'Tithe engine & Qualified Distributions',
  },
  {
    id: 'params-data',
    label: 'Backup & Portability',
    shortLabel: 'Data & Backup',
    icon: FileSpreadsheet,
    description: 'Export/Import, PDF & Excel',
  },
  {
    id: 'params-reset',
    label: 'Reset Plan',
    shortLabel: 'Reset',
    icon: RefreshCw,
    description: 'Restart onboarding setup',
  },
];

interface SidebarNavigationProps {
  activeView: ActiveViewType;
  onNavigate: (view: ActiveViewType) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenDocumentation?: (sectionId?: string) => void;
  onOpenAbout?: () => void;
  onOpenDisplaySettings?: () => void;
  onOpenCloudModal?: () => void;
  isAuthenticated?: boolean;
  currentUserEmail?: string;
  isSyncing?: boolean;
  isDemoMode?: boolean;
  appMode?: 'demo' | 'localhost' | 'production';
}

export const SidebarNavigation: React.FC<SidebarNavigationProps> = ({
  activeView,
  onNavigate,
  isCollapsed,
  onToggleCollapse,
  onOpenDocumentation,
  onOpenAbout,
  onOpenDisplaySettings,
  onOpenCloudModal,
  isAuthenticated = false,
  currentUserEmail,
  isSyncing = false,
  isDemoMode = false,
  appMode = 'production',
}) => {
  const versionInfo = getVersionInfo();
  const isParamViewActive = activeView.startsWith('params-');

  // Accordion state for "Edit Parameters" sub-menu
  const [isParamsExpanded, setIsParamsExpanded] = useState<boolean>(true);
  const [showCollapsedParamsFlyout, setShowCollapsedParamsFlyout] = useState<boolean>(false);
  const flyoutButtonRef = useRef<HTMLButtonElement>(null);
  const flyoutCloseTimerRef = useRef<number | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const handleOpenFlyout = () => {
    if (flyoutCloseTimerRef.current) {
      window.clearTimeout(flyoutCloseTimerRef.current);
      flyoutCloseTimerRef.current = null;
    }
    if (flyoutButtonRef.current) {
      const rect = flyoutButtonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const estimatedHeight = 440;
      let top = rect.top - 16;
      if (top + estimatedHeight > viewportHeight - 16) {
        top = Math.max(12, viewportHeight - estimatedHeight - 16);
      }
      top = Math.max(12, top);

      setFlyoutPos({
        top,
        left: rect.right + 6,
      });
    }
    setShowCollapsedParamsFlyout(true);
  };

  const handleCloseFlyout = () => {
    if (flyoutCloseTimerRef.current) {
      window.clearTimeout(flyoutCloseTimerRef.current);
    }
    flyoutCloseTimerRef.current = window.setTimeout(() => {
      setShowCollapsedParamsFlyout(false);
    }, 120);
  };

  const handleCancelCloseFlyout = () => {
    if (flyoutCloseTimerRef.current) {
      window.clearTimeout(flyoutCloseTimerRef.current);
      flyoutCloseTimerRef.current = null;
    }
    setShowCollapsedParamsFlyout(true);
  };

  // Auto-expand parameters accordion if a parameter view becomes active
  useEffect(() => {
    if (isParamViewActive) {
      setIsParamsExpanded(true);
    }
  }, [isParamViewActive]);

  return (
    <aside
      className={`relative z-20 flex flex-col h-full bg-slate-900/95 border-r border-slate-800 backdrop-blur-xl transition-all duration-300 ease-in-out shrink-0 select-none ${
        isCollapsed ? 'w-16' : 'w-64 sm:w-72'
      }`}
      aria-label="Sidebar Navigation"
    >
      {/* Sidebar Header / Brand & Single Toggle Control */}
      <div className="h-14 px-3 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 bg-slate-900/80">
        {!isCollapsed ? (
          <>
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="p-1.5 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-emerald-400 shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div className="truncate">
                <h1 className="text-xs font-black tracking-tight text-slate-100 flex items-center gap-1.5 truncate">
                  <span>Retirement</span>
                  <span className="text-emerald-400 font-extrabold">Planner</span>
                </h1>
                <p className="text-[10px] text-slate-500 font-mono font-medium truncate">
                  {versionInfo.displayVersion}
                </p>
              </div>
            </div>

            {/* Single dedicated control to collapse sidebar */}
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-950/40 hover:bg-slate-800 border border-slate-800/80 rounded-lg transition-all cursor-pointer group shrink-0"
              title="Collapse Sidebar"
            >
              <PanelLeftClose className="w-4 h-4 text-slate-400 group-hover:text-emerald-400 transition-colors" />
            </button>
          </>
        ) : (
          /* Single dedicated control to expand sidebar */
          <div className="w-full flex justify-center">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="p-1.5 rounded-xl bg-slate-950/60 hover:bg-slate-800 text-slate-400 hover:text-emerald-400 border border-slate-800/80 hover:border-slate-700 transition-all cursor-pointer flex items-center justify-center"
              title="Expand Sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Main Navigation Scrollable Container */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scrollbar">
        {/* Section 1: Core Workspaces */}
        <div className="space-y-1">
          {!isCollapsed && (
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Workspaces
            </div>
          )}

          {PRIMARY_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                title={isCollapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer group text-left relative ${
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-950/50'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent'
                } ${isCollapsed ? 'justify-center px-0' : ''}`}
              >
                <div
                  className={`p-1 rounded-lg transition-colors shrink-0 ${
                    isActive
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>

                {!isCollapsed && (
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono">
                          {item.badge}
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-[10px] text-slate-500 truncate group-hover:text-slate-400 transition-colors">
                        {item.description}
                      </p>
                    )}
                  </div>
                )}

                {/* Subtle active indicator bar */}
                {isActive && (
                  <div className="absolute left-0 top-1.5 bottom-1.5 w-1 bg-emerald-400 rounded-r" />
                )}
              </button>
            );
          })}
        </div>

        {/* Section 2: Edit Parameters (Hierarchical Collapsible Group) */}
        <div className="space-y-1 pt-2 border-t border-slate-800/80">
          {!isCollapsed ? (
            <button
              type="button"
              onClick={() => setIsParamsExpanded((prev) => !prev)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                <span>Edit Parameters</span>
              </div>
              {isParamsExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
              )}
            </button>
          ) : (
            <div
              className="relative flex justify-center py-1"
              onMouseEnter={handleOpenFlyout}
              onMouseLeave={handleCloseFlyout}
            >
              <button
                ref={flyoutButtonRef}
                type="button"
                onClick={() => {
                  if (showCollapsedParamsFlyout) {
                    setShowCollapsedParamsFlyout(false);
                  } else {
                    handleOpenFlyout();
                  }
                }}
                title="Edit Parameters (Click or hover to open sections)"
                className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
                  isParamViewActive
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200 border-transparent hover:bg-slate-800'
                }`}
              >
                <Sliders className="w-4 h-4" />
              </button>

              {/* Collapsed Flyout Popover Menu */}
              {isCollapsed && showCollapsedParamsFlyout && createPortal(
                <div
                  className="fixed z-50 bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-2.5 w-64 flex flex-col animate-in fade-in zoom-in-95 duration-150 before:absolute before:-left-3 before:top-0 before:bottom-0 before:w-3"
                  style={{
                    top: `${flyoutPos.top}px`,
                    left: `${flyoutPos.left}px`,
                    minWidth: '16.5rem',
                    maxHeight: `calc(100vh - ${flyoutPos.top + 16}px)`,
                  }}
                  onMouseEnter={handleCancelCloseFlyout}
                  onMouseLeave={handleCloseFlyout}
                >
                  <div className="px-2 py-1.5 border-b border-slate-800 mb-1 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
                      <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Edit Parameters</span>
                    </div>
                    <span className="text-[9px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      10 Sections
                    </span>
                  </div>

                  <div className="space-y-0.5 flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-0.5">
                    {PARAMETER_NAV_ITEMS.map((item) => {
                      const Icon = item.icon;
                      const isActive = activeView === item.id;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onNavigate(item.id);
                            setShowCollapsedParamsFlyout(false);
                          }}
                          className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer group text-left ${
                            isActive
                              ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/40 shadow-sm'
                              : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/80 border border-transparent'
                          }`}
                        >
                          <div
                            className={`p-1 rounded-lg shrink-0 ${
                              isActive ? 'bg-emerald-500/30 text-emerald-300' : 'text-slate-400 group-hover:text-slate-200'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="truncate block font-semibold leading-tight">{item.label}</span>
                            {item.description && (
                              <span className="text-[10px] text-slate-500 truncate block group-hover:text-slate-400 leading-tight">
                                {item.description}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>,
                document.body
              )}
            </div>
          )}

          {/* Sub-items (expanded state) */}
          {(!isCollapsed && isParamsExpanded) && (
            <div className="pl-2 space-y-0.5 border-l border-slate-800 ml-3.5 mt-1 animate-in fade-in duration-150">
              {PARAMETER_NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onNavigate(item.id)}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer group text-left ${
                      isActive
                        ? 'bg-emerald-500/15 text-emerald-300 font-semibold border border-emerald-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-emerald-400' : 'text-slate-500 group-hover:text-slate-300'
                      }`}
                    />
                    <div className="min-w-0 flex-1 truncate">
                      <span className="truncate block">{item.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className="p-2.5 border-t border-slate-800 bg-slate-900/90 shrink-0 space-y-1.5">
        {/* Household Cloud Sync */}
        {onOpenCloudModal && (
          <button
            type="button"
            disabled={isDemoMode || appMode === 'localhost'}
            onClick={isDemoMode || appMode === 'localhost' ? undefined : onOpenCloudModal}
            title={
              isDemoMode
                ? 'Sign in to Cloud is disabled in Demo Sandbox mode. Exit Demo to sign in.'
                : appMode === 'localhost'
                ? 'Cloud Sync & Sign In are disabled in Localhost Dev mode (operating strictly off local storage).'
                : isCollapsed
                ? isAuthenticated
                  ? `Household Cloud: ${currentUserEmail || 'Connected'}`
                  : 'Connect Household Cloud'
                : undefined
            }
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs rounded-xl transition-all border ${
              isDemoMode || appMode === 'localhost'
                ? 'bg-slate-800/30 text-slate-500 border-slate-800/80 cursor-not-allowed opacity-60'
                : isAuthenticated
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30 cursor-pointer'
                : 'bg-slate-800/40 hover:bg-slate-800 text-amber-300 border-amber-500/30 cursor-pointer'
            } ${isCollapsed ? 'justify-center px-0' : ''}`}
          >
            <Cloud
              className={`w-4 h-4 shrink-0 ${
                isDemoMode || appMode === 'localhost'
                  ? 'text-slate-600'
                  : isAuthenticated
                  ? isSyncing
                    ? 'text-emerald-300 animate-pulse'
                    : 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            />
            {!isCollapsed && (
              <span className="truncate flex items-center justify-between w-full font-medium">
                <span className="truncate pr-1">
                  {isDemoMode
                    ? 'Sign in (Disabled)'
                    : appMode === 'localhost'
                    ? 'Local Storage'
                    : isAuthenticated
                    ? currentUserEmail
                      ? currentUserEmail.split('@')[0]
                      : 'Cloud Synced'
                    : 'Sign in to Cloud'}
                </span>
                <span
                  className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded border shrink-0 ${
                    isDemoMode
                      ? 'bg-amber-500/10 text-amber-400/80 border-amber-500/20'
                      : appMode === 'localhost'
                      ? 'bg-sky-500/10 text-sky-400 border-sky-500/20'
                      : isAuthenticated
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}
                >
                  {isDemoMode
                    ? 'DEMO'
                    : appMode === 'localhost'
                    ? 'DEV'
                    : isAuthenticated
                    ? isSyncing
                      ? 'SYNC'
                      : 'LIVE'
                    : 'OFFLINE'}
                </span>
              </span>
            )}
          </button>
        )}

        {/* Display & Typography Settings */}
        {onOpenDisplaySettings && (
          <button
            type="button"
            onClick={onOpenDisplaySettings}
            title={isCollapsed ? 'Display & Typography Settings' : undefined}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer ${
              isCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            <Settings className="w-4 h-4 text-slate-400 shrink-0" />
            {!isCollapsed && <span className="truncate">Display Settings</span>}
          </button>
        )}

        {/* Open Expenser PWA */}
        <a
          href="/expenser"
          target="_blank"
          rel="noopener noreferrer"
          title={isCollapsed ? 'Launch Expenser PWA' : undefined}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded-xl transition-all cursor-pointer border border-emerald-500/20 ${
            isCollapsed ? 'justify-center px-0' : ''
          }`}
        >
          <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
          {!isCollapsed && (
            <span className="truncate flex items-center justify-between w-full font-medium">
              Expenser App
              <span className="text-[9px] uppercase font-bold px-1 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                PWA
              </span>
            </span>
          )}
        </a>

        {/* Documentation / Help shortcut */}
        <button
          type="button"
          onClick={() => onOpenDocumentation?.('overview')}
          title={isCollapsed ? 'User Guide' : undefined}
          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer ${
            isCollapsed ? 'justify-center px-0' : ''
          }`}
        >
          <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
          {!isCollapsed && <span className="truncate">User Guide</span>}
        </button>

        {/* About App */}
        {onOpenAbout && (
          <button
            type="button"
            onClick={onOpenAbout}
            title={isCollapsed ? 'About Application' : undefined}
            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-xl transition-all cursor-pointer ${
              isCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            <Info className="w-4 h-4 text-slate-500 shrink-0" />
            {!isCollapsed && <span className="truncate">About App</span>}
          </button>
        )}
      </div>
    </aside>
  );
};
