import { useCallback, useState, useEffect, Suspense, lazy, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { HomeScreen } from './components/home/HomeScreen';
import { SetupGate } from './components/setup/SetupGate';
import { TutorialPage } from './components/help/TutorialPage';
import { ToastHost } from './components/ui/Toast';
import { getProject } from './utils/projectsApi';
import type { StudioSession } from './App';

// The CAD/mesh/solver workbench is the bulk of the app's JS (CadWorkbench2D
// alone is thousands of lines) but is never needed just to show the home
// screen or the tutorial page - load it only once a project is actually
// opened, so the initial page load stays light.
const App = lazy(() => import('./App'));

interface OpenProject {
  id: string;
  name: string;
  session: Partial<StudioSession> | null;
}

export function Root() {
  const [open, setOpen] = useState<OpenProject | null>(null);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(async (id: string) => {
    setOpening(true);
    setError(null);
    try {
      const { meta, session } = await getProject(id);
      setOpen({
        id,
        name: meta.name,
        session: session && Object.keys(session).length ? session : null,
      });
    } catch (err: any) {
      setError(err?.message || 'Could not open that project.');
    } finally {
      setOpening(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('project');
      if (q && !open) handleOpen(q);
    }
  }, [handleOpen, open]);

  const route =
    typeof window !== 'undefined'
      ? window.location.pathname.replace(/\/+$/, '') || window.location.hash.replace(/^#\/?/, '')
      : '';

  let view: ReactNode;
  if (route === '/tutorial' || route === 'tutorial') {
    view = <TutorialPage />;
  } else if (!open) {
    view = (
      <SetupGate>
        <HomeScreen onOpen={handleOpen} opening={opening} openError={error} />
      </SetupGate>
    );
  } else {
    view = (
      <SetupGate>
        <Suspense
          fallback={
            <div className="h-screen w-screen flex items-center justify-center bg-[#F4F5F7] text-[#69717D]">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          }
        >
          <App
            key={open.id}
            projectId={open.id}
            projectName={open.name}
            initialSession={open.session}
            onExitHome={() => setOpen(null)}
            onProjectRenamed={(name) => setOpen((prev) => (prev ? { ...prev, name } : prev))}
          />
        </Suspense>
      </SetupGate>
    );
  }

  return (
    <>
      {view}
      <ToastHost />
    </>
  );
}

export default Root;
