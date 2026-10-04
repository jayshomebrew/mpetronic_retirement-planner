import React, { useState, useMemo, useEffect } from 'react';
import { HeartPulse, Heart, Shield, Sparkles, Calendar, CalendarCheck } from 'lucide-react';
import { HealthcareConfig, StateHealthcareConfig } from '../types';
import { NumericInput } from './NumericInput';

interface PersonHealthcareInlineCardProps {
  personKey: 'you' | 'wife';
  name: string;
  birthDate?: string;
  birthYear: number;
  plannedRetirementAge?: number | null;
  plannedRetirementMonth?: number | null;
  healthcareConfig: HealthcareConfig | undefined;
  healthcareInflationRate: number;
  currentState: string;
  targetState: string;
  relocationYear: number | null;
  startYear?: number;
  accentColor?: 'emerald' | 'teal';
  onChange: (config: HealthcareConfig) => void;
}

const MEDICARE_PART_B_2026 = 202.90;
const MEDICARE_PART_D_2026 = 34.50;
const MEDICARE_PART_B_DEDUCTIBLE_2026 = 283;

export const PersonHealthcareInlineCard: React.FC<PersonHealthcareInlineCardProps> = ({
  personKey,
  name,
  birthDate,
  birthYear,
  plannedRetirementAge,
  plannedRetirementMonth,
  healthcareConfig,
  healthcareInflationRate,
  currentState = 'MD',
  targetState = 'FL',
  startYear = 2026,
  accentColor = 'emerald',
  onChange,
}) => {
  const [activeTab, setActiveTab] = useState<'MD' | 'FL'>(() => {
    return currentState === 'FL' ? 'FL' : 'MD';
  });

  const age65Year = birthYear + 65;
  const currentAge = startYear - birthYear;
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

  const suggestedRetirementDate = useMemo(() => {
    const retireAge = plannedRetirementAge ?? 65;
    const birthMo = birthDate ? parseInt(birthDate.split('-')[1] || '1', 10) : 1;
    const retireMo = plannedRetirementMonth ?? birthMo;
    const retireYr = birthYear + retireAge;
    return `${retireYr}-${String(retireMo).padStart(2, '0')}-01`;
  }, [birthYear, birthDate, plannedRetirementAge, plannedRetirementMonth]);

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

  const currentConfig: HealthcareConfig = useMemo(() => {
    return {
      medicarePartBPremium: healthcareConfig?.medicarePartBPremium ?? null,
      fileSSA44LifeChangingEvent: healthcareConfig?.fileSSA44LifeChangingEvent !== false,
      medicareStartMode: healthcareConfig?.medicareStartMode ?? 'age65',
      medicareStartDate: healthcareConfig?.medicareStartDate ?? null,
      coveredByWorkingSpousePlan: healthcareConfig?.coveredByWorkingSpousePlan ?? false,
      MD: healthcareConfig?.MD ? { ...healthcareConfig.MD } : createDefaultStateConfig(),
      FL: healthcareConfig?.FL ? { ...healthcareConfig.FL } : createDefaultStateConfig(),
    };
  }, [healthcareConfig]);

  const isCustomDateMode = currentConfig.medicareStartMode === 'customDate';

  const [tempMedicareStartDate, setTempMedicareStartDate] = useState<string>(() => {
    return currentConfig.medicareStartDate || suggestedRetirementDate;
  });

  useEffect(() => {
    if (currentConfig.medicareStartDate) {
      setTempMedicareStartDate(currentConfig.medicareStartDate);
    } else {
      setTempMedicareStartDate(suggestedRetirementDate);
    }
  }, [currentConfig.medicareStartDate, suggestedRetirementDate]);

  const handleStateFieldChange = (
    state: 'MD' | 'FL',
    field: keyof StateHealthcareConfig,
    val: number | null
  ) => {
    const updated = {
      ...currentConfig,
      [state]: {
        ...currentConfig[state],
        [field]: val,
      },
    };
    onChange(updated);
  };

  const handleUniversalFieldChange = <K extends 'medicarePartBPremium' | 'fileSSA44LifeChangingEvent' | 'medicareStartMode' | 'medicareStartDate' | 'coveredByWorkingSpousePlan'>(
    field: K,
    val: HealthcareConfig[K]
  ) => {
    const updated: HealthcareConfig = {
      ...currentConfig,
      [field]: val,
    };
    onChange(updated);
  };

  const activeStateConfig = currentConfig[activeTab];
  const isEmerald = accentColor === 'emerald';

  // Compute display transition text and status
  const transitionDisplay = useMemo(() => {
    if (isCustomDateMode && currentConfig.medicareStartDate) {
      const parts = currentConfig.medicareStartDate.split('-');
      const yr = parseInt(parts[0], 10);
      const mo = parts.length > 1 ? parseInt(parts[1], 10) : 1;
      const ageAtTransition = !isNaN(yr) ? yr - birthYear : 65;
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateLabel = !isNaN(yr) ? `${monthNames[mo - 1] || 'Jan'} ${yr}` : currentConfig.medicareStartDate;
      return {
        label: `Medicare Starts ${dateLabel} (Age ~${ageAtTransition})`,
        shortDate: dateLabel,
        isCustom: true,
      };
    }
    return {
      label: `Medicare Transition at Age 65 (${age65Year})`,
      shortDate: `Age 65 (${age65Year})`,
      isCustom: false,
    };
  }, [isCustomDateMode, currentConfig.medicareStartDate, birthYear, age65Year]);

  return (
    <div className="glass-panel bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-lg flex flex-col justify-between">
      {/* Card Header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-1.5 rounded-lg ${
                isEmerald ? 'bg-emerald-500/20 text-emerald-400' : 'bg-teal-500/20 text-teal-400'
              }`}
            >
              <HeartPulse className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100">{name}</h3>
              <p className="text-[10px] text-slate-400">
                {transitionDisplay.label} • Currently Age {currentAge}
              </p>
            </div>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-lg font-mono font-bold ${
              isEmerald ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
            }`}
          >
            Born {birthYear}
          </span>
        </div>

        {/* Medicare Transition Timing: Choice (a) Defined Date vs (b) When turning 65 */}
        <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/60 pb-2">
            <div className="flex items-center gap-2">
              <Calendar className={`w-3.5 h-3.5 ${isEmerald ? 'text-emerald-400' : 'text-teal-400'}`} />
              <h4 className="text-xs font-bold text-slate-200">
                Medicare Transition Timing
              </h4>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
              isCustomDateMode
                ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            }`}>
              {isCustomDateMode ? 'Defined Start Date' : 'Turn Age 65 (Standard)'}
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Option (b): When user turns 65 */}
              <button
                type="button"
                onClick={() => {
                  handleUniversalFieldChange('medicareStartMode', 'age65');
                }}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  !isCustomDateMode
                    ? isEmerald
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-slate-100 shadow-sm'
                      : 'bg-teal-500/15 border-teal-500/50 text-slate-100 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  !isCustomDateMode
                    ? isEmerald ? 'border-emerald-400 bg-emerald-500' : 'border-teal-400 bg-teal-500'
                    : 'border-slate-600'
                }`}>
                  {!isCustomDateMode && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                </div>
                <div>
                  <span className="text-xs font-bold block text-slate-100">When Turning Age 65</span>
                  <span className="text-[10px] text-slate-400 block">Automatic standard enrollment ({age65Year})</span>
                </div>
              </button>

              {/* Option (a): Starting Medicare on a given defined date */}
              <button
                type="button"
                onClick={() => {
                  const targetDate = currentConfig.medicareStartDate || tempMedicareStartDate || suggestedRetirementDate;
                  const updated: HealthcareConfig = {
                    ...currentConfig,
                    medicareStartMode: 'customDate',
                    medicareStartDate: targetDate,
                  };
                  onChange(updated);
                }}
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isCustomDateMode
                    ? isEmerald
                      ? 'bg-emerald-500/15 border-emerald-500/50 text-slate-100 shadow-sm'
                      : 'bg-teal-500/15 border-teal-500/50 text-slate-100 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                  isCustomDateMode
                    ? isEmerald ? 'border-emerald-400 bg-emerald-500' : 'border-teal-400 bg-teal-500'
                    : 'border-slate-600'
                }`}>
                  {isCustomDateMode && <div className="w-1.5 h-1.5 rounded-full bg-slate-950" />}
                </div>
                <div>
                  <span className="text-xs font-bold block text-slate-100">Specific Defined Date</span>
                  <span className="text-[10px] text-slate-400 block">Working past 65 or employer coverage delay</span>
                </div>
              </button>
            </div>

            {isCustomDateMode && (
              <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-800 space-y-2.5 animate-in fade-in duration-150">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="space-y-0.5">
                    <label className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
                      <CalendarCheck className="w-3.5 h-3.5 text-amber-400" />
                      Medicare Enrollment Start Date
                    </label>
                    <span className="text-[10px] text-slate-400 block">
                      Medicare Parts B/D, Medigap supplements & IRMAA surcharges begin on this date.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={tempMedicareStartDate}
                      onChange={(e) => setTempMedicareStartDate(e.target.value)}
                      onBlur={() => {
                        if (tempMedicareStartDate && tempMedicareStartDate !== (currentConfig.medicareStartDate || '')) {
                          handleUniversalFieldChange('medicareStartDate', tempMedicareStartDate);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (tempMedicareStartDate && tempMedicareStartDate !== (currentConfig.medicareStartDate || '')) {
                            handleUniversalFieldChange('medicareStartDate', tempMedicareStartDate);
                          }
                        }
                      }}
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                    />
                    {suggestedRetirementDate && (
                      <button
                        type="button"
                        onClick={() => {
                          setTempMedicareStartDate(suggestedRetirementDate);
                          handleUniversalFieldChange('medicareStartDate', suggestedRetirementDate);
                        }}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-750 border border-slate-700 text-[10px] font-bold text-emerald-400 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        title={`Use Planned Retirement Date (${suggestedRetirementDate})`}
                      >
                        Use Retirement Date
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* State Tab Switcher */}
        <div className="flex items-center justify-between gap-2 p-1.5 bg-slate-950/70 rounded-xl border border-slate-800/80">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 px-2 font-medium">
            <span>Jurisdiction:</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('MD')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'MD'
                  ? isEmerald
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              Maryland (MD) {currentState === 'MD' ? '• Current' : ''}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('FL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'FL'
                  ? isEmerald
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                    : 'bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
              }`}
            >
              Florida (FL) {targetState === 'FL' ? '• Target' : ''}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area for Active State */}
      <div className="space-y-4 pt-1">
        {/* Section 1: Pre-Medicare */}
        <div className="p-3.5 bg-slate-950/50 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
            <div className="flex items-center gap-2">
              <Heart className={`w-3.5 h-3.5 ${isEmerald ? 'text-emerald-400' : 'text-teal-400'}`} />
              <h4 className="text-xs font-bold text-slate-200">
                Pre-Medicare Health Expenses ({isCustomDateMode && currentConfig.medicareStartDate ? `Prior to ${transitionDisplay.shortDate}` : 'Under Age 65'})
              </h4>
            </div>
          </div>

          {/* Working Spouse Coverage Checkbox */}
          {personKey === 'wife' && (
            <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800/90 space-y-1.5">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={Boolean(currentConfig.coveredByWorkingSpousePlan)}
                  onChange={(e) => handleUniversalFieldChange('coveredByWorkingSpousePlan', e.target.checked)}
                  className="rounded border-slate-700 text-teal-500 focus:ring-teal-500 w-4 h-4 mt-0.5 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-200 block">
                    Covered under working spouse's employer health plan
                  </span>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Spouse is covered under working partner's company health plan with $0 individual pre-65 premiums and out-of-pocket costs while primary is actively employed. Individual pre-65 health costs will begin the month following primary spouse's retirement.
                  </p>
                </div>
              </label>
              {currentConfig.coveredByWorkingSpousePlan && (
                <div className="flex items-center gap-1.5 text-[10px] text-teal-400 font-semibold pl-6.5 pt-0.5">
                  <Shield className="w-3 h-3" />
                  <span>Individual Pre-65 costs will remain $0 while working spouse is employed</span>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                Pre-Medicare Medical Premium / Mo
              </label>
              <NumericInput
                value={activeStateConfig.pre65MedicalPremium}
                onChange={(val) => handleStateFieldChange(activeTab, 'pre65MedicalPremium', val)}
                prefix="$"
                placeholder="0"
              />
              <span className="text-[9px] text-slate-500">
                Private ACA or COBRA monthly premium prior to Medicare enrollment (covered by employer while working).
              </span>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                Pre-Medicare Est. Annual Medical OOP
              </label>
              <NumericInput
                value={activeStateConfig.pre65MedicalOOP}
                onChange={(val) => handleStateFieldChange(activeTab, 'pre65MedicalOOP', val)}
                prefix="$"
                placeholder="0"
              />
              <span className="text-[9px] text-slate-500">
                Annual out-of-pocket copays and deductibles prior to Medicare enrollment.
              </span>
            </div>
          </div>

          {/* Pre-Medicare Dental & Vision */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-850 space-y-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block">
                Pre-Medicare Dental
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Monthly Prem</label>
                  <NumericInput
                    value={activeStateConfig.pre65DentalPremium}
                    onChange={(val) => handleStateFieldChange(activeTab, 'pre65DentalPremium', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Annual OOP</label>
                  <NumericInput
                    value={activeStateConfig.pre65DentalOOP}
                    onChange={(val) => handleStateFieldChange(activeTab, 'pre65DentalOOP', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-850 space-y-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block">
                Pre-Medicare Vision
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Monthly Prem</label>
                  <NumericInput
                    value={activeStateConfig.pre65VisionPremium}
                    onChange={(val) => handleStateFieldChange(activeTab, 'pre65VisionPremium', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Annual OOP</label>
                  <NumericInput
                    value={activeStateConfig.pre65VisionOOP}
                    onChange={(val) => handleStateFieldChange(activeTab, 'pre65VisionOOP', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Medicare & Supplement Expenses */}
        <div className="p-3.5 bg-slate-950/50 rounded-xl border border-slate-800/80 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/70 pb-2">
            <div className="flex items-center gap-2">
              <Shield className={`w-3.5 h-3.5 ${isEmerald ? 'text-emerald-400' : 'text-teal-400'}`} />
              <h4 className="text-xs font-bold text-slate-200">
                Medicare & Supplement Expenses ({isCustomDateMode && currentConfig.medicareStartDate ? `Starting ${transitionDisplay.shortDate}` : 'Age 65+'})
              </h4>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Part D */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 font-medium">Part D Premium / Mo</label>
                <span className="text-[9px] text-slate-500 font-mono">
                  Proj: ${projectedPartD.toFixed(0)}/mo
                </span>
              </div>
              <NumericInput
                value={activeStateConfig.medicarePartDPremium}
                onChange={(val) => handleStateFieldChange(activeTab, 'medicarePartDPremium', val)}
                prefix="$"
                placeholder={`Default: ${projectedPartD.toFixed(0)}`}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                Part D Annual Deductible & Copays
              </label>
              <NumericInput
                value={activeStateConfig.medicarePartDDeductibleCopays}
                onChange={(val) => handleStateFieldChange(activeTab, 'medicarePartDDeductibleCopays', val)}
                prefix="$"
                placeholder="0"
              />
            </div>

            {/* Supplement Medigap Plan */}
            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                Medigap Supplement Premium / Mo
              </label>
              <NumericInput
                value={activeStateConfig.supplementPremium}
                onChange={(val) => handleStateFieldChange(activeTab, 'supplementPremium', val)}
                prefix="$"
                placeholder="e.g. 180 (Plan G/N)"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-medium block">
                Supplement Annual Medical OOP
              </label>
              <NumericInput
                value={activeStateConfig.supplementOOP}
                onChange={(val) => handleStateFieldChange(activeTab, 'supplementOOP', val)}
                prefix="$"
                placeholder={`Default: Part B ded ($${projectedPartBDeductible.toFixed(0)})`}
              />
            </div>
          </div>

          {/* Post-Medicare Dental, Vision & Hearing */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-850 space-y-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block">
                Medicare-Era Dental
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Monthly Prem</label>
                  <NumericInput
                    value={activeStateConfig.post65DentalPremium}
                    onChange={(val) => handleStateFieldChange(activeTab, 'post65DentalPremium', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Annual OOP</label>
                  <NumericInput
                    value={activeStateConfig.post65DentalOOP}
                    onChange={(val) => handleStateFieldChange(activeTab, 'post65DentalOOP', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-850 space-y-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block">
                Medicare-Era Vision
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Monthly Prem</label>
                  <NumericInput
                    value={activeStateConfig.post65VisionPremium}
                    onChange={(val) => handleStateFieldChange(activeTab, 'post65VisionPremium', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="text-[9px] text-slate-400">Annual OOP</label>
                  <NumericInput
                    value={activeStateConfig.post65VisionOOP}
                    onChange={(val) => handleStateFieldChange(activeTab, 'post65VisionOOP', val)}
                    prefix="$"
                    placeholder="0"
                  />
                </div>
              </div>
            </div>

            <div className="p-2.5 bg-slate-900/50 rounded-lg border border-slate-850 space-y-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase tracking-wider block">
                Medicare-Era Hearing
              </span>
              <div className="space-y-0.5">
                <label className="text-[9px] text-slate-400">Annual Care ($)</label>
                <NumericInput
                  value={activeStateConfig.post65HearingCare}
                  onChange={(val) => handleStateFieldChange(activeTab, 'post65HearingCare', val)}
                  prefix="$"
                  placeholder="0"
                />
                <span className="text-[9px] text-slate-500 block pt-1">
                  Hearing aids & audiology out-of-pocket.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Universal Medicare & IRMAA Form SSA-44 */}
        <div className="p-3.5 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Universal Medicare Part B & SSA-44 Settings
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-slate-400 font-medium">
                  Medicare Part B Custom Premium ($ / Mo)
                </label>
                <span className="text-[9px] text-slate-500 font-mono">
                  Base: ${projectedPartB.toFixed(0)}/mo
                </span>
              </div>
              <NumericInput
                value={currentConfig.medicarePartBPremium}
                onChange={(val) => handleUniversalFieldChange('medicarePartBPremium', val)}
                prefix="$"
                placeholder={`Standard: ${projectedPartB.toFixed(0)}`}
              />
            </div>

            <div className="flex items-center justify-between p-2.5 bg-slate-900/60 rounded-lg border border-slate-800">
              <div className="space-y-0.5 pr-2">
                <span className="text-xs font-semibold text-slate-200 block">
                  File Form SSA-44 Appeal
                </span>
                <span className="text-[10px] text-slate-400 block leading-tight">
                  Appeals IRMAA 2-year lookback tax return MAGI upon retirement work stoppage.
                </span>
              </div>
              <input
                type="checkbox"
                checked={currentConfig.fileSSA44LifeChangingEvent}
                onChange={(e) =>
                  handleUniversalFieldChange('fileSSA44LifeChangingEvent', e.target.checked)
                }
                className="rounded border-slate-700 text-emerald-500 focus:ring-emerald-500 h-4 w-4 bg-slate-900 cursor-pointer accent-emerald-500 shrink-0"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
