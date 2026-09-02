import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const container = document.getElementById('root')!;

// The boot placeholder is painted by index.html so the first frame is never
// blank. Remove it explicitly rather than relying on React clearing the node.
document.getElementById('boot')?.remove();

createRoot(container, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
