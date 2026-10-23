import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, ServerCog, TriangleAlert, RefreshCw } from 'lucide-react';
import { setupStatus, backendReachable, WS_BASE } from '../../utils/api';

type Phase =
  | 'checking'
  | 'no-backend'
  | 'ready'
  | 'needs-wsl'
  | 'needs-pack'
  | 'needs-provision'
  | 'provisioning'
  | 'error';

interface Step {
  step: string;
  message: string;
  progress?: number;
}

export function SetupGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [status, setStatus] = useState<any>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const check = useCallback(async () => {
    setPhase('checking');
    // The bundled backend sidecar can take a few seconds to come up.
    let up = false;
    for (let i = 0; i < 15; i++) {
      if (await backendReachable()) {
        up = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!up) return setPhase('no-backend');
    try {
      const s = await setupStatus();
      setStatus(s);
      if (!s.needs_provision) return setPhase('ready');
      if (s.wsl && !s.wsl.installed) return setPhase('needs-wsl');
      if (!s.pack_configured) return setPhase('needs-pack');
      return setPhase('needs-provision');
    } catch {
      return setPhase('no-backend');
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);
  useEffect(() => () => wsRef.current?.close(), []);

  const provision = useCallback(() => {
    setError(null);
    setStep(null);
    setPhase('provisioning');
    const ws = new WebSocket(`${WS_BASE}/ws/setup`);
    wsRef.current = ws;
    ws.onopen = () => ws.send('start');
    ws.onmessage = (evt) => {
      const m = JSON.parse(evt.data);
      if (m.type === 'progress') setStep(m);
      else if (m.type === 'done') {
        ws.close();
        check();
      } else if (m.type === 'error') {
        setError(m.message);
        setPhase('error');
        ws.close();
      }
    };
    ws.onerror = () => {
      setError('Lost the connection to the setup service.');
      setPhase('error');
    };
  }, [check]);

  if (phase === 'ready' || skipped) return <>{children}</>;

  return (
    <div className="flex items-center justify-center h-screen w-screen bg-app text-fg font-sans px-6">
      <div className="w-full max-w-md bg-surface border border-line rounded p-7 ">
        {phase === 'checking' && (
          <div className="flex items-center gap-3 text-sm text-fg-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Starting the OpenCFD engine...
          </div>
        )}

        {phase === 'no-backend' && (
          <>
            <Header
              icon={<TriangleAlert className="w-5 h-5 text-danger" />}
              title="Engine not responding"
            />
            <p className="text-[13px] text-fg-2 leading-relaxed mt-3">
              The OpenCFD backend did not start. It should be listening on
              <code className="mx-1 px-1.5 py-0.5 bg-app border border-line rounded font-mono text-[12px]">
                127.0.0.1:8000
              </code>
              . Wait a moment and retry; if it keeps failing, restart OpenCFD.
            </p>
            <Recheck onClick={check} />
          </>
        )}

        {phase === 'needs-wsl' && (
          <>
            <Header
              icon={<TriangleAlert className="w-5 h-5 text-warning" />}
              title="WSL2 is required"
            />
            <p className="text-[13px] text-fg-2 leading-relaxed mt-3">
              OpenCFD runs the OpenFOAM solver inside WSL2. Open PowerShell as administrator, run
              <code className="mx-1 px-1.5 py-0.5 bg-app border border-line rounded font-mono text-[12px]">
                wsl --install
              </code>
              , reboot, then come back.
            </p>
            <p className="text-[12px] text-fg-3 mt-2">{status?.wsl?.detail}</p>
            <Recheck onClick={check} />
          </>
        )}

        {phase === 'needs-pack' && (
          <>
            <Header
              icon={<ServerCog className="w-5 h-5 text-accent" />}
              title="Solver pack not bundled"
            />
            <p className="text-[13px] text-fg-2 leading-relaxed mt-3">
              This build does not include an OpenFOAM pack yet, so the solver cannot be provisioned.
              You can continue with the built-in mock solver.
            </p>
            <button
              onClick={() => setSkipped(true)}
              className="mt-5 w-full py-2 rounded-sm bg-accent hover:bg-accent-hover text-white text-[13px] font-medium"
            >
              Continue with the mock solver
            </button>
            <Recheck onClick={check} />
          </>
        )}

        {phase === 'needs-provision' && (
          <>
            <Header
              icon={<ServerCog className="w-5 h-5 text-accent" />}
              title="Set up the solver"
            />
            <p className="text-[13px] text-fg-2 leading-relaxed mt-3">
              OpenCFD will download OpenFOAM and import it as a private WSL distro (
              <span className="font-mono text-[12px]">{status?.distro ?? 'OpenCFD-FOAM'}</span>).
              This happens once and does not touch your other distros.
            </p>
            <button
              onClick={provision}
              className="mt-5 w-full py-2 rounded-sm bg-accent hover:bg-accent-hover text-white text-[13px] font-medium"
            >
              Install the OpenFOAM solver
            </button>
            <button
              onClick={() => setSkipped(true)}
              className="mt-2 w-full py-2 text-[12px] text-fg-3 hover:text-fg-2"
            >
              Skip for now (use the mock solver)
            </button>
          </>
        )}

        {phase === 'provisioning' && (
          <>
            <Header
              icon={<Loader2 className="w-5 h-5 text-accent animate-spin" />}
              title="Setting up the solver"
            />
            <div className="mt-4 h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-[width] duration-500"
                style={{ width: `${Math.round((step?.progress ?? 0.02) * 100)}%` }}
              />
            </div>
            <p className="text-[13px] text-fg-2 mt-3">{step?.message ?? 'Starting...'}</p>
            <p className="text-[11px] text-fg-3 mt-1">
              This can take a few minutes. Keep OpenCFD open.
            </p>
          </>
        )}

        {phase === 'error' && (
          <>
            <Header icon={<TriangleAlert className="w-5 h-5 text-danger" />} title="Setup failed" />
            <p className="text-[13px] text-fg-2 leading-relaxed mt-3 break-words">{error}</p>
            <button
              onClick={provision}
              className="mt-5 w-full py-2 rounded-sm bg-accent hover:bg-accent-hover text-white text-[13px] font-medium flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Try again
            </button>
            <button
              onClick={() => setSkipped(true)}
              className="mt-2 w-full py-2 text-[12px] text-fg-3 hover:text-fg-2"
            >
              Skip for now (use the mock solver)
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Header({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      {icon}
      <h1 className="text-[15px] font-semibold">{title}</h1>
    </div>
  );
}

function Recheck({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-4 w-full py-2 text-[12px] text-accent hover:text-accent-fg flex items-center justify-center gap-1.5"
    >
      <RefreshCw className="w-3.5 h-3.5" /> Check again
    </button>
  );
}
