import { useCallback, useState, type ReactNode } from 'react';
import App from './App';
import { HomeScreen } from './components/home/HomeScreen';
import { SetupGate } from './components/setup/SetupGate';
import { TutorialPage } from './components/help/TutorialPage';
import { ToastHost } from './components/ui/Toast';
import { getProject } from './utils/projectsApi';
import type { StudioSession } from './App';

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
      setOpen({ id, name: meta.name, session: session && Object.keys(session).length ? session : null });
    } catch (err: any) {
      setError(err?.message || 'Could not open that project.');
    } finally {
      setOpening(false);
    }
  }, []);

  const route = typeof window !== 'undefined'
    ? (window.location.pathname.replace(/\/+$/, '') || window.location.hash.replace(/^#\/?/, ''))
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
        <App
          key={open.id}
          projectId={open.id}
          projectName={open.name}
          initialSession={open.session}
          onExitHome={() => setOpen(null)}
          onProjectRenamed={(name) => setOpen((prev) => (prev ? { ...prev, name } : prev))}
        />
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
