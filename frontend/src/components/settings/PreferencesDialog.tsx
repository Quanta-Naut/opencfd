import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Check,
  Terminal,
  Monitor,
  Sun,
  Moon,
} from 'lucide-react';
import {
  fetchSettings,
  updateSettings,
  solverEnvironment,
  setupStatus,
  AppSettings,
} from '../../utils/api';
import { toast } from '../ui/Toast';
import { setThemePreference, useThemePreference, type ThemePreference } from '../../utils/theme';

export interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
}

type OS = 'Windows' | 'Darwin' | 'Linux' | 'unknown';

/** The active backend and a human label for it. */
function solverSummary(env: any): { name: string; detail: string } {
  if (!env) return { name: 'Checking…', detail: '' };
  const adapters = env.adapters || {};
  if (env.active === 'openfoam-local') {
    const a = adapters['openfoam-local'] || {};
    return {
      name: a.version ? `OpenFOAM ${a.version}` : 'OpenFOAM (local)',
      detail: a.detail || 'Ready.',
    };
  }
  if (env.active === 'openfoam-wsl') {
    const a = adapters['openfoam-wsl'] || {};
    return {
      name: a.distro ? `OpenFOAM in WSL · ${a.distro}` : 'OpenFOAM (WSL)',
      detail: a.detail || 'Ready.',
    };
  }
  return {
    name: 'Mock solver',
    detail: 'No OpenFOAM installation was detected - runs use the built-in mock, not a real solve.',
  };
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-2 pb-4 border-b border-line-soft last:border-b-0 last:pb-0">
    <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block">
      {title}
    </span>
    {children}
  </div>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start justify-between gap-4">
    <span className="text-fg-2 shrink-0">{label}</span>
    <span className="text-fg text-right">{children}</span>
  </div>
);

const THEME_CHOICES: { id: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { id: 'system', label: 'System', icon: <Monitor className="w-3.5 h-3.5" /> },
  { id: 'light', label: 'Light', icon: <Sun className="w-3.5 h-3.5" /> },
  { id: 'dark', label: 'Dark', icon: <Moon className="w-3.5 h-3.5" /> },
];

