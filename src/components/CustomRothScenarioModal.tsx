import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Plus,
  Trash2,
  AlertTriangle,
  Check,
  Calendar,
  RefreshCw,
} from 'lucide-react';
import {
  AppStateInputs,
  SimulationResultRow,
  CustomRothScenario,
  getSimulationStartYear,
} from '../types';
import { runRetirementSimulation } from '../engine/simulationEngine';
import { NumericInput } from './NumericInput';

interface CustomRothScenarioModalProps {
  isOpen: boolean;
  onClose: () => void;
  inputs: AppStateInputs;
  ledger: SimulationResultRow[];
  simulateSurvivor: boolean;
  activeScenarioId?: string | null;
  onSaveScenario: (scenario: CustomRothScenario, applyImmediately?: boolean) => void;
  onDeleteScenario: (scenarioId: string) => void;
}

export const CustomRothScenarioModal: React.FC<CustomRothScenarioModalProps> = ({
  isOpen,
  onClose,
  inputs,
  ledger,
  simulateSurvivor,
  activeScenarioId,
  onSaveScenario,
  onDeleteScenario,
}) => {
  const simStartYear = getSimulationStartYear(inputs);
  const customScenarios = useMemo(() => inputs.customRothScenarios || [], [inputs.customRothScenarios]);

  // Selected scenario ID in modal dropdown (or 'new' for creating a new scenario)
  const [selectedId, setSelectedId] = useState<string>(activeScenarioId || customScenarios[0]?.id || 'new');
  
  // Draft state for editing
  const [scenarioName, setScenarioName] = useState<string>('');
  const [schedule, setSchedule] = useState<Record<number, number>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<boolean>(false);

  // Helper to construct a default schedule seeded from the current active simulation ledger
  const createSeededScheduleFromModel = React.useCallback((): Record<number, number> => {
    const seedMap: Record<number, number> = {};
    const startYr = inputs.rothConversionStartYear !== undefined ? inputs.rothConversionStartYear : (simStartYear + 1);
    const endYr = inputs.rothConversionEndYear !== undefined ? inputs.rothConversionEndYear : (startYr + 7);

    // Look for rows in current simulation ledger
    for (let yr = startYr; yr <= endYr; yr++) {
      const row = ledger.find((r) => r.year === yr);
      const convAmount = row?.intentionalRothConversion || inputs.annualRothConversion || 0;
      seedMap[yr] = Math.round(convAmount);
    }
    return seedMap;
  }, [inputs.rothConversionStartYear, inputs.rothConversionEndYear, inputs.annualRothConversion, simStartYear, ledger]);

  // Helper to load a scenario into draft state
  const loadScenarioIntoDraft = React.useCallback((scenId: string) => {
    if (scenId === 'new') {
      const defaultName = `Custom Plan ${customScenarios.length + 1}`;
      setScenarioName(defaultName);
      setSchedule(createSeededScheduleFromModel());
    } else {
      const found = customScenarios.find((s) => s.id === scenId);
      if (found) {
        setScenarioName(found.name);
        setSchedule({ ...found.schedule });
      } else {
        setScenarioName(`Custom Plan ${customScenarios.length + 1}`);
        setSchedule(createSeededScheduleFromModel());
      }
    }
    setShowDeleteConfirm(false);
  }, [customScenarios, createSeededScheduleFromModel]);

  // Synchronize when modal opens or activeScenarioId changes
  useEffect(() => {
    if (isOpen) {
      const initId = activeScenarioId || customScenarios[0]?.id || 'new';
      setSelectedId(initId);
      loadScenarioIntoDraft(initId);
    }
  }, [isOpen, activeScenarioId, customScenarios, loadScenarioIntoDraft]);

  // Handle switching scenario in dropdown
  const handleSelectScenario = (id: string) => {
    setSelectedId(id);
    loadScenarioIntoDraft(id);
  };

  // Sorted list of years in draft schedule
  const sortedYears = useMemo(() => {
    return Object.keys(schedule)
      .map(Number)
      .sort((a, b) => a - b);
  }, [schedule]);

  // Total conversion across all draft years
  const totalDraftConversions = useMemo(() => {
    return Object.values(schedule).reduce((sum, val) => sum + (val || 0), 0);
  }, [schedule]);

  // Helper to find age for a given year
  const getAgesForYear = (yr: number) => {
    const row = ledger.find((r) => r.year === yr);
    if (row) {
      return { yourAge: row.yourAge, wifeAge: row.wifeAge };
    }
    const yourBirthYear = parseInt(inputs.you.birthDate?.split('-')[0] || '1960', 10);
    const wifeBirthYear = parseInt(inputs.wife?.birthDate?.split('-')[0] || '1964', 10);
    return {
      yourAge: yr - yourBirthYear,
      wifeAge: yr - wifeBirthYear,
    };
  };

  // Handle single year amount update
  const handleUpdateAmount = (year: number, amount: number) => {
    const safeAmt = Math.max(0, isNaN(amount) ? 0 : amount);
    setSchedule((prev) => ({
      ...prev,
      [year]: safeAmt,
    }));
  };

  // Handle deleting a year from schedule
  const handleDeleteYear = (year: number) => {
    setSchedule((prev) => {
      const next = { ...prev };
      delete next[year];
      return next;
    });
  };

  // Handle adding a year to schedule
  const handleAddYear = () => {
    const maxYear = sortedYears.length > 0 ? Math.max(...sortedYears) : simStartYear;
    const newYear = maxYear + 1;
    setSchedule((prev) => ({
      ...prev,
      [newYear]: prev[maxYear] || 50000,
    }));
  };

  // Reset to live model conversion values
  const handleResetToCurrentModel = () => {
    setSchedule(createSeededScheduleFromModel());
  };

  // Preview simulation to check for resource feasibility (pre-tax asset exhaustion)
  const previewSimulation = useMemo(() => {
    if (!isOpen || sortedYears.length === 0) return null;

    const draftScenario: CustomRothScenario = {
      id: selectedId === 'new' ? 'temp-preview' : selectedId,
      name: scenarioName || 'Preview Scenario',
      schedule,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const previewInputs: AppStateInputs = {
      ...inputs,
      rothConversionStrategy: 'custom',
      customRothScenarios: [draftScenario],
      activeCustomScenarioId: draftScenario.id,
    };

    try {
      const previewLedger = runRetirementSimulation(previewInputs, simulateSurvivor, null);
      const cappedRows = previewLedger.filter((r) => r.isRothConversionCapped);
      return { previewLedger, cappedRows };
    } catch {
      return null;
    }
  }, [isOpen, sortedYears, selectedId, scenarioName, schedule, inputs, simulateSurvivor]);

  const cappedYears = previewSimulation?.cappedRows || [];

  // Save changes handler
  const handleSave = (applyImmediately: boolean = true) => {
    const cleanName = scenarioName.trim() || `Custom Plan ${customScenarios.length + 1}`;
    const id = selectedId === 'new' ? `custom-roth-${Date.now()}` : selectedId;

    const savedScenario: CustomRothScenario = {
      id,
      name: cleanName,
      schedule,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSaveScenario(savedScenario, applyImmediately);
    onClose();
  };

  // Delete scenario handler
  const handleDelete = () => {
    if (selectedId !== 'new') {
      onDeleteScenario(selectedId);
      onClose();
    }
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }).format(Math.round(val || 0));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="glass-panel max-w-2xl w-full p-6 rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl space-y-5 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                Custom Roth Conversion Schedule
              </h3>
              <p className="text-xs text-slate-400">
                Define exact, year-by-year Roth conversions and save as named scenarios
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm font-bold p-1.5 rounded-lg hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scenario Switcher & Naming Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center bg-slate-950/60 p-3 rounded-xl border border-slate-800">
          {/* Dropdown to pick existing scenario */}
          <div className="sm:col-span-5 flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Saved Scenarios
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={selectedId}
                onChange={(e) => handleSelectScenario(e.target.value)}
                className="w-full bg-slate-900 text-slate-100 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-semibold focus:outline-none focus:border-purple-500 cursor-pointer"
              >
                <option value="new">+ Create New Scenario...</option>
                {customScenarios.map((scen) => (
                  <option key={scen.id} value={scen.id}>
                    {scen.name} ({Object.keys(scen.schedule).length} yrs)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scenario Name Input */}
          <div className="sm:col-span-7 flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Scenario Name
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="e.g. Frontloaded 24% Fed Window"
                className="flex-1 bg-slate-900 text-slate-100 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-purple-500"
              />
              <button
                type="button"
                onClick={handleResetToCurrentModel}
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                title="Re-populate year amounts from current simulation model"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Clone Model</span>
              </button>
            </div>
          </div>
        </div>

        {/* Resource Exhaustion Warning Banner */}
        {cappedYears.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-300 space-y-1 text-xs animate-in fade-in duration-200">
            <div className="flex items-center gap-2 font-bold text-amber-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Resource Constraint Warning</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              Available Traditional / Pre-Tax IRA balances will be depleted before reaching your requested conversion target in:
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {cappedYears.map((r) => (
                <span
                  key={r.year}
                  className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold border border-amber-500/30"
                >
                  {r.year}: Requested {formatCurrency(r.requestedCustomRothConversion || 0)} → Actual {formatCurrency(r.intentionalRothConversion)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Year-by-Year Editor Table */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar min-h-[220px]">
          <div className="flex items-center justify-between text-xs px-1 text-slate-400 font-mono">
            <span>{sortedYears.length} Conversion Years Defined</span>
            <span className="font-bold text-purple-400">
              Total: {formatCurrency(totalDraftConversions)}
            </span>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/40">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Year</th>
                  <th className="py-2.5 px-3">Ages (You / Spouse)</th>
                  <th className="py-2.5 px-3 text-right">Annual Conversion ($)</th>
                  <th className="py-2.5 px-3 text-center w-16">Remove</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {sortedYears.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-slate-500 italic">
                      No conversion years configured. Click "+ Add Conversion Year" below to get started.
                    </td>
                  </tr>
                ) : (
                  sortedYears.map((yr) => {
                    const ages = getAgesForYear(yr);
                    const amount = schedule[yr] || 0;
                    const isCapped = cappedYears.some((c) => c.year === yr);

                    return (
                      <tr
                        key={yr}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          isCapped ? 'bg-amber-950/10' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-bold text-slate-100">{yr}</td>
                        <td className="py-2 px-3 text-slate-400">
                          {inputs.isSingleFiler ? `Age ${ages.yourAge}` : `Ages ${ages.yourAge} / ${ages.wifeAge}`}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="flex items-center justify-end">
                            <NumericInput
                              prefix="$"
                              min={0}
                              step={5000}
                              value={amount}
                              onChange={(val) => handleUpdateAmount(yr, val || 0)}
                              placeholder="0"
                              wrapperClassName="w-32"
                              className={`text-right text-xs font-bold font-mono ${
                                isCapped
                                  ? 'border-amber-500/60 text-amber-300 focus:border-amber-400'
                                  : 'border-slate-800 text-purple-300 focus:border-purple-400'
                              }`}
                            />
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDeleteYear(yr)}
                            className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Remove year"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between items-center pt-1">
            <button
              type="button"
              onClick={handleAddYear}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 text-purple-300 text-xs font-semibold transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Conversion Year</span>
            </button>

            {sortedYears.length > 0 && (
              <span className="text-[11px] text-slate-500 font-mono">
                Years {sortedYears[0]} – {sortedYears[sortedYears.length - 1]}
              </span>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
          <div>
            {selectedId !== 'new' && (
              showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-rose-400 font-bold">Delete this plan?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs transition-all cursor-pointer"
                  >
                    Confirm Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-2 py-1 text-slate-400 hover:text-slate-200 text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Scenario</span>
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(true)}
              className="px-5 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-400 hover:to-indigo-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg shadow-purple-500/20 transition-all active:scale-95 cursor-pointer flex items-center gap-1.5"
            >
              <Check className="w-4 h-4" />
              <span>Save & Apply Schedule</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
