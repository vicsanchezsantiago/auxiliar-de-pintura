
import { Injectable, signal, computed } from '@angular/core';
import { Paint, Thinner, Varnish, FullInventory, Wash } from '../types/inventory.types';

@Injectable({
  providedIn: 'root',
})
export class InventoryService {
  private readonly INVENTORY_KEY = 'miniature-inventory';

  paints = signal<Paint[]>([]);
  thinners = signal<Thinner[]>([]);
  varnishes = signal<Varnish[]>([]);
  washes = signal<Wash[]>([]);

  fullInventory = computed<FullInventory>(() => ({
    paints: this.paints(),
    thinners: this.thinners(),
    varnishes: this.varnishes(),
    washes: this.washes()
  }));

  constructor() {
    this.loadInventory();
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private saveInventory(): void {
    const inventory: FullInventory = {
      paints: this.paints(),
      thinners: this.thinners(),
      varnishes: this.varnishes(),
      washes: this.washes(),
    };
    localStorage.setItem(this.INVENTORY_KEY, JSON.stringify(inventory));
  }

  private loadInventory(): void {
    const savedInventory = localStorage.getItem(this.INVENTORY_KEY);
    if (savedInventory) {
      const inventory: FullInventory = JSON.parse(savedInventory);
      this.paints.set(inventory.paints || []);
      this.thinners.set(inventory.thinners || []);
      this.varnishes.set(inventory.varnishes || []);
      this.washes.set(inventory.washes || []);
    }
  }

  addPaint(paint: Omit<Paint, 'id'>): void {
    const existing = this.paints().find(p =>
      p.brand.trim().toLowerCase() === paint.brand.trim().toLowerCase() &&
      p.name.trim().toLowerCase() === paint.name.trim().toLowerCase()
    );
    if (!existing) {
      this.paints.update(paints => [...paints, { ...paint, id: this.generateId() }]);
      this.saveInventory();
    }
  }

  updatePaint(updatedPaint: Paint): void {
    this.paints.update(paints => {
      const index = paints.findIndex(p => p.id === updatedPaint.id);
      if (index !== -1) {
        const newPaints = [...paints];
        newPaints[index] = updatedPaint;
        return newPaints;
      }
      return paints;
    });
    this.saveInventory();
  }

  removePaint(id: string): void {
    this.paints.update(paints => paints.filter(p => p.id !== id));
    this.saveInventory();
  }

  addThinner(thinner: Omit<Thinner, 'id'>): void {
    const existing = this.thinners().find(t =>
      t.brand.trim().toLowerCase() === thinner.brand.trim().toLowerCase() &&
      t.composition.trim().toLowerCase() === thinner.composition.trim().toLowerCase()
    );
    if (!existing) {
      this.thinners.update(thinners => [...thinners, { ...thinner, id: this.generateId() }]);
      this.saveInventory();
    }
  }

  removeThinner(id: string): void {
    this.thinners.update(thinners => thinners.filter(t => t.id !== id));
    this.saveInventory();
  }

  addVarnish(varnish: Omit<Varnish, 'id'>): void {
    const existing = this.varnishes().find(v =>
      v.brand.trim().toLowerCase() === varnish.brand.trim().toLowerCase() &&
      v.finish.trim().toLowerCase() === varnish.finish.trim().toLowerCase()
    );
    if (!existing) {
      this.varnishes.update(varnishes => [...varnishes, { ...varnish, id: this.generateId() }]);
      this.saveInventory();
    }
  }

  removeVarnish(id: string): void {
    this.varnishes.update(varnishes => varnishes.filter(v => v.id !== id));
    this.saveInventory();
  }

  addWash(wash: Omit<Wash, 'id'>): void {
    const existing = this.washes().find(w =>
      w.brand.trim().toLowerCase() === wash.brand.trim().toLowerCase() &&
      w.composition.trim().toLowerCase() === wash.composition.trim().toLowerCase()
    );
    if (!existing) {
      this.washes.update(washes => [...washes, { ...wash, id: this.generateId() }]);
      this.saveInventory();
    }
  }

  removeWash(id: string): void {
    this.washes.update(washes => washes.filter(w => w.id !== id));
    this.saveInventory();
  }
}
