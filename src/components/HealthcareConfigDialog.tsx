import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Check, HelpCircle, Shield, Heart, Calendar, CalendarCheck } from 'lucide-react';
import { HealthcareConfig, StateHealthcareConfig } from '../types';

interface HealthcareConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  personName: string;
  birthDate: string;
  healthcareConfig: HealthcareConfig | undefined;
  healthcareInflationRate: number;
  startYear?: number;
  onSave: (config: HealthcareConfig) => void;
}

const MEDICARE_PART_B_2026 = 202.90;
const MEDICARE_PART_D_2026 = 34.50;
const MEDICARE_PART_B_DEDUCTIBLE_2026 = 283;

export const HealthcareConfigDialog: React.FC<HealthcareConfigDialogProps> = ({
  isOpen,
  onClose,
  personName,
  birthDate,
  healthcareConfig,
  healthcareInflationRate,
  startYear = 2026,
  onSave,
}) => {
  const [activeTab, setActiveTab] = useState<'MD' | 'FL'>('MD');

  // Compute birth year and age 65 year for projections
  const birthYear = useMemo(() => {
    if (!birthDate) return 1960;
    const yr = parseInt(birthDate.split('-')[0], 10);
    return isNaN(yr) ? 1960 : yr;
  }, [birthDate]);

  const age65Year = birthYear + 65;
  const yearsTo65 = Math.max(0, age65Year - startYear);

  const projectedPartB = useMemo(() => {
    return MEDICARE_PART_B_2026 * Math.pow(1 + healthcareInflationRate, yearsTo65);
  }, [healthcareInflationRate, yearsTo65]);

  const projectedPartD = useMemo(() => {
    return MEDICARE_PART_D_2026 * Math.pow(1 + healthcareInflationRate, yearsTo65);
  }, [healthcareInflationRate, yearsTo65]);

  const projectedPartBDeductible = useMemo(() => {
    return MEDICARE_PART_B_DEDUCTIBLE_2026 * Math.pow(1 + healthcareInflationRate, yearsTo65);
  }, [healthcareInflationRate, yearsTo65]);

  // Initial State Helpers
  const createDefaultStateConfig = (): StateHealthcareConfig => ({
    pre65MedicalPremium: null,
    pre65MedicalOOP: null,

    pre65DentalPremium: null,
    pre65DentalOOP: null,

    pre65VisionPremium: null,
    pre65VisionOOP: null,

    medicarePartDPremium: null,
    medicarePartDDeductibleCopays: null,
    supplementPremium: null,
    supplementOOP: null,
    post65HearingCare: null,

    post65DentalPremium: null,
    post65DentalOOP: null,

    post65VisionPremium: null,
    post65VisionOOP: null,
  });

  const [partBPremium, setPartBPremium] = useState<number | null>(() => {
    return healthcareConfig?.medicarePartBPremium !== undefined ? healthcareConfig.medicarePartBPremium : null;
  });

  const [fileSSA44, setFileSSA44] = useState<boolean>(() => {
    return healthcareConfig?.fileSSA44LifeChangingEvent !== false;
  });

  const [coveredByWorkingSpousePlan, setCoveredByWorkingSpousePlan] = useState<boolean>(() => {
    return Boolean(healthcareConfig?.coveredByWorkingSpousePlan);
  });

  const [medicareStartMode, setMedicareStartMode] = useState<'age65' | 'customDate'>(() => {
    return healthcareConfig?.medicareStartMode ?? 'age65';
  });

  const [medicareStartDate, setMedicareStartDate] = useState<string>(() => {
    return healthcareConfig?.medicareStartDate ?? '';
  });

  const [mdConfig, setMdConfig] = useState<StateHealthcareConfig>(() => {
    return healthcareConfig?.MD ? { ...healthcareConfig.MD } : createDefaultStateConfig();
  });

  const [flConfig, setFlConfig] = useState<StateHealthcareConfig>(() => {
    return healthcareConfig?.FL ? { ...healthcareConfig.FL } : createDefaultStateConfig();
  });

  if (!isOpen) return null;

  const handleStateChange = (state: 'MD' | 'FL', key: keyof StateHealthcareConfig, value: number | null) => {
    if (state === 'MD') {
      setMdConfig(prev => ({ ...prev, [key]: value }));
    } else {
      setFlConfig(prev => ({ ...prev, [key]: value }));
    }
  };

  const handleSave = () => {
    onSave({
      medicarePartBPremium: partBPremium,
      fileSSA44LifeChangingEvent: fileSSA44,
      medicareStartMode,
      medicareStartDate: medicareStartMode === 'customDate' ? (medicareStartDate || null) : null,
      coveredByWorkingSpousePlan,
      MD: mdConfig,
      FL: flConfig
    });
    onClose();
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const renderStateInputs = (state: 'MD' | 'FL') => {
    const config = state === 'MD' ? mdConfig : flConfig;
    const updateField = (key: keyof StateHealthcareConfig, valString: string) => {
      const val = valString === '' ? null : Number(valString);
      handleStateChange(state, key, val);
    };

    return (
      <div className="space-y-6">
        {/* Pre-65 Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-bold border-b border-slate-800 pb-1 text-sm">
            <Heart className="w-4 h-4 text-emerald-400" />
            <h4>Pre-Medicare Health Expenses (Under Age 65)</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Medical Premium / Mo</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.pre65MedicalPremium === null ? '' : config.pre65MedicalPremium}
                  onChange={(e) => updateField('pre65MedicalPremium', e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="0"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Est. Annual OOP</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.pre65MedicalOOP === null ? '' : config.pre65MedicalOOP}
                  onChange={(e) => updateField('pre65MedicalOOP', e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="0"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
              <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Dental (Pre-65)</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Monthly Premium</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.pre65DentalPremium === null ? '' : config.pre65DentalPremium}
                      onChange={(e) => updateField('pre65DentalPremium', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Est. Annual OOP</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.pre65DentalOOP === null ? '' : config.pre65DentalOOP}
                      onChange={(e) => updateField('pre65DentalOOP', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
              <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Vision (Pre-65)</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Monthly Premium</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.pre65VisionPremium === null ? '' : config.pre65VisionPremium}
                      onChange={(e) => updateField('pre65VisionPremium', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Est. Annual OOP</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.pre65VisionOOP === null ? '' : config.pre65VisionOOP}
                      onChange={(e) => updateField('pre65VisionOOP', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Post-65 Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 font-bold border-b border-slate-800 pb-1 text-sm">
            <Shield className="w-4 h-4 text-emerald-400" />
            <h4>Medicare & Health Expenses (Age 65+ & Retired Only)</h4>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400 block font-medium">Part D Premium / Mo</label>
                <span className="text-[9px] text-slate-500 font-mono">
                  Default: {formatCurrency(projectedPartD)}/mo
                </span>
              </div>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.medicarePartDPremium === null ? '' : config.medicarePartDPremium}
                  onChange={(e) => updateField('medicarePartDPremium', e.target.value)}
                  placeholder={`Default: ${projectedPartD.toFixed(0)}`}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Part D Annual Deductible & Copays</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.medicarePartDDeductibleCopays === null ? '' : config.medicarePartDDeductibleCopays}
                  onChange={(e) => updateField('medicarePartDDeductibleCopays', e.target.value)}
                  placeholder="0"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Supplement Plan Premium / Mo</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.supplementPremium === null ? '' : config.supplementPremium}
                  onChange={(e) => updateField('supplementPremium', e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="e.g. Medigap Plan G/N"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Supplement Plan Est. Annual Medical OOP</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.supplementOOP === null ? '' : config.supplementOOP}
                  onChange={(e) => updateField('supplementOOP', e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder={`e.g. ${formatCurrency(projectedPartBDeductible)} for Plan G Part B deductible`}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
              <p className="text-[10px] text-slate-500 leading-tight">
                For Medigap Plan G, this is typically just the annual Part B deductible (~{formatCurrency(projectedPartBDeductible)}). For Plan N, add estimated visit copays (up to $20/visit).
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-slate-400 block font-medium">Hearing Care Est. Annual Expense</label>
              <div className="relative">
                <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                <input
                  type="number"
                  value={config.post65HearingCare === null ? '' : config.post65HearingCare}
                  onChange={(e) => updateField('post65HearingCare', e.target.value)}
                  placeholder="e.g. Hearing aids / exams"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
              <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Dental (Post-65)</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Monthly Premium</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.post65DentalPremium === null ? '' : config.post65DentalPremium}
                      onChange={(e) => updateField('post65DentalPremium', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Est. Annual OOP</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.post65DentalOOP === null ? '' : config.post65DentalOOP}
                      onChange={(e) => updateField('post65DentalOOP', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-950/40 rounded-xl border border-slate-800/60">
              <h5 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Vision (Post-65)</h5>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Monthly Premium</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.post65VisionPremium === null ? '' : config.post65VisionPremium}
                      onChange={(e) => updateField('post65VisionPremium', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-400 block font-medium">Est. Annual OOP</label>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1 text-slate-500 text-[10px] font-semibold">$</span>
                    <input
                      type="number"
                      value={config.post65VisionOOP === null ? '' : config.post65VisionOOP}
                      onChange={(e) => updateField('post65VisionOOP', e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="0"
                      className="w-full bg-slate-900 border border-slate-850 rounded-lg pl-6 pr-2 py-1 text-[10px] text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all duration-300">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden glass-panel backdrop-blur-xl transition-all duration-300 transform scale-100 flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <Heart className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-100 tracking-tight">
                Healthcare Configuration &mdash; {personName || 'Profile'}
              </h3>
              <p className="text-xs text-slate-400">
                Configure health expenses (applied in simulation only when retired, before and after age 65)
              </p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/30 rounded-lg transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          
          {/* Medicare Transition Timing: Choice (a) Defined Date vs (b) When turning 65 */}
          <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Medicare Transition Timing & Eligibility
                </h4>
              </div>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                medicareStartMode === 'customDate'
                  ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}>
                {medicareStartMode === 'customDate' ? 'Defined Start Date' : 'Turn Age 65 (Standard)'}
              </span>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setMedicareStartMode('age65')}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    medicareStartMode !== 'customDate'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-slate-100 shadow-sm'
                      : 'bg-slate-900/50 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    medicareStartMode !== 'customDate' ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'
                  }`}>
                    {medicareStartMode !== 'customDate' && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                  </div>
                  <div>
                    <span className="text-xs font-bold block text-slate-100">When Turning Age 65</span>
                    <span className="text-[10px] text-slate-400 block">Automatic standard enrollment ({age65Year})</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMedicareStartMode('customDate');
                    if (!medicareStartDate) {
                      setMedicareStartDate(`${age65Year}-01-01`);
                    }
                  }}
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-left transition-all cursor-pointer ${
                    medicareStartMode === 'customDate'
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-slate-100 shadow-sm'
                      : 'bg-slate-900/50 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    medicareStartMode === 'customDate' ? 'border-emerald-400 bg-emerald-500' : 'border-slate-600'
                  }`}>
                    {medicareStartMode === 'customDate' && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                  </div>
                  <div>
                    <span className="text-xs font-bold block text-slate-100">Specific Defined Date</span>
                    <span className="text-[10px] text-slate-400 block">Working past 65 or employer coverage delay</span>
                  </div>
                </button>
              </div>

              {medicareStartMode === 'customDate' && (
                <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-800 space-y-2 animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-0.5">
                      <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                        <CalendarCheck className="w-3.5 h-3.5 text-amber-400" />
                        Medicare Enrollment Start Date
                      </label>
                      <span className="text-[10px] text-slate-400 block">
                        Medicare Part B, Part D, Supplement plans & IRMAA surcharges begin on this date.
                      </span>
                    </div>
                    <input
                      type="date"
                      value={medicareStartDate}
                      onChange={(e) => setMedicareStartDate(e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Shared Medicare Part B Field (State Independent) */}
          <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Federal Medicare Part B (State Independent)
              </h4>
              <span className="text-[10px] text-slate-500 font-mono">
                Projected Baseline at 65: {formatCurrency(projectedPartB)}/mo
              </span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <label className="text-xs text-slate-400 block font-medium">Part B Premium / Mo</label>
                  <div className="relative group inline-block">
                    <HelpCircle className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 bg-slate-950 text-slate-200 text-[10px] p-2.5 rounded-lg border border-slate-800 shadow-xl z-50 leading-normal pointer-events-none normal-case font-medium">
                      Enter the base Part B monthly premium at age 65. If left blank, it will automatically default to the projected premium based on baseline {formatCurrency(MEDICARE_PART_B_2026)}/mo and your healthcare inflation rate.
                    </div>
                  </div>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1.5 text-slate-500 text-xs font-semibold">$</span>
                  <input
                    type="number"
                    value={partBPremium === null ? '' : partBPremium}
                    onChange={(e) => setPartBPremium(e.target.value === '' ? null : Number(e.target.value))}
                    placeholder={`Default: ${projectedPartB.toFixed(0)}`}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed pl-2">
                This premium is federal and does not vary by state. The system will automatically compute any dynamic IRMAA surcharges on top of this base amount during simulation.
              </div>
            </div>
          </div>

          {/* Form SSA-44 Life-Changing Event (Work Stoppage / Wage Reduction) */}
          <div className="p-4 bg-slate-950/40 rounded-xl border border-slate-800/60 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-850 pb-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-sky-400" />
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Social Security Form SSA-44 (Life-Changing Event)
                </h4>
              </div>
              <span className="text-[10px] text-sky-400 font-semibold uppercase tracking-wider bg-sky-500/10 px-2 py-0.5 rounded border border-sky-500/20">
                IRMAA Optimization
              </span>
            </div>

            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={fileSSA44}
                onChange={(e) => setFileSSA44(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40 focus:ring-offset-0 transition-all cursor-pointer"
              />
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-200 group-hover:text-emerald-400 transition-colors block">
                  File Form SSA-44 for Work Stoppage / Retirement
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Upon retirement, beneficiaries file Form SSA-44 to request that Social Security calculate Medicare IRMAA surcharges using their <strong>current post-retirement income</strong> rather than their high pre-retirement W-2 wages from 2 years prior.
                </p>
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer group pt-2 border-t border-slate-850">
              <input
                type="checkbox"
                checked={coveredByWorkingSpousePlan}
                onChange={(e) => setCoveredByWorkingSpousePlan(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/40 focus:ring-offset-0 transition-all cursor-pointer"
              />
              <div className="space-y-1">
                <span className="text-xs font-bold text-slate-200 group-hover:text-emerald-400 transition-colors block">
                  Covered under working spouse's employer health plan
                </span>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Individual pre-65 health premiums and out-of-pocket costs will remain $0 while primary spouse is actively employed, beginning only after primary spouse's retirement.
                </p>
              </div>
            </label>
          </div>

          {/* State Tabs */}
          <div className="space-y-4">
            <div className="flex border-b border-slate-800">
              <button
                type="button"
                onClick={() => setActiveTab('MD')}
                className={`px-4 py-2 text-xs font-bold transition-all border-b-2 -mb-px ${
                  activeTab === 'MD'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Maryland (MD) Healthcare
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('FL')}
                className={`px-4 py-2 text-xs font-bold transition-all border-b-2 -mb-px ${
                  activeTab === 'FL'
                    ? 'border-emerald-500 text-emerald-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Florida (FL) Healthcare
              </button>
            </div>

            <div className="p-1">
              {renderStateInputs(activeTab)}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="p-6 border-t border-slate-800 flex justify-end gap-3 bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-700/80 text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 border border-emerald-400/25 text-slate-950 font-bold rounded-xl text-xs transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Save Configuration</span>
          </button>
        </div>

      </div>
    </div>,
    document.body
  );
};
