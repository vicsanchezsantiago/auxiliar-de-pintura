
import { Component, ChangeDetectionStrategy, inject, signal, computed, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { GeminiService } from '../../services/gemini.service';
import { Paint, Thinner, Varnish, Wash, Brush, Airbrush, Tool } from '../../types/inventory.types';
import { BulkAddPaintsComponent } from '../bulk-add-paints/bulk-add-paints.component';

type ActiveTab = 'paints' | 'thinners' | 'varnishes' | 'washes' | 'brushes' | 'airbrushes' | 'tools';

@Component({
  selector: 'app-inventory',
  templateUrl: './inventory.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, BulkAddPaintsComponent],
})
export class InventoryComponent {
  inventoryService = inject(InventoryService);
  geminiService = inject(GeminiService);
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);
  
  activeTab = signal<ActiveTab>('paints');
  isFetchingHex = signal(false);
  updatingPaintId = signal<string | null>(null);
  showBulkAddModal = signal(false);
  
  newPaint = signal<Omit<Paint, 'id'>>({ type: 'Acrylic', brand: '', name: '', hex: '#ffffff' });
  newThinner = signal<Omit<Thinner, 'id'>>({ brand: '', composition: 'Original' });
  newVarnish = signal<Omit<Varnish, 'id'>>({ brand: '', finish: 'Fosco' });
  newWash = signal<Omit<Wash, 'id'>>({ brand: '', composition: '' });
  newBrush = signal<Omit<Brush, 'id'>>({ brand: '', series: '', size: '', type: 'Redondo' });
  newAirbrush = signal<Omit<Airbrush, 'id'>>({ brand: '', model: '', nozzleSize: 0.3, type: 'Gravidade' });
  newTool = signal<Omit<Tool, 'id'>>({ name: '', brand: '', category: 'Corte' });

  uniqueBrands = computed(() => {
    const brands = this.inventoryService.paints().map(p => p.brand);
    return [...new Set(brands)];
  });

  setActiveTab(tab: ActiveTab) {
    this.activeTab.set(tab);
  }

  updatePaintField(field: keyof Omit<Paint, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.newPaint.update(p => ({ ...p, [field]: value }));
    this.cdr.detectChanges();
  }

  addPaint() {
    if (this.newPaint().brand && this.newPaint().name) {
      this.inventoryService.addPaint(this.newPaint());
      this.newPaint.set({ type: 'Acrylic', brand: '', name: '', hex: '#ffffff' });
    }
  }

  async findHexCode() {
    const brand = this.newPaint().brand;
    const name = this.newPaint().name;
    if (!brand || !name) {
      alert('Por favor, insira a marca e o nome da tinta.');
      return;
    }
    this.isFetchingHex.set(true);
    this.cdr.detectChanges();
    console.log('[findHexCode] Iniciando busca para:', brand, name);
    
    try {
      const hex = await this.geminiService.getHexForPaint(brand, name);
      console.log('[findHexCode] Hex recebido:', hex);
      
      this.ngZone.run(() => {
        if (hex) {
          this.newPaint.update(p => ({ ...p, hex }));
          console.log('[findHexCode] Paint atualizado com hex:', this.newPaint());
        } else {
          alert('Não foi possível encontrar o código hexadecimal para esta tinta. Por favor, insira manualmente.');
        }
        this.isFetchingHex.set(false);
        this.cdr.detectChanges();
        console.log('[findHexCode] Finalizado, isFetchingHex:', this.isFetchingHex());
      });
    } catch (error: any) {
      console.error('[findHexCode] Erro:', error);
      this.ngZone.run(() => {
        alert(error.message);
        this.isFetchingHex.set(false);
        this.cdr.detectChanges();
      });
    }
  }

  async updateHexCode(paint: Paint) {
    this.updatingPaintId.set(paint.id);
    this.cdr.detectChanges();
    try {
      const hex = await this.geminiService.getHexForPaint(paint.brand, paint.name);
      this.ngZone.run(() => {
        if (hex) {
          this.inventoryService.updatePaint({ ...paint, hex });
        } else {
          alert('Não foi possível encontrar o código hexadecimal para esta tinta.');
        }
        this.updatingPaintId.set(null);
        this.cdr.detectChanges();
      });
    } catch (error: any) {
      this.ngZone.run(() => {
        alert(error.message);
        this.updatingPaintId.set(null);
        this.cdr.detectChanges();
      });
    }
  }

  addThinner() {
    if (this.newThinner().brand) {
      this.inventoryService.addThinner(this.newThinner());
      this.newThinner.set({ brand: '', composition: 'Original' });
    }
  }

  updateThinnerField(field: keyof Omit<Thinner, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.newThinner.update(t => ({ ...t, [field]: value }));
  }

  addVarnish() {
    if (this.newVarnish().brand) {
      this.inventoryService.addVarnish(this.newVarnish());
      this.newVarnish.set({ brand: '', finish: 'Fosco' });
    }
  }

  updateVarnishField(field: keyof Omit<Varnish, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.newVarnish.update(v => ({ ...v, [field]: value }));
  }

  addWash() {
    if (this.newWash().brand && this.newWash().composition) {
      this.inventoryService.addWash(this.newWash());
      this.newWash.set({ brand: '', composition: '' });
    }
  }

  updateWashField(field: keyof Omit<Wash, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.newWash.update(w => ({ ...w, [field]: value }));
  }

  // === Pincéis ===
  addBrush() {
    if (this.newBrush().brand && this.newBrush().size) {
      this.inventoryService.addBrush(this.newBrush());
      this.newBrush.set({ brand: '', series: '', size: '', type: 'Redondo' });
    }
  }

  updateBrushField(field: keyof Omit<Brush, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.newBrush.update(b => ({ ...b, [field]: value }));
  }

  // === Aerógrafos ===
  addAirbrush() {
    if (this.newAirbrush().brand && this.newAirbrush().model) {
      this.inventoryService.addAirbrush(this.newAirbrush());
      this.newAirbrush.set({ brand: '', model: '', nozzleSize: 0.3, type: 'Gravidade' });
    }
  }

  updateAirbrushField(field: keyof Omit<Airbrush, 'id'>, event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    const value = field === 'nozzleSize' ? parseFloat(target.value) : target.value;
    this.newAirbrush.update(a => ({ ...a, [field]: value }));
  }

  // === Ferramentas ===
  addTool() {
    if (this.newTool().name) {
      this.inventoryService.addTool(this.newTool());
      this.newTool.set({ name: '', brand: '', category: 'Corte' });
    }
  }

  updateToolField(field: keyof Omit<Tool, 'id'>, event: Event) {
    const value = (event.target as HTMLInputElement | HTMLSelectElement).value;
    this.newTool.update(t => ({ ...t, [field]: value }));
  }
}
