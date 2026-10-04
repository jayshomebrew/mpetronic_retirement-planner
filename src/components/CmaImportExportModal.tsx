import React, { useState } from 'react';
import { X, Upload, Download, Trash2, AlertCircle, CheckCircle2, FileJson, Copy, Check } from 'lucide-react';
import { CMAProfile } from '../types';

interface CmaImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  customProfiles: CMAProfile[];
  onImportProfiles: (profiles: CMAProfile[]) => void;
  onDeleteProfile: (profileId: string) => void;
  activeProfile?: CMAProfile;
}

export const CmaImportExportModal: React.FC<CmaImportExportModalProps> = ({
  isOpen,
  onClose,
  customProfiles,
  onImportProfiles,
  onDeleteProfile,
  activeProfile,
}) => {
  const [activeTab, setActiveTab] = useState<'import' | 'export' | 'manage'>('import');
  const [jsonText, setJsonText] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  if (!isOpen) return null;

  const validateAndParseProfile = (data: unknown, index?: number): CMAProfile => {
    const prefix = index !== undefined ? `Profile #${index + 1}: ` : '';
    if (!data || typeof data !== 'object') {
      throw new Error(`${prefix}Expected a valid JSON object.`);
    }

    const obj = data as Record<string, unknown>;

    if (!obj.name || typeof obj.name !== 'string' || obj.name.trim() === '') {
      throw new Error(`${prefix}Field "name" is required.`);
    }

    const parseNum = (field: string, min: number, max: number, defaultValue?: number): number => {
      const val = obj[field];
      if (val === undefined || val === null || val === '') {
        if (defaultValue !== undefined) return defaultValue;
        throw new Error(`${prefix}Field "${field}" is required.`);
      }
      const num = Number(val);
      if (isNaN(num)) throw new Error(`${prefix}Field "${field}" must be a valid number.`);
      if (num < min || num > max) {
        throw new Error(`${prefix}Field "${field}" must be between ${min} and ${max}.`);
      }
      return num;
    };

    const equityReturnRate = parseNum('equityReturnRate', -0.20, 0.40);
    const equityVolatility = parseNum('equityVolatility', 0.01, 0.60);
    const fixedIncomeReturnRate = parseNum('fixedIncomeReturnRate', -0.10, 0.30);
    const fixedIncomeVolatility = parseNum('fixedIncomeVolatility', 0.01, 0.40);
    const cpiInflationRate = parseNum('cpiInflationRate', -0.05, 0.25);
    const cashYieldRate = parseNum('cashYieldRate', -0.05, 0.20, fixedIncomeReturnRate);
    const correlation = parseNum('correlation', -1.0, 1.0, 0.15);
    const cpiVolatility = parseNum('cpiVolatility', 0.001, 0.10, 0.018);
    const editionYear = parseNum('editionYear', 1900, 2100, new Date().getFullYear());

    const cleanName = obj.name.trim();
    const idSlug = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const id = typeof obj.id === 'string' && obj.id.trim() !== ''
      ? obj.id.trim()
      : `custom-${Date.now()}-${idSlug}`;

    return {
      id,
      name: cleanName,
      institution: typeof obj.institution === 'string' ? obj.institution.trim() : 'Custom Import',
      editionYear,
      horizon: typeof obj.horizon === 'string' ? obj.horizon.trim() : '30-Year Secular',
      description: typeof obj.description === 'string' ? obj.description.trim() : undefined,
      sourceUrl: typeof obj.sourceUrl === 'string' ? obj.sourceUrl.trim() : undefined,
      isBuiltIn: false,
      equityReturnRate,
      equityVolatility,
      fixedIncomeReturnRate,
      fixedIncomeVolatility,
      cashYieldRate,
      cpiInflationRate,
      cpiVolatility,
      correlation,
    };
  };

  const handleImportJson = () => {
    setValidationError(null);
    setSuccessMessage(null);

    if (!jsonText.trim()) {
      setValidationError('Please paste JSON text or select a file to import.');
      return;
    }

    try {
      const parsed = JSON.parse(jsonText);
      const profilesToImport: CMAProfile[] = [];

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) {
          throw new Error('Array of profiles is empty.');
        }
        for (let i = 0; i < parsed.length; i++) {
          profilesToImport.push(validateAndParseProfile(parsed[i], i));
        }
      } else {
        profilesToImport.push(validateAndParseProfile(parsed));
      }

      onImportProfiles(profilesToImport);
      setSuccessMessage(`Successfully imported ${profilesToImport.length} profile${profilesToImport.length > 1 ? 's' : ''}!`);
      setJsonText('');
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Invalid JSON format.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setJsonText(content);
      setValidationError(null);
      setSuccessMessage(null);
    };
    reader.onerror = () => {
      setValidationError('Failed to read file.');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const downloadJsonFile = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const downloadStarterTemplate = () => {
    const template = {
      name: 'Custom Asset Manager 2027',
      institution: 'Global Research Partners',
      editionYear: 2027,
      horizon: '30-Year Secular',
      description: 'Custom long-term capital market assumptions forecast.',
      sourceUrl: 'https://example.com/cma-report-2027.pdf',
      equityReturnRate: 0.070,
      equityVolatility: 0.155,
      fixedIncomeReturnRate: 0.045,
      fixedIncomeVolatility: 0.055,
      cashYieldRate: 0.035,
      cpiInflationRate: 0.025,
      correlation: 0.15,
    };
    downloadJsonFile(template, 'cma-profile-template.json');
  };

  const handleCopyJson = () => {
    if (!activeProfile) return;
    navigator.clipboard.writeText(JSON.stringify(activeProfile, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-400">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100">Capital Market Assumptions (CMA) Manager</h2>
              <p className="text-[11px] text-slate-400">Import annual updates or export active institutional assumptions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-4 pt-2 gap-2">
          <button
            onClick={() => setActiveTab('import')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-all border-b-2 cursor-pointer ${
              activeTab === 'import'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Import Profile
          </button>
          <button
            onClick={() => setActiveTab('export')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-all border-b-2 cursor-pointer ${
              activeTab === 'export'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Export Active Profile
          </button>
          <button
            onClick={() => setActiveTab('manage')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-lg transition-all border-b-2 cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'manage'
                ? 'border-emerald-500 text-emerald-400 bg-slate-800/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Custom Library</span>
            {customProfiles.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-mono">
                {customProfiles.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'import' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">Select a .json file or paste raw text below</span>
                  <span className="text-[11px] text-slate-400">Supports single profiles or an array of annual editions</span>
                </div>
                <div className="flex gap-2">
                  <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors border border-slate-700">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose File</span>
                    <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                  </label>
                  <button
                    onClick={downloadStarterTemplate}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-300 rounded-lg text-xs font-medium cursor-pointer transition-colors border border-slate-800"
                    title="Download template JSON"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Template</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">JSON Data</label>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder={`{\n  "name": "Vanguard VCMM 2027",\n  "institution": "Vanguard",\n  "editionYear": 2027,\n  "equityReturnRate": 0.068,\n  "equityVolatility": 0.160,\n  "fixedIncomeReturnRate": 0.046,\n  "fixedIncomeVolatility": 0.055,\n  "cashYieldRate": 0.035,\n  "cpiInflationRate": 0.024,\n  "correlation": 0.15\n}`}
                  rows={8}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500/50 resize-y"
                />
              </div>

              {validationError && (
                <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <span>{validationError}</span>
                </div>
              )}

              {successMessage && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-xs">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{successMessage}</span>
                </div>
              )}

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleImportJson}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-colors cursor-pointer"
                >
                  Validate & Import to Plan
                </button>
              </div>
            </div>
          )}

          {activeTab === 'export' && (
            <div className="space-y-4">
              {activeProfile ? (
                <>
                  <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800 space-y-1">
                    <span className="text-xs font-semibold text-slate-200">Active Profile: {activeProfile.name}</span>
                    <p className="text-[11px] text-slate-400">
                      {activeProfile.institution} ({activeProfile.editionYear || 2026}) • {activeProfile.horizon}
                    </p>
                  </div>

                  <div className="relative">
                    <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 overflow-x-auto max-h-60">
                      {JSON.stringify(activeProfile, null, 2)}
                    </pre>
                    <button
                      onClick={handleCopyJson}
                      className="absolute top-3 right-3 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer border border-slate-700"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => downloadJsonFile(activeProfile, `${activeProfile.id || 'cma-profile'}.json`)}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl shadow transition-colors cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>Download JSON File</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-400 text-xs">
                  No active preset selected to export.
                </div>
              )}
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-3">
              {customProfiles.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs">
                  You have not imported any custom CMA profiles yet. Built-in institutional presets (Vanguard, BlackRock, J.P. Morgan, Consensus) are pre-loaded in your application.
                </div>
              ) : (
                <div className="space-y-2">
                  {customProfiles.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-3 bg-slate-950/60 rounded-xl border border-slate-800 hover:border-slate-700 transition-colors"
                    >
                      <div className="space-y-0.5">
                        <span className="text-xs font-semibold text-slate-200">{p.name}</span>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2">
                          <span>{p.institution} ({p.editionYear})</span>
                          <span>•</span>
                          <span className="text-emerald-400 font-mono">{(p.equityReturnRate * 100).toFixed(1)}% Stocks</span>
                          <span>•</span>
                          <span className="text-blue-400 font-mono">{(p.fixedIncomeReturnRate * 100).toFixed(1)}% Bonds</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => downloadJsonFile(p, `${p.id}.json`)}
                          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          title="Export this profile"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDeleteProfile(p.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                          title="Delete from custom library"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
