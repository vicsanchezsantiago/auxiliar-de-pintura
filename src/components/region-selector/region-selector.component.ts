import { Component, ChangeDetectionStrategy, Input, Output, EventEmitter, signal, AfterViewInit, ViewChild, ElementRef, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionItem {
  partName: string;
  region: RegionRect | null;       // Região principal (compatibilidade)
  regions: RegionRect[];           // Múltiplas regiões por parte
  confirmed: boolean;
}

@Component({
  selector: 'app-region-selector',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="fixed inset-0 bg-black bg-opacity-80 z-50 flex items-center justify-center p-4">
  <div class="bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl max-h-[95vh] flex flex-col">
    
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b border-gray-700">
      <div>
        <h2 class="text-xl font-bold text-teal-300">📐 Definir Partes da Miniatura</h2>
        <p class="text-sm text-gray-400 mt-1">
          Selecione áreas na imagem para cada parte. Múltiplas seleções são permitidas.
          <span class="text-teal-400 font-semibold">{{ confirmedCount() }}/{{ items().length }}</span> definidas.
        </p>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <button (click)="identifyPartsWithAI()"
          [disabled]="isLoadingAI()"
          class="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1.5">
          <svg *ngIf="isLoadingAI()" class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {{ isLoadingAI() ? 'Identificando...' : '🤖 Consultar IA' }}
        </button>
        <button (click)="onCancel()"
          class="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded-md transition-colors">
          Cancelar
        </button>
        <button (click)="onConfirm()"
          class="px-3 py-1.5 text-sm bg-teal-600 hover:bg-teal-700 rounded-md transition-colors disabled:opacity-50 font-semibold"
          [disabled]="items().length === 0">
          ✓ Confirmar ({{ items().length }} partes)
        </button>
      </div>
    </div>

    <!-- AI Status -->
    <div *ngIf="aiStatusMessage()" class="px-4 py-2 text-sm border-b border-gray-700"
         [ngClass]="{'text-purple-300 bg-purple-900 bg-opacity-30': !aiError(), 'text-red-300 bg-red-900 bg-opacity-30': aiError()}">
      {{ aiStatusMessage() }}
    </div>

    <div class="flex flex-1 overflow-hidden min-h-0">
      <!-- Lista de partes (esquerda) -->
      <div class="w-72 border-r border-gray-700 overflow-y-auto p-3 space-y-1 flex-shrink-0">
        
        <div *ngFor="let item of items(); let i = index"
             class="group rounded-lg cursor-pointer transition-colors text-sm border"
             [ngClass]="{
               'bg-teal-900 border-teal-500': selectedIndex() === i,
               'bg-transparent border-transparent hover:bg-gray-700': selectedIndex() !== i
             }"
             (click)="selectItem(i)">
          
          <div class="flex items-center gap-2 p-2">
            <!-- Color badge -->
            <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2"
                  [style.background-color]="getPartColor(i) + '30'"
                  [style.border-color]="getPartColor(i)"
                  [style.color]="getPartColor(i)">
              <span *ngIf="item.confirmed">✓</span>
              <span *ngIf="!item.confirmed">{{ i + 1 }}</span>
            </span>
            
            <!-- Nome editável ou label -->
            <div class="flex-1 min-w-0" *ngIf="editingIndex() !== i">
              <span class="truncate block" [ngClass]="{'text-green-300': item.confirmed, 'text-white': !item.confirmed}">
                {{ item.partName }}
              </span>
              <span *ngIf="item.regions.length > 0" class="text-gray-500 text-xs block">
                {{ item.regions.length }} {{ item.regions.length === 1 ? 'região' : 'regiões' }}
              </span>
            </div>
            
            <!-- Input de edição inline -->
            <input *ngIf="editingIndex() === i" 
              [(ngModel)]="editingName"
              (keydown.enter)="confirmEdit(i)" 
              (keydown.escape)="cancelEdit()"
              (blur)="confirmEdit(i)"
              class="flex-1 min-w-0 bg-gray-700 text-white px-2 py-0.5 rounded text-sm border border-teal-400 outline-none"
              #editInput>
            
            <!-- Botões de ação -->
            <div class="flex gap-0.5 flex-shrink-0" *ngIf="editingIndex() !== i">
              <button *ngIf="item.regions.length > 0"
                (click)="clearRegions(i, $event)" title="Limpar regiões"
                class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-yellow-400 rounded hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                ↺
              </button>
              <button (click)="startEdit(i, $event)" title="Renomear"
                class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-teal-300 rounded hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                ✏️
              </button>
              <button (click)="deleteItem(i, $event)" title="Excluir parte"
                class="w-6 h-6 flex items-center justify-center text-gray-400 hover:text-red-400 rounded hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity">
                🗑️
              </button>
            </div>
          </div>
        </div>
        
        <!-- Adicionar nova parte -->
        <div class="border-t border-gray-700 pt-3 mt-3">
          <p class="text-xs text-gray-500 uppercase tracking-wide mb-1.5">Adicionar Parte</p>
          <div class="flex gap-1">
            <input [(ngModel)]="newPartName" placeholder="Nome da parte..."
              class="flex-1 bg-gray-700 text-white px-2 py-1.5 rounded text-sm border border-gray-600 focus:border-teal-400 outline-none"
              (keydown.enter)="addNewPart()">
            <button (click)="addNewPart()" [disabled]="!newPartName"
              class="px-2.5 py-1.5 bg-teal-600 hover:bg-teal-700 rounded text-sm disabled:opacity-50 font-bold">+</button>
          </div>
        </div>
      </div>

      <!-- Canvas da imagem (direita) -->
      <div class="flex-1 flex items-center justify-center p-4 overflow-auto bg-gray-900">
        <div class="relative inline-block">
          <canvas #imageCanvas
            (mousedown)="onMouseDown($event)"
            (mousemove)="onMouseMove($event)"
            (mouseup)="onMouseUp($event)"
            (mouseleave)="onMouseUp($event)"
            class="cursor-crosshair block"
            style="image-rendering: auto; max-width: 100%; max-height: 70vh;">
          </canvas>
          <!-- Instrução sobreposta -->
          <div *ngIf="items().length > 0 && selectedIndex() < items().length"
               class="absolute bottom-3 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-80 text-white px-4 py-2 rounded-full text-sm pointer-events-none shadow-lg whitespace-nowrap">
            <span [style.color]="getPartColor(selectedIndex())">■</span>
            Desenhe uma região para "<strong>{{ items()[selectedIndex()].partName }}</strong>"
            <span *ngIf="items()[selectedIndex()].regions.length > 0" class="ml-1 text-gray-400">
              ({{ items()[selectedIndex()].regions.length }} já definida{{ items()[selectedIndex()].regions.length > 1 ? 's' : '' }})
            </span>
          </div>
          <div *ngIf="items().length === 0"
               class="absolute inset-0 flex items-center justify-center">
            <div class="bg-black bg-opacity-70 text-white px-6 py-4 rounded-xl text-center">
              <p class="text-lg mb-2">Nenhuma parte definida</p>
              <p class="text-sm text-gray-400">Use 🤖 Consultar IA ou adicione manualmente.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
  `,
})
export class RegionSelectorComponent implements AfterViewInit, OnInit {
  @Input() imageBase64!: string;
  @Input() imageType!: string;
  @Input() partNames: string[] = [];
  @Input() existingRegions: RegionItem[] = [];
  
  @Output() regionsConfirmed = new EventEmitter<RegionItem[]>();
  @Output() cancelled = new EventEmitter<void>();
  @Output() identifyParts = new EventEmitter<void>();
  
  @ViewChild('imageCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  private cdr = inject(ChangeDetectorRef);

  items = signal<RegionItem[]>([]);
  selectedIndex = signal(0);
  confirmedCount = signal(0);
  newPartName = '';
  
  // Edição inline
  editingIndex = signal<number | null>(null);
  editingName = '';
  
  // IA
  isLoadingAI = signal(false);
  aiStatusMessage = signal('');
  aiError = signal(false);

  private image: HTMLImageElement | null = null;
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private currentRect = { x: 0, y: 0, w: 0, h: 0 };
  private canvasScale = 1;

  private readonly COLORS = [
    '#14b8a6', '#f97316', '#a855f7', '#3b82f6', '#ef4444',
    '#22c55e', '#eab308', '#ec4899', '#06b6d4', '#f43f5e',
    '#8b5cf6', '#10b981', '#f59e0b', '#6366f1', '#84cc16'
  ];

  getPartColor(index: number): string {
    return this.COLORS[index % this.COLORS.length];
  }

  ngOnInit(): void {
    if (this.existingRegions && this.existingRegions.length > 0) {
      // Migrar dados antigos: se region está preenchido mas regions está vazio
      this.items.set(this.existingRegions.map(r => ({
        ...r,
        regions: r.regions && r.regions.length > 0
          ? [...r.regions]
          : r.region ? [{ ...r.region }] : []
      })));
    } else if (this.partNames && this.partNames.length > 0) {
      this.items.set(this.partNames.map(name => ({
        partName: name,
        region: null,
        regions: [],
        confirmed: false
      })));
    }
    this.updateConfirmedCount();
  }

  ngAfterViewInit(): void {
    this.loadImage();
  }

  private loadImage() {
    this.image = new Image();
    this.image.onload = () => {
      this.setupCanvas();
      this.redraw();
    };
    this.image.src = `data:${this.imageType};base64,${this.imageBase64}`;
  }

  private setupCanvas() {
    if (!this.image || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    
    const maxW = Math.min(900, window.innerWidth - 380);
    const maxH = Math.min(window.innerHeight * 0.72, 750);
    
    const imgW = this.image.naturalWidth;
    const imgH = this.image.naturalHeight;
    
    this.canvasScale = Math.min(maxW / imgW, maxH / imgH, 1);
    
    canvas.width = Math.round(imgW * this.canvasScale);
    canvas.height = Math.round(imgH * this.canvasScale);
  }

  private redraw() {
    if (!this.image || !this.canvasRef) return;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d')!;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);
    
    const items = this.items();
    const selected = this.selectedIndex();

    // Draw all regions for all items
    items.forEach((item, idx) => {
      const color = this.COLORS[idx % this.COLORS.length];
      const isSelected = idx === selected;

      for (const r of item.regions) {
        const px = r.x * canvas.width;
        const py = r.y * canvas.height;
        const pw = r.width * canvas.width;
        const ph = r.height * canvas.height;
        
        // Fill
        ctx.fillStyle = color + (isSelected ? '40' : '20');
        ctx.fillRect(px, py, pw, ph);
        
        // Border
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.setLineDash(item.confirmed ? [] : [6, 3]);
        ctx.strokeRect(px, py, pw, ph);
        ctx.setLineDash([]);
      }

      // Label on first region (or at a fixed position if no region)
      if (item.regions.length > 0) {
        const firstR = item.regions[0];
        const labelX = firstR.x * canvas.width;
        const labelBaseY = firstR.y * canvas.height;

        ctx.font = isSelected ? 'bold 13px sans-serif' : '12px sans-serif';
        const labelText = `${idx + 1}. ${item.partName}`;
        const metrics = ctx.measureText(labelText);
        const labelH = 18;
        const labelW = metrics.width + 10;
        const labelY = labelBaseY > labelH + 2 ? labelBaseY - labelH - 2 : labelBaseY;
        
        ctx.fillStyle = color;
        ctx.globalAlpha = isSelected ? 0.95 : 0.75;
        ctx.fillRect(labelX, labelY, labelW, labelH);
        ctx.globalAlpha = 1;
        
        ctx.fillStyle = '#ffffff';
        ctx.fillText(labelText, labelX + 5, labelY + 13);
      }
    });
    
    // Current drawing rect
    if (this.isDrawing && this.currentRect.w > 2 && this.currentRect.h > 2) {
      const selColor = this.COLORS[selected % this.COLORS.length];
      ctx.strokeStyle = selColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(this.currentRect.x, this.currentRect.y, this.currentRect.w, this.currentRect.h);
      ctx.setLineDash([]);
      ctx.fillStyle = selColor + '25';
      ctx.fillRect(this.currentRect.x, this.currentRect.y, this.currentRect.w, this.currentRect.h);
    }
  }

  // --- Mouse events ---
  onMouseDown(event: MouseEvent) {
    if (this.items().length === 0) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    this.startX = (event.clientX - rect.left) * scaleX;
    this.startY = (event.clientY - rect.top) * scaleY;
    this.isDrawing = true;
    this.currentRect = { x: this.startX, y: this.startY, w: 0, h: 0 };
  }

  onMouseMove(event: MouseEvent) {
    if (!this.isDrawing) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    
    this.currentRect = {
      x: Math.min(this.startX, x),
      y: Math.min(this.startY, y),
      w: Math.abs(x - this.startX),
      h: Math.abs(y - this.startY)
    };
    this.redraw();
  }

  onMouseUp(_event: MouseEvent) {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    
    const canvas = this.canvasRef.nativeElement;
    
    // Click simples (sem arrastar): checar se clicou em região existente
    if (this.currentRect.w < 8 || this.currentRect.h < 8) {
      const clickX = this.currentRect.x / canvas.width;
      const clickY = this.currentRect.y / canvas.height;
      
      // Procurar em qual item/região clicou
      const items = this.items();
      for (let i = items.length - 1; i >= 0; i--) {
        const hit = items[i].regions.some(r =>
          clickX >= r.x && clickX <= r.x + r.width &&
          clickY >= r.y && clickY <= r.y + r.height
        );
        if (hit) {
          this.selectedIndex.set(i);
          this.redraw();
          this.cdr.detectChanges();
          return;
        }
      }
      this.redraw();
      return;
    }
    
    // Desenhou uma nova região → adicionar ao item selecionado
    const newRegion: RegionRect = {
      x: Math.max(0, this.currentRect.x / canvas.width),
      y: Math.max(0, this.currentRect.y / canvas.height),
      width: Math.min(1, this.currentRect.w / canvas.width),
      height: Math.min(1, this.currentRect.h / canvas.height)
    };
    
    const items = [...this.items()];
    const idx = this.selectedIndex();
    if (idx >= 0 && idx < items.length) {
      const updatedRegions = [...items[idx].regions, newRegion];
      items[idx] = {
        ...items[idx],
        region: updatedRegions[0], // Compatibilidade: primeira região
        regions: updatedRegions,
        confirmed: true
      };
      this.items.set(items);
      this.updateConfirmedCount();
      
      // NÃO avançar auto se ainda houver possibilidade de adicionar mais regiões à mesma parte
      // Avançar só se a parte acabou de receber sua primeira região e há próximas sem região
      if (updatedRegions.length === 1) {
        const nextUnconfirmed = items.findIndex((it, i) => i > idx && !it.confirmed);
        if (nextUnconfirmed !== -1) {
          this.selectedIndex.set(nextUnconfirmed);
        }
      }
    }
    this.redraw();
    this.cdr.detectChanges();
  }

  // --- Gestão de itens ---
  selectItem(index: number) {
    this.selectedIndex.set(index);
    this.redraw();
  }

  addNewPart() {
    if (!this.newPartName.trim()) return;
    const items = [...this.items()];
    items.push({ partName: this.newPartName.trim(), region: null, regions: [], confirmed: false });
    this.items.set(items);
    this.selectedIndex.set(items.length - 1);
    this.newPartName = '';
    this.updateConfirmedCount();
    this.redraw();
    this.cdr.detectChanges();
  }

  /** Limpar todas as regiões de uma parte SEM deletar a parte */
  clearRegions(index: number, event: Event) {
    event.stopPropagation();
    const items = [...this.items()];
    items[index] = { ...items[index], region: null, regions: [], confirmed: false };
    this.items.set(items);
    this.updateConfirmedCount();
    this.redraw();
    this.cdr.detectChanges();
  }

  startEdit(index: number, event: Event) {
    event.stopPropagation();
    this.editingIndex.set(index);
    this.editingName = this.items()[index].partName;
    this.cdr.detectChanges();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('input.border-teal-400');
      if (input) input.focus();
    }, 50);
  }

  confirmEdit(index: number) {
    if (this.editingIndex() === null) return;
    const name = this.editingName.trim();
    if (name) {
      const items = [...this.items()];
      items[index] = { ...items[index], partName: name };
      this.items.set(items);
      this.redraw();
    }
    this.editingIndex.set(null);
    this.cdr.detectChanges();
  }

  cancelEdit() {
    this.editingIndex.set(null);
    this.cdr.detectChanges();
  }

  deleteItem(index: number, event: Event) {
    event.stopPropagation();
    const items = [...this.items()];
    items.splice(index, 1);
    this.items.set(items);
    if (this.selectedIndex() >= items.length) {
      this.selectedIndex.set(Math.max(0, items.length - 1));
    }
    this.updateConfirmedCount();
    this.redraw();
    this.cdr.detectChanges();
  }

  // --- IA ---
  identifyPartsWithAI() {
    this.isLoadingAI.set(true);
    this.aiStatusMessage.set('🤖 Consultando IA para identificar partes da miniatura...');
    this.aiError.set(false);
    this.cdr.detectChanges();
    this.identifyParts.emit();
  }

  /** Chamado pelo componente pai ao receber resultado da IA */
  setPartsFromAI(parts: { partName: string; region: RegionRect | null }[]) {
    this.isLoadingAI.set(false);
    
    if (!parts || parts.length === 0) {
      this.aiStatusMessage.set('A IA não conseguiu identificar partes. Adicione manualmente.');
      this.aiError.set(true);
      this.cdr.detectChanges();
      return;
    }
    
    const existingNames = new Set(this.items().map(i => i.partName.toLowerCase()));
    const newItems = [...this.items()];
    let added = 0;
    
    for (const part of parts) {
      if (!existingNames.has(part.partName.toLowerCase())) {
        const regions = part.region ? [{ ...part.region }] : [];
        newItems.push({
          partName: part.partName,
          region: part.region,
          regions,
          confirmed: regions.length > 0
        });
        existingNames.add(part.partName.toLowerCase());
        added++;
      } else {
        // Atualizar região de item existente se a IA trouxe coordenadas e o item não tem
        const existing = newItems.find(i => i.partName.toLowerCase() === part.partName.toLowerCase());
        if (existing && part.region && existing.regions.length === 0) {
          existing.regions = [{ ...part.region }];
          existing.region = part.region;
          existing.confirmed = true;
        }
      }
    }
    
    this.items.set(newItems);
    this.updateConfirmedCount();
    
    const withRegions = newItems.filter(i => i.regions.length > 0).length;
    this.aiStatusMessage.set(
      `IA identificou ${parts.length} partes (${added} novas). ` +
      `${withRegions} com regiões marcadas. Revise e ajuste.`
    );
    this.aiError.set(false);
    this.selectedIndex.set(0);
    this.redraw();
    this.cdr.detectChanges();
  }

  setAIError(message: string) {
    this.isLoadingAI.set(false);
    this.aiStatusMessage.set(message);
    this.aiError.set(true);
    this.cdr.detectChanges();
  }

  private updateConfirmedCount() {
    this.confirmedCount.set(this.items().filter(i => i.confirmed).length);
  }

  // --- Ações finais ---
  onCancel() {
    this.cancelled.emit();
  }

  onConfirm() {
    // Sincronizar region com primeira de regions para compatibilidade
    const items = this.items().map(item => ({
      ...item,
      region: item.regions.length > 0 ? item.regions[0] : null
    }));
    this.regionsConfirmed.emit(items);
  }
}
