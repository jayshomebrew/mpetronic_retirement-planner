import React, { useMemo } from 'react';
import { SimulationResultRow, AppStateInputs } from '../types';
import {
  DollarSign,
  TrendingUp,
  ShieldAlert,
  ArrowRightLeft,
  AlertTriangle,
  Settings,
  X,
  Cloud,
  Fingerprint,
} from 'lucide-react';
import { SidebarNavigation, ActiveViewType } from './SidebarNavigation';

interface DashboardLayoutProps {
  ledger: SimulationResultRow[];
  parallelLedgers: {
    flat: SimulationResultRow[];
    p10: SimulationResultRow[];
    p50: SimulationResultRow[];
    p90: SimulationResultRow[];
  };
  successRate: number;
  inputs: AppStateInputs;
  activeView: ActiveViewType;
  onNavigate: (view: ActiveViewType) => void;
  globalScenario: 'flat' | 'p10' | 'p50' | 'p90';
  setGlobalScenario: (val: 'flat' | 'p10' | 'p50' | 'p90') => void;
  isSimulating?: boolean;
  onOpenDocumentation?: (sectionId?: string) => void;
  onOpenAbout?: () => void;
  onOpenCloudModal?: () => void;
  isAuthenticated?: boolean;
  currentUserEmail?: string;
  isSyncing?: boolean;
  isDemoMode?: boolean;
  onExitDemo?: () => void;
  appMode?: 'demo' | 'localhost' | 'production';
  globalFontSize: number;
  setGlobalFontSize: (size: number) => void;
  children: React.ReactNode;
}

