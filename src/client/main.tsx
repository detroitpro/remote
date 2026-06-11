import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.js';
import './styles.css';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('Missing #app root element');

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
