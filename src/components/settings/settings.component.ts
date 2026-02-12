import { Component, ChangeDetectionStrategy, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../services/settings.service';
import { AISettings } from '../../types/ai.types';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class SettingsComponent {
  private settingsService = inject(SettingsService);
  @Output() close = new EventEmitter<void>();

  // Create a local copy for editing to avoid changing the global signal directly
  currentSettings: AISettings;

  constructor() {
    // Deep copy the signal's value to prevent two-way binding issues
    this.currentSettings = JSON.parse(JSON.stringify(this.settingsService.settings()));
  }

  save(): void {
    this.settingsService.saveSettings(this.currentSettings);
    this.close.emit();
  }
}