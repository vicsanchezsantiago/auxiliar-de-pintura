
import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { GeminiService } from '../../services/gemini.service';
import { Paint, Thinner, Varnish, Wash } from '../../types/inventory.types';
import { BulkAddPaintsComponent } from '../bulk-add-paints/bulk-add-paints.component';

type ActiveTab = 'paints' | 'thinners' | 'varnishes' | 'washes';

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
  
  activeTab = signal<ActiveTab>('paints');
  isFetchingHex = signal(false);
  updatingPaintId = signal<string | null>(null);
  showBulkAddModal = signal(false);
  
  newPaint = signal<Omit<Paint, 'id'>>({ type: 'Acrylic', brand: '', name: '', hex: '#ffffff' });
  newThinner = signal<Omit<Thinner, 'id'>>({ brand: '', composition: 'Original' });
  newVarnish = signal<Omit<Varnish, 'id'>>({ brand: '', finish: 'Fosco' });
  newWash = signal<Omit<Wash, 'id'>>({ brand: '', composition: '' });

  uniqueBrands = computed(() => {
    const brands = this.inventoryService.paints().map(p => p.brand);
    return [...new Set(brands)];
  });

  setActiveTab(tab: ActiveTab) {
    this.activeTab.set(tab);
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
    try {
      const hex = await this.geminiService.getHexForPaint(brand, name);
      if (hex) {
        this.newPaint.update(p => ({ ...p, hex }));
      } else {
        alert('Não foi possível encontrar o código hexadecimal para esta tinta. Por favor, insira manualmente.');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      this.isFetchingHex.set(false);
    }
  }

  async updateHexCode(paint: Paint) {
    this.updatingPaintId.set(paint.id);
    try {
      const hex = await this.geminiService.getHexForPaint(paint.brand, paint.name);
      if (hex) {
        this.inventoryService.updatePaint({ ...paint, hex });
      } else {
        alert('Não foi possível encontrar o código hexadecimal para esta tinta.');
      }
    } catch (error: any) {
      alert(error.message);
    } finally {
      this.updatingPaintId.set(null);
    }
  }

  addThinner() {
    if (this.newThinner().brand) {
      this.inventoryService.addThinner(this.newThinner());
      this.newThinner.set({ brand: '', composition: 'Original' });
    }
  }

  addVarnish() {
    if (this.newVarnish().brand) {
      this.inventoryService.addVarnish(this.newVarnish());
      this.newVarnish.set({ brand: '', finish: 'Fosco' });
    }
  }

  addWash() {
    if (this.newWash().brand && this.newWash().composition) {
      this.inventoryService.addWash(this.newWash());
      this.newWash.set({ brand: '', composition: '' });
    }
  }
}
