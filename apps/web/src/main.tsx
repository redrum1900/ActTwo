import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import CreatorApp from './creator/CreatorApp.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.location.pathname.startsWith('/creator') ? <CreatorApp /> : <App />}</React.StrictMode>);