export const PreferencesDialog: React.FC<PreferencesDialogProps> = ({ open, onClose }) => {
  const themePref = useThemePreference();
  const [os, setOs] = useState<OS>('unknown');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [env, setEnv] = useState<any>(null);
  const [setup, setSetup] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [envLoading, setEnvLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bashrcDraft, setBashrcDraft] = useState('');

  const refreshEnv = async () => {
    setEnvLoading(true);
    try {
      const e = await solverEnvironment();
      setEnv(e);
    } finally {
      setEnvLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      // Fast: preferences and the OS. The solver-environment probe sources
      // OpenFOAM in a shell (can take ~10s), so it loads afterwards and the
      // dialog opens instantly with a spinner on the status block.
      const [status, settingsRes] = await Promise.all([setupStatus(), fetchSettings()]);
      if (cancelled) return;
      setOs((status?.os as OS) || 'unknown');
      setSetup(status);
      if (settingsRes.data) {
        setSettings(settingsRes.data);
        setBashrcDraft(settingsRes.data.foam_bashrc || '');
      } else {
        setError(settingsRes.detail || 'Could not load preferences.');
      }
      setLoading(false);

      setEnvLoading(true);
      const environment = await solverEnvironment();
      if (cancelled) return;
      setEnv(environment);
      setEnvLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const isWindows = os === 'Windows';
  const osLabel = os === 'Darwin' ? 'macOS' : os === 'Linux' ? 'Linux' : os;

  const handleCaseStorageChange = async (value: 'wsl' | 'windows') => {
    if (!settings || settings.case_storage === value) return;
    setSaving(true);
    setError(null);
    const res = await updateSettings({ case_storage: value });
    if (res.data) setSettings(res.data);
    else setError(res.detail || 'Could not save preference.');
    setSaving(false);
  };

  const handleBashrcChange = async (value: string) => {
    setSaving(true);
    setError(null);
    const res = await updateSettings({ foam_bashrc: value.trim() });
    if (res.data) {
      setSettings(res.data);
      setBashrcDraft(res.data.foam_bashrc);
      await refreshEnv();
      toast(
        res.data.foam_bashrc
          ? 'OpenFOAM environment script updated.'
          : 'OpenFOAM environment set back to auto-detect.',
        'success',
      );
    } else {
      setError(res.detail || 'Could not save preference.');
    }
    setSaving(false);
  };

  const summary = solverSummary(env);
  const autoBashrc: string | null = env?.foam_bashrc_auto ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-scrim p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-surface border border-line rounded flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Preferences"
      >
        <div className="px-4 py-3 border-b border-line-soft bg-surface-2 flex items-center justify-between shrink-0">
          <h2 className="text-sm font-bold text-fg">Preferences</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-fg-2 hover:text-fg hover:bg-surface-3 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4 text-xs text-fg max-h-[70vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 text-fg-2 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading preferences…</span>
            </div>
          ) : (
            <>
              <Section title="Appearance">
                <Row label="Theme">
                  <span
                    role="radiogroup"
                    aria-label="Theme"
                    className="inline-flex p-0.5 rounded border border-line bg-surface-2"
                  >
                    {THEME_CHOICES.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={themePref === c.id}
                        onClick={() => setThemePreference(c.id)}
                        className={`h-6 px-2.5 inline-flex items-center gap-1.5 rounded-sm font-medium transition-colors ${
                          themePref === c.id
                            ? 'bg-surface text-fg border border-line'
                            : 'text-fg-3 hover:text-fg border border-transparent'
                        }`}
                      >
                        {c.icon}
                        {c.label}
                      </button>
                    ))}
                  </span>
                </Row>
              </Section>

              {/* Solver environment - read-only status, all platforms */}
              <Section title="Solver environment">
                <div className="rounded border border-line divide-y divide-line-soft">
                  <div className="px-3 py-2 space-y-1.5">
                    <Row label="Platform">{osLabel}</Row>
                    <Row label="Active solver">
                      <span className="font-medium">{summary.name}</span>
                    </Row>
                  </div>
                  <div className="px-3 py-2 flex items-start gap-2">
                    <Terminal className="w-3.5 h-3.5 text-fg-3 shrink-0 mt-0.5" />
                    <p className="text-[11px] leading-relaxed text-fg-2 flex-1">{summary.detail}</p>
                    <button
                      type="button"
                      onClick={() => void refreshEnv()}
                      disabled={envLoading}
                      className="p-1 -mr-0.5 text-fg-2 hover:text-fg hover:bg-app rounded transition-colors shrink-0 disabled:opacity-50"
                      title="Re-detect"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${envLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>
              </Section>

              {/* Windows-only preferences */}
              {isWindows && (
                <Section title="Windows">
                  <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block pt-1">
                    Case file storage
                  </span>
                  <p className="text-fg-2 leading-relaxed">
                    OpenCFD runs the solver inside a managed WSL2 environment on Windows. Choose
                    where a project's solver case files live.
                  </p>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                      settings?.case_storage === 'wsl'
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:bg-app'
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
                      <div className="font-semibold text-fg">
                        WSL filesystem (recommended, default)
                      </div>
                      <div className="text-fg-2 mt-0.5">
                        Case files live inside the managed WSL environment. Fast - the solver reads
                        and writes its own native filesystem directly - but not directly browsable
                        from Windows Explorer.
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition-colors ${
                      settings?.case_storage === 'windows'
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:bg-app'
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
                      <div className="font-semibold text-fg">Windows filesystem</div>
                      <div className="text-fg-2 mt-0.5">
                        Case files live under your Windows user profile, visible and editable
                        directly from Windows tools.
                      </div>
                      <div className="flex items-start gap-1.5 mt-1.5 text-warning">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          Saving on Windows may cause performance issues - every solver read and
                          write crosses the WSL/Windows filesystem bridge, which is noticeably
                          slower for meshing and solving.
                        </span>
                      </div>
                    </div>
                  </label>

                  <div className="rounded border border-line px-3 py-2 space-y-1.5 mt-1">
                    <Row label="Managed environment">
                      {setup?.distro_ready ? (
                        <span className="inline-flex items-center gap-1 text-success">
                          <Check className="w-3.5 h-3.5" />
                          ready
                          {setup?.installed_version ? ` · pack ${setup.installed_version}` : ''}
                        </span>
                      ) : (
                        <span className="text-warning">needs setup</span>
                      )}
                    </Row>
                    {setup?.detail && (
                      <p className="text-[11px] leading-relaxed text-fg-2">{setup.detail}</p>
                    )}
                  </div>
                </Section>
              )}

              {/* macOS / Linux preferences */}
              {!isWindows && (
                <Section title={osLabel === 'unknown' ? 'OpenFOAM' : osLabel}>
                  <span className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider block pt-1">
                    OpenFOAM environment (advanced)
                  </span>
                  <p className="text-fg-2 leading-relaxed">
                    The environment script sourced before every solve. Leave it blank to auto-detect
                    your OpenFOAM install - set it only if auto-detection picks the wrong version.
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      spellCheck={false}
                      value={bashrcDraft}
                      onChange={(e) => setBashrcDraft(e.target.value)}
                      placeholder={autoBashrc || '/opt/openfoam13/etc/bashrc'}
                      className="flex-1 min-w-0 px-2 py-1.5 bg-surface border border-line rounded-sm font-mono text-[11px] text-fg placeholder:text-fg-4 focus:outline-none focus:border-accent transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => handleBashrcChange(bashrcDraft)}
                      disabled={saving || bashrcDraft.trim() === (settings?.foam_bashrc ?? '')}
                      className="px-2.5 py-1.5 rounded-sm border border-accent text-accent font-medium hover:bg-accent-soft disabled:opacity-40 disabled:pointer-events-none transition-colors shrink-0"
                    >
                      Save
                    </button>
                    {!!settings?.foam_bashrc && (
                      <button
                        type="button"
                        onClick={() => handleBashrcChange('')}
                        disabled={saving}
                        className="px-2.5 py-1.5 rounded-sm border border-line text-fg-2 font-medium hover:text-fg hover:bg-app disabled:opacity-40 transition-colors shrink-0"
                      >
                        Auto-detect
                      </button>
                    )}
                  </div>
                  <div className="rounded border border-line px-3 py-2 space-y-1.5">
                    <Row label="In use">
                      {settings?.foam_bashrc ? (
                        <span className="font-mono text-[11px]">{settings.foam_bashrc}</span>
                      ) : (
                        <span className="text-fg-2">auto-detected</span>
                      )}
                    </Row>
                    <Row label="Auto-detected">
                      <span className="font-mono text-[11px]">
                        {autoBashrc || 'already on PATH'}
                      </span>
                    </Row>
                  </div>
                  <p className="text-[11px] leading-relaxed text-fg-3">
                    Takes effect on the next solver run.
                  </p>
                </Section>
              )}

              {error && <p className="text-danger">{error}</p>}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default PreferencesDialog;
