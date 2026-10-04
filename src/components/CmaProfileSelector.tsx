import React, { useState } from 'react';
import { 
  Building2, 
  ExternalLink, 
  RotateCcw, 
  SlidersHorizontal,
  FileJson
} from 'lucide-react';
import { AppStateInputs, CMAProfile } from '../types';
import { 
  getAllCmaProfiles, 
  getCmaProfile, 
  isProfileModified, 
  DEFAULT_CMA_PROFILE_ID,
  CurrentParameterValues 
} from '../constants/cmaProfiles';
import { CmaImportExportModal } from './CmaImportExportModal';

interface CmaProfileSelectorProps {
  inputs: AppStateInputs;
  onChangeInputs: (newInputs: AppStateInputs) => void;
}

export const CmaProfileSelector: React.FC<CmaProfileSelectorProps> = ({
  inputs,
  onChangeInputs,
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  const customProfiles = inputs.monteCarloSettings.customCmaProfiles || [];
  const allProfiles = getAllCmaProfiles(customProfiles);

  const defaultPresetId = DEFAULT_CMA_PROFILE_ID;
  const activeId = inputs.monteCarloSettings.activeCmaProfileId || defaultPresetId;
  const baseId = inputs.monteCarloSettings.baseCmaProfileId || (activeId !== 'custom' ? activeId : defaultPresetId);

  const activeProfile = getCmaProfile(activeId, customProfiles);
  const baseProfile = getCmaProfile(baseId, customProfiles) || getCmaProfile(defaultPresetId);

  // Reference profile for deviation comparisons: active preset or the underlying parent preset
  const referenceProfile = activeProfile || baseProfile;

  const currentValues: CurrentParameterValues = {
    equityReturnRate: inputs.growthAssumptions.equityReturnRate,
    equityVolatility: inputs.monteCarloSettings.equityVolatility,
    fixedIncomeReturnRate: inputs.growthAssumptions.fixedIncomeReturnRate,
    fixedIncomeVolatility: inputs.monteCarloSettings.fixedIncomeVolatility,
    cashYieldRate: inputs.growthAssumptions.cashYieldRate,
    cpiInflationRate: inputs.growthAssumptions.cpiInflationRate,
    correlation: inputs.monteCarloSettings.correlation,
  };

  const isModified = isProfileModified(referenceProfile, currentValues);

  const handleSelectPreset = (selectedId: string) => {
    if (selectedId === 'custom') {
      onChangeInputs({
        ...inputs,
        monteCarloSettings: {
          ...inputs.monteCarloSettings,
          activeCmaProfileId: 'custom',
        },
      });
      return;
    }

    const preset = getCmaProfile(selectedId, customProfiles);
    if (!preset) return;

    onChangeInputs({
      ...inputs,
      growthAssumptions: {
        ...inputs.growthAssumptions,
        equityReturnRate: preset.equityReturnRate,
        fixedIncomeReturnRate: preset.fixedIncomeReturnRate,
        cashYieldRate: preset.cashYieldRate,
        cpiInflationRate: preset.cpiInflationRate,
      },
      monteCarloSettings: {
        ...inputs.monteCarloSettings,
        equityVolatility: preset.equityVolatility,
        fixedIncomeVolatility: preset.fixedIncomeVolatility,
        correlation: preset.correlation,
        activeCmaProfileId: preset.id,
        baseCmaProfileId: preset.id,
      },
    });
  };

  const handleResetToPreset = () => {
    if (!referenceProfile) return;
    onChangeInputs({
      ...inputs,
      growthAssumptions: {
        ...inputs.growthAssumptions,
        equityReturnRate: referenceProfile.equityReturnRate,
        fixedIncomeReturnRate: referenceProfile.fixedIncomeReturnRate,
        cashYieldRate: referenceProfile.cashYieldRate,
        cpiInflationRate: referenceProfile.cpiInflationRate,
      },
      monteCarloSettings: {
        ...inputs.monteCarloSettings,
        equityVolatility: referenceProfile.equityVolatility,
        fixedIncomeVolatility: referenceProfile.fixedIncomeVolatility,
        correlation: referenceProfile.correlation,
        activeCmaProfileId: referenceProfile.id,
        baseCmaProfileId: referenceProfile.id,
      },
    });
  };

  const handleImportProfiles = (newProfiles: CMAProfile[]) => {
    const updatedCustom = [...newProfiles, ...customProfiles];
    // Activate the first imported profile
    const first = newProfiles[0];
    onChangeInputs({
      ...inputs,
      growthAssumptions: {
        ...inputs.growthAssumptions,
        equityReturnRate: first.equityReturnRate,
        fixedIncomeReturnRate: first.fixedIncomeReturnRate,
        cashYieldRate: first.cashYieldRate,
        cpiInflationRate: first.cpiInflationRate,
      },
      monteCarloSettings: {
        ...inputs.monteCarloSettings,
        equityVolatility: first.equityVolatility,
        fixedIncomeVolatility: first.fixedIncomeVolatility,
        correlation: first.correlation,
        activeCmaProfileId: first.id,
        baseCmaProfileId: first.id,
        customCmaProfiles: updatedCustom,
      },
    });
  };

  const handleDeleteCustomProfile = (profileId: string) => {
    const updatedCustom = customProfiles.filter(p => p.id !== profileId);
    let nextActiveId = inputs.monteCarloSettings.activeCmaProfileId;
    let nextBaseId = inputs.monteCarloSettings.baseCmaProfileId;

    if (nextActiveId === profileId) nextActiveId = 'custom';
    if (nextBaseId === profileId) nextBaseId = null;

    onChangeInputs({
      ...inputs,
      monteCarloSettings: {
        ...inputs.monteCarloSettings,
        activeCmaProfileId: nextActiveId,
        baseCmaProfileId: nextBaseId,
        customCmaProfiles: updatedCustom,
      },
    });
  };

  return (
    <>
      <div className="bg-slate-950/80 p-4 rounded-xl border border-slate-800 space-y-3.5 shadow-sm">
        {/* Top Bar: Title & Dropdown / Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-100 uppercase tracking-wide">
                  Capital Market Assumptions (CMA)
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                  30-Yr Secular
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Ground simulated returns and stochastic distributions in Wall Street institutional research
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Presets Dropdown */}
            <select
              value={activeId}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="bg-slate-900 border border-slate-700 text-slate-200 text-xs font-medium rounded-lg px-3 py-1.5 focus:outline-none focus:border-emerald-500/60 cursor-pointer"
            >
              <optgroup label="Institutional Presets (2026)">
                {allProfiles.filter(p => p.isBuiltIn).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.editionYear || 2026})
                  </option>
                ))}
              </optgroup>
              {customProfiles.length > 0 && (
                <optgroup label="Custom Imported Profiles">
                  {customProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.editionYear})
                    </option>
                  ))}
                </optgroup>
              )}
              <option value="custom">Custom Portfolio (Manual)</option>
            </select>

            {/* Import / Export Modal Trigger */}
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
              title="Import, Export, or Manage CMA JSON Profiles"
            >
              <FileJson className="w-3.5 h-3.5 text-emerald-400" />
              <span>Import / Export</span>
            </button>
          </div>
        </div>

        {/* Profile Status & Metadata Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-900/60 rounded-lg border border-slate-800/80 text-xs">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {referenceProfile ? (
                <>
                  <span className="font-semibold text-slate-200">
                    {referenceProfile.name} ({referenceProfile.editionYear || 2026})
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-400">{referenceProfile.institution}</span>
                </>
              ) : (
                <span className="font-semibold text-slate-200">Custom Portfolio</span>
              )}

              {/* Status Badge */}
              {isModified ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 flex items-center gap-1">
                  <SlidersHorizontal className="w-3 h-3" />
                  <span>Modified from {referenceProfile?.name || 'Preset'}</span>
                </span>
              ) : referenceProfile ? (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                  Institutional Baseline Active
                </span>
              ) : (
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  Manual Configuration
                </span>
              )}
            </div>

            {referenceProfile?.description && (
              <p className="text-[11px] text-slate-400 leading-snug">
                {referenceProfile.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {referenceProfile?.sourceUrl && (
              <a
                href={referenceProfile.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 hover:underline"
              >
                <span>Whitepaper</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            {isModified && referenceProfile && (
              <button
                type="button"
                onClick={handleResetToPreset}
                className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer"
                title={`Reset all return and risk sliders back to ${referenceProfile.name} defaults`}
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to {referenceProfile.name}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Import / Export / Management Modal */}
      <CmaImportExportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        customProfiles={customProfiles}
        onImportProfiles={handleImportProfiles}
        onDeleteProfile={handleDeleteCustomProfile}
        activeProfile={referenceProfile}
      />
    </>
  );
};
