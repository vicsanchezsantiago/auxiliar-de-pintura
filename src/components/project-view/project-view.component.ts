
import { Component, ChangeDetectionStrategy, Input, signal, AfterViewInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProjectPlan } from '../../types/inventory.types';

@Component({
  selector: 'app-project-view',
  templateUrl: './project-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
})
export class ProjectViewComponent implements AfterViewInit {
  @Input() projectPlan: ProjectPlan | null = null;
  carouselIndices = signal<{[key: number]: number}>({});

  @ViewChildren('regionCanvas') private regionCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  private image: HTMLImageElement | null = null;
  private isImageLoaded = false;
  private pendingDraw = false;

  ngAfterViewInit(): void {
    // Defer initial drawing until the view is stable
    Promise.resolve().then(() => {
        this.loadImageAndDrawCanvases();
    });

    this.regionCanvases.changes.subscribe(() => {
        this.pendingDraw = true;
        // Defer drawing on changes as well
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

  private drawRegion(canvas: HTMLCanvasElement, image: HTMLImageElement, region: {x: number, y: number, width: number, height: number}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const sx = image.naturalWidth * region.x;
    const sy = image.naturalHeight * region.y;
    const sWidth = image.naturalWidth * region.width;
    const sHeight = image.naturalHeight * region.height;

    if (sWidth <= 0 || sHeight <= 0) return;

    const aspectRatio = sWidth / sHeight;
    canvas.width = canvas.parentElement?.getBoundingClientRect().width || 200;
    canvas.height = canvas.width / aspectRatio;

    ctx.drawImage(image, sx, sy, sWidth, sHeight, 0, 0, canvas.width, canvas.height);
  }

  nextImage(stepNumber: number, total: number): void {
    const currentIndex = this.carouselIndices()[stepNumber] || 0;
    const nextIndex = (currentIndex + 1) % total;
    this.carouselIndices.update(indices => ({ ...indices, [stepNumber]: nextIndex }));
  }

  prevImage(stepNumber: number, total: number): void {
    const currentIndex = this.carouselIndices()[stepNumber] || 0;
    const prevIndex = (currentIndex - 1 + total) % total;
    this.carouselIndices.update(indices => ({ ...indices, [stepNumber]: prevIndex }));
  }

  printPlan(): void {
    window.print();
  }
}
