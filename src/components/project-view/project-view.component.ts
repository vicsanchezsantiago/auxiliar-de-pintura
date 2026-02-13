import { Component, ChangeDetectionStrategy, Input, signal, AfterViewInit, ViewChildren, ViewChild, QueryList, ElementRef, ChangeDetectorRef, inject, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectPlan } from '../../types/inventory.types';
import { RegionSelectorComponent, RegionItem, RegionRect } from '../region-selector/region-selector.component';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-project-view',
  templateUrl: './project-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, RegionSelectorComponent],
})
export class ProjectViewComponent implements AfterViewInit {
  @Input() projectPlan: ProjectPlan | null = null;
  @Output() projectUpdated = new EventEmitter<ProjectPlan>();
  
  carouselIndices = signal<{[key: number]: number}>({});
  showRegionSelector = signal(false);
  isRegenerating = signal(false);

  @ViewChildren('regionCanvas') private regionCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;
  @ViewChild(RegionSelectorComponent) regionSelector?: RegionSelectorComponent;
  
  private cdr = inject(ChangeDetectorRef);
  private geminiService = inject(GeminiService);

  private image: HTMLImageElement | null = null;
  private isImageLoaded = false;
  private pendingDraw = false;

  ngAfterViewInit(): void {
    Promise.resolve().then(() => {
      this.loadImageAndDrawCanvases();
    });

    this.regionCanvases.changes.subscribe(() => {
      this.pendingDraw = true;
      Promise.resolve().then(() => {
        if (this.pendingDraw) {
          this.loadImageAndDrawCanvases();
          this.pendingDraw = false;
        }
      });
    });
  }

  private loadImageAndDrawCanvases() {
    const plan = this.projectPlan;
    if (plan?.referenceImage && !this.image) {
      this.image = new Image();
      this.image.onload = () => {
        this.isImageLoaded = true;
        this.drawAllCanvases();
      };
      this.image.src = `data:${plan.referenceImage.type};base64,${plan.referenceImage.data}`;
    } else if (this.isImageLoaded) {
      this.drawAllCanvases();
    }
  }

  private drawAllCanvases() {
    if (!this.image || !this.isImageLoaded || !this.regionCanvases) return;
    
    this.regionCanvases.forEach(canvasRef => {
      const canvas = canvasRef.nativeElement;
      const stepNumber = parseInt(canvas.dataset['step'] || '0', 10);
      const regionIndex = parseInt(canvas.dataset['region'] || '0', 10);
      
      const step = this.projectPlan?.steps.find(s => s.stepNumber === stepNumber);
      if (step?.imageRegions) {
        const region = step.imageRegions[regionIndex];
        if (region) {
          this.drawRegion(canvas, this.image!, region);
        }
      }
    });
  }

  private drawCanvasForStep(stepNumber: number) {
    if (!this.image || !this.isImageLoaded || !this.regionCanvases) return;
    
    const regionIndex = this.carouselIndices()[stepNumber] || 0;
    const canvas = this.regionCanvases.find(c => {
      const el = c.nativeElement;
      return parseInt(el.dataset['step'] || '0', 10) === stepNumber;
    });
    
    if (!canvas) return;
    
    const step = this.projectPlan?.steps.find(s => s.stepNumber === stepNumber);
    if (step?.imageRegions) {
      const region = step.imageRegions[regionIndex];
      if (region) {
        canvas.nativeElement.dataset['region'] = String(regionIndex);
        this.drawRegion(canvas.nativeElement, this.image!, region);
      }
    }
  }

  private drawRegion(canvas: HTMLCanvasElement, image: HTMLImageElement, region: {x: number, y: number, width: number, height: number}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const padding = 0.15;
    const padX = region.width * padding;
    const padY = region.height * padding;

    const adjX = Math.max(0, region.x - padX);
    const adjY = Math.max(0, region.y - padY);
    const adjW = Math.min(1 - adjX, region.width + padX * 2);
    const adjH = Math.min(1 - adjY, region.height + padY * 2);

    const sx = image.naturalWidth * adjX;
    const sy = image.naturalHeight * adjY;
    const sWidth = image.naturalWidth * adjW;
    const sHeight = image.naturalHeight * adjH;

    if (sWidth <= 0 || sHeight <= 0) return;

    const canvasSize = 192;
    canvas.width = canvasSize;
    canvas.height = canvasSize;

    ctx.fillStyle = '#1f2937';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    const aspectRatio = sWidth / sHeight;
    let drawWidth, drawHeight, drawX, drawY;

    if (aspectRatio > 1) {
      drawWidth = canvasSize;
      drawHeight = canvasSize / aspectRatio;
      drawX = 0;
      drawY = (canvasSize - drawHeight) / 2;
    } else {
      drawHeight = canvasSize;
      drawWidth = canvasSize * aspectRatio;
      drawX = (canvasSize - drawWidth) / 2;
      drawY = 0;
    }

    ctx.drawImage(image, sx, sy, sWidth, sHeight, drawX, drawY, drawWidth, drawHeight);
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.strokeRect(drawX, drawY, drawWidth, drawHeight);
  }