const VIEW_TITLES: Record<ActiveViewType, { title: string; category?: string }> = {
  overview: { title: 'Overview & Cash Flow Trajectory', category: 'Workspaces' },
  'taxable-income': { title: 'Taxable Income Planner', category: 'Workspaces' },
  'lookback-ledger': { title: '35-Year Lookback Ledger', category: 'Workspaces' },
  'monte-carlo': { title: 'Monte Carlo Stochastic Analysis', category: 'Workspaces' },
  compare: { title: 'Plan Scenario Comparison', category: 'Workspaces' },
  actuals: { title: 'Actuals & Guardrails Governance', category: 'Workspaces' },
  'bucket-management': { title: '3-Bucket Strategy Management', category: 'Workspaces' },
  'params-profiles': { title: 'Profiles & Family', category: 'Edit Parameters' },
  'params-filing-status': { title: 'Tax Filing Status', category: 'Edit Parameters' },
  'params-residency': { title: 'Tax Residency & States', category: 'Edit Parameters' },
  'params-healthcare': { title: 'Healthcare & Medicare', category: 'Edit Parameters' },
  'params-accounts': { title: 'Accounts & Balances', category: 'Edit Parameters' },
  'params-expenses': { title: 'Living Expenses & Budget', category: 'Edit Parameters' },
  'params-charity': { title: 'Charitable Giving & QCD', category: 'Edit Parameters' },
  'params-data': { title: 'Backup & Portability', category: 'Edit Parameters' },
  'params-reset': { title: 'Reset Plan', category: 'Edit Parameters' },
};

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({
  ledger,
  parallelLedgers,
  successRate,
  inputs,
  activeView,
  onNavigate,
  globalScenario,
  setGlobalScenario,
  isSimulating = false,
  onOpenDocumentation,
  onOpenAbout,
  onOpenCloudModal,
  isAuthenticated = false,
  currentUserEmail,
  isSyncing = false,
  isDemoMode = false,
  onExitDemo,
  appMode = 'production',
  globalFontSize,
  setGlobalFontSize,
  children,
}) => {
  // Sidebar collapsed state persisted in LocalStorage (defaults to collapsed on mobile/tablets, or user preference)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('retirement_planner_sidebar_collapsed');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('retirement_planner_sidebar_collapsed', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Persistent toggle for summary KPI panel
  const [showKpiSummary, setShowKpiSummary] = React.useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('retirement_planner_show_kpi_summary');
      return saved !== null ? JSON.parse(saved) : false;
    } catch {
      return false;
    }
  });

  const handleToggleKpiSummary = () => {
    setShowKpiSummary((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('retirement_planner_show_kpi_summary', JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const [showDisplaySettings, setShowDisplaySettings] = React.useState<boolean>(false);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const isStressTestActive = Boolean(
    inputs.monteCarloSettings?.stressTest?.enabled &&
      (inputs.monteCarloSettings?.stressTest?.overrides?.length ?? 0) > 0
  );
  const stressTestOverridesCount = inputs.monteCarloSettings?.stressTest?.overrides?.length ?? 0;

  // Compute key summary statistics for active ledger and percentiles
  const stats = useMemo(() => {
    const computeForLedger = (l: SimulationResultRow[]) => {
      const finalRow = l[l.length - 1];
      const endingEstate = finalRow ? finalRow.totalPortfolioValue : 0;
      const totalTaxes = l.reduce((sum, r) => sum + r.totalIncomeTax, 0);
      const totalSurcharges = l.reduce((sum, r) => sum + r.combinedSurchargeAnnual, 0);
      const totalBasePremiums = l.reduce((sum, r) => sum + r.medicareBasePremiums, 0);
      const totalTithe = l.reduce((sum, r) => sum + (r.charitableTithe || 0), 0);
      const totalQCD = l.reduce((sum, r) => sum + (r.qcdAmount || 0), 0);
      const totalQcdTaxSaved = l.reduce((sum, r) => sum + (r.qcdTaxSavings || 0), 0);
      const endingAge = finalRow ? finalRow.yourAge : 90;
      return {
        endingEstate,
        totalTaxes,
        totalSurcharges,
        totalBasePremiums,
        totalTithe,
        totalQCD,
        totalQcdTaxSaved,
        endingAge,
      };
    };

    return {
      active: computeForLedger(ledger),
      p10: computeForLedger(parallelLedgers.p10),
      p50: computeForLedger(parallelLedgers.p50),
      p90: computeForLedger(parallelLedgers.p90),
      flat: computeForLedger(parallelLedgers.flat),
    };
  }, [ledger, parallelLedgers]);

  const currentViewMeta = VIEW_TITLES[activeView] || { title: 'Retirement Planner', category: 'Dashboard' };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-100 font-sans antialiased">
      {/* Collapsible Left Sidebar */}
      <SidebarNavigation
        activeView={activeView}
        onNavigate={onNavigate}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        onOpenDocumentation={onOpenDocumentation}
        onOpenAbout={onOpenAbout}
        onOpenDisplaySettings={() => setShowDisplaySettings(true)}
        onOpenCloudModal={onOpenCloudModal}
        isAuthenticated={isAuthenticated}
        currentUserEmail={currentUserEmail}
        isSyncing={isSyncing}
        isDemoMode={isDemoMode}
        appMode={appMode}
      />

      {/* Main Viewport & Layout */}
      <div className="flex-1 flex flex-col h-full min-w-0 overflow-hidden bg-slate-950">
        {/* Ephemeral Demo Sandbox Top Banner */}
        {isDemoMode && (
          <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-200 shrink-0">
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded bg-amber-500/25 border border-amber-500/40 text-amber-300 font-bold uppercase tracking-wider text-[10px]">
                Demo Sandbox
              </span>
              <span className="text-[11px] text-amber-200/90 font-medium">
                Viewing an isolated sample plan. Changes are in-memory only and will not modify cloud or local storage.
              </span>
            </div>
            <div className="flex items-center gap-2">
              {onExitDemo && (
                <button
                  type="button"
                  onClick={onExitDemo}
                  className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] transition-all cursor-pointer shadow-sm active:scale-95"
                >
                  Exit Demo
                </button>
              )}
            </div>
          </div>
        )}

        {/* Streamlined Top Header Bar */}
        <header className="px-4 py-2 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md z-10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Left Section: Breadcrumb & View Title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-bold uppercase tracking-wider">
                <span>{currentViewMeta.category}</span>
                <span>/</span>
              </div>
              <h1 className="text-sm font-bold text-slate-100 truncate tracking-tight">
                {currentViewMeta.title}
              </h1>
            </div>
            {appMode === 'localhost' && !isAuthenticated && !isDemoMode && (
              <span className="px-2 py-0.5 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400 text-[10px] font-mono font-semibold hidden md:inline-block">
                Localhost Dev
              </span>
            )}
          </div>

          {/* Right Section: Action Controls & Switchers */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Household Cloud Sync Button */}
            {onOpenCloudModal && (
              <button
                type="button"
                disabled={isDemoMode || appMode === 'localhost'}
                onClick={isDemoMode || appMode === 'localhost' ? undefined : onOpenCloudModal}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  isDemoMode || appMode === 'localhost'
                    ? 'bg-slate-800/40 text-slate-500 border-slate-700/50 cursor-not-allowed opacity-60'
                    : isAuthenticated
                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30 cursor-pointer'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500/50 shadow-md shadow-emerald-950/40 cursor-pointer'
                }`}
                title={
                  isDemoMode
                    ? 'Sign in to Cloud is disabled in Demo Sandbox mode. Exit Demo to sign in.'
                    : appMode === 'localhost'
                    ? 'Cloud Sync & Sign In are disabled in Localhost Dev mode (operating strictly off local storage).'
                    : isAuthenticated
                    ? `Household Cloud Synced: ${currentUserEmail || 'Active'}. Click to manage passkeys / sync.`
                    : 'Sign into Household Cloud with Passkey or Password'
                }
              >
                <Cloud
                  className={`w-3.5 h-3.5 ${
                    isDemoMode || appMode === 'localhost'
                      ? 'text-slate-500'
                      : isAuthenticated
                      ? isSyncing
                        ? 'text-emerald-300 animate-pulse'
                        : 'text-emerald-400'
                      : 'text-white'
                  }`}
                />
                <span className="font-bold">
                  {isDemoMode ? (
                    <span>Sign In (Disabled)</span>
                  ) : appMode === 'localhost' ? (
                    <span>Local Storage Only</span>
                  ) : isAuthenticated ? (
                    <span className="flex items-center gap-1.5">
                      <span className="hidden sm:inline">
                        {currentUserEmail ? currentUserEmail.split('@')[0] : 'Cloud Synced'}
                      </span>
                      <span className="sm:hidden">Cloud</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span>Sign In</span>
                      <Fingerprint className="w-3.5 h-3.5 hidden sm:inline text-emerald-200" />
                    </span>
                  )}
                </span>
                {!isDemoMode && appMode !== 'localhost' && (
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isAuthenticated
                        ? isSyncing
                          ? 'bg-emerald-300 animate-ping'
                          : 'bg-emerald-400'
                        : 'bg-white animate-pulse'
                    }`}
                  />
                )}
              </button>
            )}

            {/* Summary KPIs Toggle Button */}
            <button
              type="button"
              onClick={handleToggleKpiSummary}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                showKpiSummary
                  ? 'bg-slate-800 text-slate-100 border-slate-700'
                  : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border-slate-800'
              }`}
              title="Toggle Plan KPI Summary Grid"
            >
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline font-bold">KPIs</span>
              <span className="font-mono text-[10px] text-emerald-400 font-bold">
                {formatCurrency(stats.active.endingEstate)}
              </span>
            </button>

            {/* Stress Test Warning Indicator if Active */}
            {isStressTestActive && (
              <button
                type="button"
                onClick={() => onNavigate('monte-carlo')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/60 transition-all cursor-pointer animate-pulse"
                title={`Stress testing active for ${stressTestOverridesCount} years. Click to customize in Monte Carlo Analysis.`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase hidden lg:inline">Stress Test</span>
              </button>
            )}

            {/* Global Scenario Switcher */}
            <div className="flex items-center gap-1 bg-slate-950/80 p-0.5 border border-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => setGlobalScenario('flat')}
                className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                  globalScenario === 'flat'
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Static baseline scenario"
              >
                Flat
              </button>
              <button
                type="button"
                onClick={() => setGlobalScenario('p10')}
                className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                  globalScenario === 'p10'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="10th percentile worst market scenario"
              >
                P10
              </button>
              <button
                type="button"
                onClick={() => setGlobalScenario('p50')}
                className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                  globalScenario === 'p50'
                    ? 'bg-indigo-500/20 text-indigo-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="50th percentile median market scenario"
              >
                P50
              </button>
              <button
                type="button"
                onClick={() => setGlobalScenario('p90')}
                className={`text-[10px] px-2 py-0.5 rounded-lg font-bold transition-all cursor-pointer ${
                  globalScenario === 'p90'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="90th percentile best market scenario"
              >
                P90
              </button>
            </div>
          </div>
        </header>

        {/* Collapsible KPI Summary Panel */}
        {showKpiSummary && (
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 animate-in slide-in-from-top-2 duration-200 shrink-0 z-10">
            <div className="glass-panel rounded-lg px-3 py-1.5 flex items-center justify-between border-l-4 border-l-emerald-500 bg-slate-900/60">
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                  Ending Net Estate (Age {stats.active.endingAge})
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-black text-emerald-400 font-mono">
                    {formatCurrency(stats.active.endingEstate)}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono truncate">
                    ({formatCurrency(stats.p10.endingEstate)}–{formatCurrency(stats.p90.endingEstate)})
                  </span>
                </div>
              </div>
              <TrendingUp className="w-4 h-4 text-emerald-500/50 shrink-0 ml-2" />
            </div>

            <div className="glass-panel rounded-lg px-3 py-1.5 flex items-center justify-between border-l-4 border-l-rose-500 bg-slate-900/60">
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                  Lifetime Income Taxes
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-black text-rose-400 font-mono">
                    {formatCurrency(stats.active.totalTaxes)}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono truncate">
                    ({formatCurrency(stats.p10.totalTaxes)}–{formatCurrency(stats.p90.totalTaxes)})
                  </span>
                </div>
              </div>
              <DollarSign className="w-4 h-4 text-rose-500/50 shrink-0 ml-2" />
            </div>

            <div className="glass-panel rounded-lg px-3 py-1.5 flex items-center justify-between border-l-4 border-l-amber-500 bg-slate-900/60">
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                  Lifetime IRMAA Surcharges
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-black text-amber-400 font-mono">
                    {formatCurrency(stats.active.totalSurcharges)}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono truncate">
                    ({formatCurrency(stats.p10.totalSurcharges)}–{formatCurrency(stats.p90.totalSurcharges)})
                  </span>
                </div>
              </div>
              <ShieldAlert className="w-4 h-4 text-amber-500/50 shrink-0 ml-2" />
            </div>

            <div className="glass-panel rounded-lg px-3 py-1.5 flex items-center justify-between border-l-4 border-l-blue-500 bg-slate-900/60">
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block truncate">
                  Plan Success Rate
                </span>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <span className="text-base font-black text-blue-400 font-mono">
                    {(successRate * 100).toFixed(1)}%
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono truncate">
                    ({inputs.monteCarloSettings.trials} trials)
                  </span>
                </div>
              </div>
              <ArrowRightLeft className="w-4 h-4 text-blue-500/50 shrink-0 ml-2" />
            </div>
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-950">
          <div
            className={`w-full min-w-0 transition-opacity duration-150 ${
              isSimulating ? 'opacity-75' : 'opacity-100'
            }`}
          >
            {children}
          </div>
        </main>
      </div>

      {/* Global Display & Typography Settings Modal */}
      {showDisplaySettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all duration-200">
          <div className="w-full max-w-md bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-6 glass-panel backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center border-b border-slate-800/60 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" />
                Display & Typography Settings
              </h3>
              <button
                type="button"
                onClick={() => setShowDisplaySettings(false)}
                className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/30 rounded-lg transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-400">Global Font Size Scale</span>
                  <span className="text-slate-200 font-mono font-bold bg-slate-800 px-2 py-0.5 rounded border border-slate-700/50">
                    {globalFontSize}px ({Math.round((globalFontSize / 16) * 100)}%)
                  </span>
                </div>
                <input
                  type="range"
                  min="12"
                  max="24"
                  value={globalFontSize}
                  onChange={(e) => setGlobalFontSize(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                  <span>12px (Small)</span>
                  <span>16px (Default)</span>
                  <span>24px (Extra Large)</span>
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800/60">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                  Size Presets
                </span>
                <div className="grid grid-cols-5 gap-1.5">
                  {[12, 14, 16, 18, 20].map((size) => {
                    const label =
                      size === 12
                        ? 'XS'
                        : size === 14
                        ? 'SM'
                        : size === 16
                        ? 'DF'
                        : size === 18
                        ? 'LG'
                        : 'XL';
                    const isSelected = globalFontSize === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => setGlobalFontSize(size)}
                        className={`py-2 px-1 text-[10px] font-bold rounded-lg border transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30'
                            : 'bg-slate-800/35 text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {label} ({size}px)
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-950/40 border border-slate-800/60 rounded-xl p-3 text-[10px] text-slate-400 leading-relaxed">
                💡 <strong>Accessibility Note:</strong> Changing the root scale dynamically updates all
                relative text units (<code>rem</code>). This affects all workspaces, charts, tables,
                and details cards across the entire application interface.
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800/60">
              <button
                type="button"
                onClick={() => setGlobalFontSize(16)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl text-xs transition-all cursor-pointer"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
