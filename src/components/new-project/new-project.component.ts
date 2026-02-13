import { Component, ChangeDetectionStrategy, signal, Output, EventEmitter, inject, NgZone, ViewChild, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { ProjectPlan } from '../../types/inventory.types';
import { RegionSelectorComponent, RegionItem } from '../region-selector/region-selector.component';

@Component({
  selector: 'app-new-project',
  templateUrl: './new-project.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, RegionSelectorComponent],
})
export class NewProjectComponent {
  geminiService = inject(GeminiService);
  private ngZone = inject(NgZone);
  private cdr = inject(ChangeDetectorRef);

  projectName = signal('');
  projectSource = signal('');
  referenceImage = signal<{ file: File, base64: string, type: string } | null>(null);
  previewUrl = signal<string | null>(null);
  
  // Seletor de regiões
  showRegionSelector = signal(false);
  pendingRegions = signal<RegionItem[]>([]);
  
  @ViewChild(RegionSelectorComponent) regionSelector?: RegionSelectorComponent;
  
  @Output() projectGenerated = new EventEmitter<ProjectPlan>();
  @Output() generationStarted = new EventEmitter<string>();
  @Output() generationFailed = new EventEmitter<string>();

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64String = (e.target?.result as string).split(',')[1];
        this.referenceImage.set({ file, base64: base64String, type: file.type });
        this.previewUrl.set(URL.createObjectURL(file));
      };
      reader.readAsDataURL(file);
    }
  }

  /** Etapa 1: Abre o seletor de regiões ANTES de gerar */
  openRegionSelector(): void {
    if (!this.projectName() || !this.projectSource() || !this.referenceImage()) {
      alert('Por favor, preencha todos os campos e envie uma imagem de referência.');
      return;
    }
    this.showRegionSelector.set(true);
    this.cdr.detectChanges();
  }

  /** Quando o usuário clica "Consultar IA" no seletor de regiões */
  async onIdentifyParts(): Promise<void> {
    if (!this.referenceImage()) return;
    
    const { base64, type } = this.referenceImage()!;
    
    try {
      const parts = await this.geminiService.identifyPartsInImage(
        this.projectName(),
        this.projectSource(),
        base64,
        type
      );
      
      this.ngZone.run(() => {
        if (this.regionSelector) {
          this.regionSelector.setPartsFromAI(parts);
        }
      });
    } catch (error: any) {
      console.error('[NewProject] Erro ao identificar partes:', error);
      this.ngZone.run(() => {
        if (this.regionSelector) {
          this.regionSelector.setAIError('Erro ao consultar IA: ' + (error.message || 'Erro desconhecido'));
        }
      });
    }
  }

  /** Etapa 2: Regiões confirmadas → gerar projeto com elas */
  async onRegionsConfirmed(regions: RegionItem[]): Promise<void> {
    this.pendingRegions.set(regions);
    this.showRegionSelector.set(false);
    this.cdr.detectChanges();
    
    // Agora gera o projeto com as regiões definidas
    await this.generatePlanWithRegions(regions);
  }

  onRegionsCancelled(): void {
    this.showRegionSelector.set(false);
    this.cdr.detectChanges();
  }

  /** Gera o plano usando as regiões confirmadas pelo usuário */
  private async generatePlanWithRegions(regions: RegionItem[]): Promise<void> {
    this.generationStarted.emit('Gerando seu plano de pintura com as partes definidas...');
    
    const { base64, type } = this.referenceImage()!;

    try {
      const plan = await this.geminiService.generateProjectPlanWithRegions(
        this.projectName(),
        this.projectSource(),
        base64,
        type,
        regions
      );

      console.log('[NewProjectComponent] Plano recebido:', plan);

      this.ngZone.run(() => {
        if (plan) {
          this.projectGenerated.emit(plan);
        } else {
          this.generationFailed.emit('A IA não conseguiu gerar um plano. Tente novamente.');
        }
      });
    } catch (error: any) {
      console.error('[NewProjectComponent] Erro:', error);
      this.ngZone.run(() => {
        this.generationFailed.emit(error.message || 'Erro desconhecido ao gerar o plano.');
      });
    }
  }

  /** Fluxo legado sem regiões (botão direto - mantido como fallback) */
  async generatePlan(): Promise<void> {
    // Abre o seletor de regiões em vez de gerar direto
    this.openRegionSelector();
  }
}
