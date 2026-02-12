import { Injectable, signal } from '@angular/core';
import { AIProvider, AISettings } from '../types/ai.types';

const SETTINGS_KEY = 'ai-settings';

@Injectable({
  providedIn: 'root',
})
export class SettingsService {
  settings = signal<AISettings>(this.loadSettings());

  private loadSettings(): AISettings {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      if (saved) {
        // Basic validation
        const parsed = JSON.parse(saved);
        if (parsed.provider && parsed.localEndpoint) {
           return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load AI settings from localStorage', e);
    }
    
    // Default settings
    return {
      provider: 'gemini',
      localEndpoint: 'http://localhost:1234/v1',
    };
  }

  saveSettings(newSettings: AISettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
      this.settings.set(newSettings);
    } catch(e) {
      console.error('Failed to save AI settings to localStorage', e);
    }
  }
}