  changeImage(stepNumber: number, total: number, delta: number): void {
    const currentIndex = this.carouselIndices()[stepNumber] || 0;
    const newIndex = ((currentIndex + delta) % total + total) % total;
    this.carouselIndices.update(indices => ({ ...indices, [stepNumber]: newIndex }));
    this.cdr.detectChanges();
    setTimeout(() => this.drawCanvasForStep(stepNumber), 0);
  }

  printPlan(): void {
    window.print();
  }

  // --- Region selector para projeto já gerado ---
  openRegionSelector(): void {
    this.showRegionSelector.set(true);
    this.cdr.detectChanges();
  }

  async onIdentifyParts(): Promise<void> {
    if (!this.projectPlan?.referenceImage) return;
    
    try {
      const parts = await this.geminiService.identifyPartsInImage(
        this.projectPlan.projectName,
        this.projectPlan.source,
        this.projectPlan.referenceImage.data,
        this.projectPlan.referenceImage.type
      );
      
      if (this.regionSelector) {
        this.regionSelector.setPartsFromAI(parts);
      }
    } catch (error: any) {
      if (this.regionSelector) {
        this.regionSelector.setAIError('Erro: ' + (error.message || 'Erro desconhecido'));
      }
    }
  }

  async onRegionsConfirmed(regions: RegionItem[]): Promise<void> {
    if (!this.projectPlan) return;
    
    this.showRegionSelector.set(false);
    this.isRegenerating.set(true);
    this.cdr.detectChanges();

    try {
      const newPlan = await this.geminiService.generateProjectPlanWithRegions(
        this.projectPlan.projectName,
        this.projectPlan.source,
        this.projectPlan.referenceImage!.data,
        this.projectPlan.referenceImage!.type,
        regions
      );

      if (newPlan) {
        this.projectPlan = newPlan;
        this.projectUpdated.emit(newPlan);
        // Resetar imagem para forçar redesenho
        this.image = null;
        this.isImageLoaded = false;
        this.carouselIndices.set({});
        this.cdr.detectChanges();
        setTimeout(() => this.loadImageAndDrawCanvases(), 100);
      }
    } catch (error: any) {
      console.error('[ProjectView] Erro ao regenerar:', error);
      alert('Erro ao regenerar projeto: ' + (error.message || 'Erro desconhecido'));
    } finally {
      this.isRegenerating.set(false);
      this.cdr.detectChanges();
    }
  }

  onRegionsCancelled(): void {
    this.showRegionSelector.set(false);
    this.cdr.detectChanges();
  }

  getExistingRegions(): RegionItem[] {
    if (!this.projectPlan?.steps) return [];
    return this.projectPlan.steps
      .filter(s => s.partName && s.partName !== 'Verniz Protetor' && s.partName !== 'Verniz e Acabamento' && s.partName !== 'Verniz')
      .map(s => {
        const regions: RegionRect[] = (s.imageRegions || []).map(r => ({
          x: r.x, y: r.y, width: r.width, height: r.height
        }));
        return {
          partName: s.partName,
          region: regions.length > 0 ? regions[0] : null,
          regions,
          confirmed: regions.length > 0
        };
      });
  }

  getPurposeLabel(purpose: string): string {
    const map: Record<string, string> = {
      'base': 'Base',
      'sombra': 'Sombra',
      'luz': 'Luz',
      'highlight': 'Luz',
      'wash': 'Wash',
      'glaze': 'Glaze',
    };
    return map[purpose?.toLowerCase()] || purpose || 'Base';
  }

  getTechniqueLabel(technique: string): string {
    const map: Record<string, string> = {
      'basecoat': 'Basecoat (Cobertura)',
      'layering': 'Layering (Camadas)',
      'washing': 'Washing (Lavagem)',
      'drybrushing': 'Drybrushing (Pincel Seco)',
      'edge highlight': 'Edge Highlight (Realce)',
      'glazing': 'Glazing (Veladura)',
    };
    return map[technique?.toLowerCase()] || technique || 'Basecoat';
  }
}
