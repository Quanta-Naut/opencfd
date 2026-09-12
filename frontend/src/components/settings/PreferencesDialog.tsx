import React, { useEffect, useState } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { setupStatus, fetchSettings, updateSettings, AppSettings } from '../../utils/api';

export interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
}

export const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ open, onClose }) => {
  const [isWindows, setIsWindows] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const [status, res] = await Promise.all([setupStatus(), fetchSettings()]);
      if (cancelled) return;
      setIsWindows(status?.os === 'Windows');
      if (res.data) setSettings(res.data);
      else setError(res.detail || 'Could not load preferences.');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const handleCaseStorageChange = async (value: 'wsl' | 'windows') => {
    if (!settings || settings.case_storage === value) return;
    setSaving(true);
    setError(null);
    const res = await updateSettings({ case_storage: value });
    if (res.data) setSettings(res.data);
    else setError(res.detail || 'Could not save preference.');
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0B0D10]/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-white border border-[#E1E4E8] rounded flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
      >
        <div className="px-4 py-3 border-b border-[#EDEFF3] bg-[#FAFBFC] flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-[#171A1F]">Preferences</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-[#69717D] hover:text-[#171A1F] hover:bg-[#EDEFF3] rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs text-[#171A1F]">
          {loading ? (
            <div className="flex items-center gap-2 text-[#69717D] py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading preferences...</span>
            </div>
          ) : !isWindows ? (
            <p className="text-[#69717D] leading-relaxed">
              There are no OS-specific preferences on this platform yet. The
              solver runs natively here, so there is nothing to configure.
            </p>
          ) : (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold text-[#69717D] uppercase tracking-wider block">
                Case file storage
              </span>
              <p className="text-[#69717D] leading-relaxed">
                OpenCFD runs the solver inside a managed WSL2 environment on
                Windows. Choose where a project's solver case files live.
              </p>

              <label
                className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                  settings?.case_storage === 'wsl'
                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                    : 'border-[#E1E4E8] hover:bg-[#F5F6F8]'
                }`}
              >
                <input
                  type="radio"
                  name="case_storage"
                  className="mt-0.5"
                  checked={settings?.case_storage === 'wsl'}
                  onChange={() => handleCaseStorageChange('wsl')}
                  disabled={saving}
                />
                <div>
                  <div className="font-semibold text-[#171A1F]">
                    WSL filesystem (recommended, default)
                  </div>
                  <div className="text-[#69717D] mt-0.5">
                    Case files live inside the managed WSL environment. Fast -
                    the solver reads and writes its own native filesystem
                    directly - but not directly browsable from Windows
                    Explorer.
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                  settings?.case_storage === 'windows'
                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                    : 'border-[#E1E4E8] hover:bg-[#F5F6F8]'
                }`}
              >
                <input
                  type="radio"
                  name="case_storage"
                  className="mt-0.5"
                  checked={settings?.case_storage === 'windows'}
                  onChange={() => handleCaseStorageChange('windows')}
                  disabled={saving}
                />
                <div>
                  <div className="font-semibold text-[#171A1F]">Windows filesystem</div>
                  <div className="text-[#69717D] mt-0.5">
                    Case files live under your Windows user profile, visible
                    and editable directly from Windows tools.
                  </div>
                  <div className="flex items-start gap-1.5 mt-1.5 text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      Saving on Windows may cause performance issues - every
                      solver read and write crosses the WSL/Windows
                      filesystem bridge, which is noticeably slower for
                      meshing and solving.
                    </span>
                  </div>
                </div>
              </label>
            </div>
          )}

          {error && <p className="text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  );
};

export default PreferencesDialog;
