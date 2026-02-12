
import { Component, ChangeDetectionStrategy, signal, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GeminiService } from '../../services/gemini.service';
import { ProjectPlan } from '../../types/inventory.types';

@Component({
  selector: 'app-new-project',
  templateUrl: './new-project.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class NewProjectComponent {
  geminiService = inject(GeminiService);

  projectName = signal('');
  projectSource = signal('');
  referenceImage = signal<{ file: File, base64: string, type: string } | null>(null);
  previewUrl = signal<string | null>(null);
  
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

  async generatePlan(): Promise<void> {
    if (!this.projectName() || !this.projectSource() || !this.referenceImage()) {
      alert('Por favor, preencha todos os campos e envie uma imagem de referência.');
      return;
    }

    this.generationStarted.emit('Gerando seu plano de pintura...');
    
    const { base64, type } = this.referenceImage()!;

    try {
      const plan = await this.geminiService.generateProjectPlan(
        this.projectName(),
        this.projectSource(),
        base64,
        type
      );

      if (plan) {
        this.projectGenerated.emit(plan);
      } else {
        this.generationFailed.emit('A IA não conseguiu gerar um plano com as informações fornecidas. Tente uma imagem diferente ou revise os detalhes do projeto.');
      }
    } catch (error: any) {
      this.generationFailed.emit(error.message);
    }
  }
}
