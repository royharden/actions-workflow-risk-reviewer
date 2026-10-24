import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('index.html is missing #root');

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
