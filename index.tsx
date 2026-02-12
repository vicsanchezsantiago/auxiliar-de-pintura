import 'zone.js';
import '@angular/compiler';
import './src/index.css';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideZoneChangeDetection } from '@angular/core';
import { AppComponent } from './src/app.component';

bootstrapApplication(AppComponent, {
  providers: [
    provideZoneChangeDetection(),
    provideHttpClient(),
  ],
}).catch((err) => console.error(err));

// Global error handler to show runtime errors in-page (useful during dev)
window.addEventListener('error', (ev) => {
  try {
    const pre = document.createElement('pre');
    pre.style.background = 'rgba(0,0,0,0.85)';
    pre.style.color = 'white';
    pre.style.padding = '16px';
    pre.style.position = 'fixed';
    pre.style.left = '12px';
    pre.style.right = '12px';
    pre.style.top = '12px';
    pre.style.zIndex = '99999';
    pre.textContent = `Uncaught error: ${ev.message}\n${ev.filename}:${ev.lineno}:${ev.colno}\n${ev.error && ev.error.stack ? ev.error.stack : ''}`;
    document.body.appendChild(pre);
  } catch (e) {
    console.error(e);
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const pre = document.createElement('pre');
    pre.style.background = 'rgba(0,0,0,0.85)';
    pre.style.color = 'white';
    pre.style.padding = '16px';
    pre.style.position = 'fixed';
    pre.style.left = '12px';
    pre.style.right = '12px';
    pre.style.top = '12px';
    pre.style.zIndex = '99999';
    pre.textContent = `Unhandled Promise Rejection:\n${(ev.reason && ev.reason.stack) || String(ev.reason)}`;
    document.body.appendChild(pre);
  } catch (e) {
    console.error(e);
  }
});

// AI Studio always uses an `index.tsx` file for all project types.

// Global error handler to show runtime errors in-page (useful during dev)
window.addEventListener('error', (ev) => {
  try {
    const pre = document.createElement('pre');
    pre.style.background = 'rgba(0,0,0,0.85)';
    pre.style.color = 'white';
    pre.style.padding = '16px';
    pre.style.position = 'fixed';
    pre.style.left = '12px';
    pre.style.right = '12px';
    pre.style.top = '12px';
    pre.style.zIndex = '99999';
    pre.textContent = `Uncaught error: ${ev.message}\n${ev.filename}:${ev.lineno}:${ev.colno}\n${ev.error && ev.error.stack ? ev.error.stack : ''}`;
    document.body.appendChild(pre);
  } catch (e) {
    console.error(e);
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  try {
    const pre = document.createElement('pre');
    pre.style.background = 'rgba(0,0,0,0.85)';
    pre.style.color = 'white';
    pre.style.padding = '16px';
    pre.style.position = 'fixed';
    pre.style.left = '12px';
    pre.style.right = '12px';
    pre.style.top = '12px';
    pre.style.zIndex = '99999';
    pre.textContent = `Unhandled Promise Rejection:\n${(ev.reason && ev.reason.stack) || String(ev.reason)}`;
    document.body.appendChild(pre);
  } catch (e) {
    console.error(e);
  }
});

// AI Studio always uses an `index.tsx` file for all project types.
