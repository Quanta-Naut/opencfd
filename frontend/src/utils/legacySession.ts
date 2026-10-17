// localStorage key used by pre-project-store versions of OpenCFD (before
// sessions moved to ~/.OpenCFD/projects). The home screen offers to import
// whatever is left under this key into a real project.
//
// Deliberately NOT exported from App.tsx: that module is lazy-loaded (it's
// the bulk of the app's JS, not needed just to show the home screen), and a
// static import from HomeScreen.tsx of anything in App.tsx would defeat the
// code-split by pulling the whole workbench into the home screen's bundle.
export const SESSION_STORAGE_KEY = 'opencfd_studio_session_v1';
