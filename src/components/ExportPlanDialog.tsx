import React, { useState, useEffect } from 'react';
import { AppStateInputs, SavedPlan, SimulationResultRow } from '../types';
import {
  X,
  Download,
  FileCode,
  FileText,
  FileSpreadsheet,
  Folder,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Info,
  RotateCcw
} from 'lucide-react';
import {
  ExportFormatType,
  EXPORT_FORMAT_CONFIGS,
  getDefaultExportFileName,
  sanitizeFileName,
  isFileSystemAccessSupported,
  generateJsonBlob,
  generatePdfBlob,
  generateExcelExportBlob,
  saveFileWithLocationPrompt,
  SaveFileResult
} from '../utils/exportHelpers';

interface ExportPlanDialogProps {
  isOpen: boolean;
  onClose: () => void;
  inputs: AppStateInputs;
  simulateSurvivor?: boolean;
  savedPlans?: SavedPlan[];
  ledger: SimulationResultRow[];
  initialFormat?: ExportFormatType;
}

export const ExportPlanDialog: React.FC<ExportPlanDialogProps> = ({
  isOpen,
  onClose,
  inputs,
  simulateSurvivor = false,
  savedPlans = [],
  ledger,
  initialFormat = 'json',
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormatType>(initialFormat);
  const [customBaseName, setCustomBaseName] = useState<string>('');
  const [promptForLocation, setPromptForLocation] = useState<boolean>(true);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<SaveFileResult | null>(null);
  const [hasPickerSupport, setHasPickerSupport] = useState<boolean>(true);

  // Sync format and generate initial filename whenever dialog opens or format changes
  useEffect(() => {
    if (isOpen) {
      setSelectedFormat(initialFormat);
      setExportStatus(null);
      setHasPickerSupport(isFileSystemAccessSupported());
      
      const defaultFullName = getDefaultExportFileName(initialFormat, inputs);
      const ext = EXPORT_FORMAT_CONFIGS[initialFormat].extension;
      // Strip extension for the base name input
      const base = defaultFullName.slice(0, -ext.length);
      setCustomBaseName(base);
    }
  }, [isOpen, initialFormat, inputs]);

  // When format switches inside the modal, update default file name if unchanged or adapt extension
  const handleFormatChange = (newFormat: ExportFormatType) => {
    setSelectedFormat(newFormat);
    setExportStatus(null);
    const defaultFullName = getDefaultExportFileName(newFormat, inputs);
    const ext = EXPORT_FORMAT_CONFIGS[newFormat].extension;
    const base = defaultFullName.slice(0, -ext.length);
    setCustomBaseName(base);
  };

  const handleResetName = () => {
    const defaultFullName = getDefaultExportFileName(selectedFormat, inputs);
    const ext = EXPORT_FORMAT_CONFIGS[selectedFormat].extension;
    const base = defaultFullName.slice(0, -ext.length);
    setCustomBaseName(base);
  };

  if (!isOpen) return null;

  const currentConfig = EXPORT_FORMAT_CONFIGS[selectedFormat];
  const fullFileNamePreview = sanitizeFileName(customBaseName || 'retirement_plan', currentConfig.extension);

  const handleExport = async () => {
    setIsExporting(true);
    setExportStatus(null);

    try {
      let blob: Blob;

      if (selectedFormat === 'json') {
        blob = generateJsonBlob(inputs, simulateSurvivor, savedPlans);
      } else if (selectedFormat === 'pdf') {
        blob = await generatePdfBlob(inputs);
      } else {
        blob = generateExcelExportBlob(ledger, inputs);
      }

      const result = await saveFileWithLocationPrompt(
        blob,
        customBaseName,
        selectedFormat,
        promptForLocation
      );

      setExportStatus(result);

      if (result.success) {
        // Auto-close on success after a short confirmation pause if user prefers
        setTimeout(() => {
          onClose();
        }, 1500);
      }
    } catch (err: unknown) {
      console.error('Export error:', err);
      setExportStatus({
        success: false,
        filename: fullFileNamePreview,
        error: err instanceof Error ? err.message : 'An unexpected error occurred during export.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-200">
      <div className="w-full max-w-xl bg-slate-900/95 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden glass-panel backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-200">
        
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl">
              <Download className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Export Plan & Reports
              </h2>
              <p className="text-xs text-slate-400">
                Specify the file name and destination folder on your device.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-100 bg-slate-800/40 hover:bg-slate-800 border border-slate-700/30 rounded-xl transition-all cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          
          {/* Section 1: Export Format Selector */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>1. Choose Export Format</span>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Option 1: JSON */}
              <button
                type="button"
                onClick={() => handleFormatChange('json')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 ${
                  selectedFormat === 'json'
                    ? 'bg-emerald-500/10 border-emerald-500/50 shadow-lg shadow-emerald-950/40'
                    : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <FileCode className={`w-5 h-5 ${selectedFormat === 'json' ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
                    selectedFormat === 'json' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    .json
                  </span>
                </div>
                <div>
                  <div className={`text-xs font-bold ${selectedFormat === 'json' ? 'text-slate-100' : 'text-slate-300'}`}>
                    Plan Configuration
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                    Full inputs for backup & restore
                  </p>
                </div>
              </button>

              {/* Option 2: PDF */}
              <button
                type="button"
                onClick={() => handleFormatChange('pdf')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 ${
                  selectedFormat === 'pdf'
                    ? 'bg-indigo-500/10 border-indigo-500/50 shadow-lg shadow-indigo-950/40'
                    : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <FileText className={`w-5 h-5 ${selectedFormat === 'pdf' ? 'text-indigo-400' : 'text-slate-400'}`} />
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
                    selectedFormat === 'pdf' ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    .pdf
                  </span>
                </div>
                <div>
                  <div className={`text-xs font-bold ${selectedFormat === 'pdf' ? 'text-slate-100' : 'text-slate-300'}`}>
                    Executive PDF Report
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                    Printable scenario summary & cards
                  </p>
                </div>
              </button>

              {/* Option 3: Excel */}
              <button
                type="button"
                onClick={() => handleFormatChange('excel')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between gap-2 ${
                  selectedFormat === 'excel'
                    ? 'bg-teal-500/10 border-teal-500/50 shadow-lg shadow-teal-950/40'
                    : 'bg-slate-950/50 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <FileSpreadsheet className={`w-5 h-5 ${selectedFormat === 'excel' ? 'text-teal-400' : 'text-slate-400'}`} />
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
                    selectedFormat === 'excel' ? 'bg-teal-500/20 text-teal-300' : 'bg-slate-800 text-slate-400'
                  }`}>
                    .xlsx
                  </span>
                </div>
                <div>
                  <div className={`text-xs font-bold ${selectedFormat === 'excel' ? 'text-slate-100' : 'text-slate-300'}`}>
                    Excel Ledger
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">
                    35-yr tax, cash-flow & IRMAA sheets
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Section 2: File Name Input */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="export-filename-input" className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                2. File Name
              </label>
              <button
                type="button"
                onClick={handleResetName}
                className="text-[10px] text-slate-500 hover:text-emerald-400 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                title="Reset to default timestamped filename"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset to Default</span>
              </button>
            </div>

            <div className="relative flex items-center">
              <input
                id="export-filename-input"
                type="text"
                value={customBaseName}
                onChange={(e) => setCustomBaseName(e.target.value)}
                placeholder="Enter file name"
                className="w-full bg-slate-950/70 border border-slate-800 focus:border-emerald-500/70 focus:ring-1 focus:ring-emerald-500/20 rounded-xl pl-4 pr-16 py-2.5 text-xs text-slate-100 font-mono placeholder-slate-600 focus:outline-none transition-colors"
              />
              <div className="absolute right-3 bg-slate-900 border border-slate-700/60 text-emerald-400 text-[11px] font-mono px-2 py-0.5 rounded-lg select-none">
                {currentConfig.extension}
              </div>
            </div>

            <p className="text-[10px] text-slate-500 font-mono truncate">
              Output: <span className="text-slate-300">{fullFileNamePreview}</span>
            </p>
          </div>

          {/* Section 3: Location / Save Method Selection */}
          <div className="space-y-2.5">
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>3. Storage Location & Prompt</span>
              {hasPickerSupport && (
                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 normal-case">
                  <Sparkles className="w-3 h-3" /> Native OS Folder Picker Available
                </span>
              )}
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option A: OS Picker / Prompt */}
              <div
                onClick={() => setPromptForLocation(true)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 ${
                  promptForLocation
                    ? 'bg-slate-850/80 border-emerald-500/40 ring-1 ring-emerald-500/10'
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700/60 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  <div className={`p-1.5 rounded-lg ${promptForLocation ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Folder className="w-4 h-4" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">
                      Prompt For Folder (Save As)
                    </span>
                    <input
                      type="radio"
                      name="locationMode"
                      checked={promptForLocation}
                      onChange={() => setPromptForLocation(true)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug">
                    Opens file picker to choose folder (Documents, Desktop, etc.) and confirm name.
                  </p>
                </div>
              </div>

              {/* Option B: Direct Browser Download */}
              <div
                onClick={() => setPromptForLocation(false)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex items-start gap-3 ${
                  !promptForLocation
                    ? 'bg-slate-850/80 border-emerald-500/40 ring-1 ring-emerald-500/10'
                    : 'bg-slate-950/40 border-slate-800 hover:border-slate-700/60 opacity-70 hover:opacity-100'
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  <div className={`p-1.5 rounded-lg ${!promptForLocation ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
                    <Download className="w-4 h-4" />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">
                      Direct Downloads Folder
                    </span>
                    <input
                      type="radio"
                      name="locationMode"
                      checked={!promptForLocation}
                      onChange={() => setPromptForLocation(false)}
                      className="accent-emerald-500 cursor-pointer"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug">
                    Saves directly to your browser's default download folder.
                  </p>
                </div>
              </div>
            </div>

            {!hasPickerSupport && promptForLocation && (
              <div className="p-2.5 bg-slate-950/40 border border-slate-800 rounded-xl flex items-start gap-2 text-[10px] text-slate-400">
                <Info className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <span>
                  Your current browser uses standard file downloads. The file will be named <code>{fullFileNamePreview}</code> and saved according to your browser download settings.
                </span>
              </div>
            )}
          </div>

          {/* Status Message Display */}
          {exportStatus && (
            <div className={`p-3.5 rounded-2xl border flex items-center gap-3 animate-in fade-in duration-150 ${
              exportStatus.success
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                : exportStatus.cancelled
                  ? 'bg-slate-950/60 border-slate-800 text-slate-400'
                  : 'bg-rose-950/40 border-rose-500/40 text-rose-200'
            }`}>
              {exportStatus.success ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  <div className="text-xs font-medium">
                    Successfully exported <strong>{exportStatus.filename}</strong>!
                  </div>
                </>
              ) : exportStatus.cancelled ? (
                <>
                  <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <div className="text-xs font-medium">
                    Export cancelled in the file picker.
                  </div>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <div className="text-xs font-medium">
                    {exportStatus.error || 'Failed to export report.'}
                  </div>
                </>
              )}
            </div>
          )}

        </div>

        {/* Modal Footer Actions */}
        <div className="p-6 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-750 text-slate-300 hover:text-slate-100 text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-xl shadow-lg shadow-emerald-950/50 hover:scale-102 active:scale-98 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Exporting...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Export & Save File</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
