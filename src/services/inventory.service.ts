
import { Injectable, signal, computed } from '@angular/core';
import { Paint, Thinner, Varnish, FullInventory, Wash, Brush, Airbrush, Tool } from '../types/inventory.types';

@Injectable({
  providedIn: 'root',
})
export class InventoryService {
  private readonly INVENTORY_KEY = 'miniature-inventory';

  paints = signal<Paint[]>([]);
  thinners = signal<Thinner[]>([]);
  varnishes = signal<Varnish[]>([]);
  washes = signal<Wash[]>([]);
  brushes = signal<Brush[]>([]);
  airbrushes = signal<Airbrush[]>([]);
  tools = signal<Tool[]>([]);

  fullInventory = computed<FullInventory>(() => ({
    paints: this.paints(),
    thinners: this.thinners(),
    varnishes: this.varnishes(),
    washes: this.washes(),
    brushes: this.brushes(),
    airbrushes: this.airbrushes(),
    tools: this.tools()
  }));

  constructor() {
    this.loadInventory();
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private saveInventory(): void {
    const inventory: FullInventory = this.fullInventory();
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
      this.brushes.set(inventory.brushes || []);
      this.airbrushes.set(inventory.airbrushes || []);
      this.tools.set(inventory.tools || []);
    }
  }

  // PAINTS
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

  // THINNERS
  addThinner(thinner: Omit<Thinner, 'id'>): void {
    this.thinners.update(thinners => [...thinners, { ...thinner, id: this.generateId() }]);
    this.saveInventory();
  }

  removeThinner(id: string): void {
    this.thinners.update(thinners => thinners.filter(t => t.id !== id));
    this.saveInventory();
  }

  // VARNISHES
  addVarnish(varnish: Omit<Varnish, 'id'>): void {
    this.varnishes.update(varnishes => [...varnishes, { ...varnish, id: this.generateId() }]);
    this.saveInventory();
  }

  removeVarnish(id: string): void {
    this.varnishes.update(varnishes => varnishes.filter(v => v.id !== id));
    this.saveInventory();
  }

  // WASHES
  addWash(wash: Omit<Wash, 'id'>): void {
    this.washes.update(washes => [...washes, { ...wash, id: this.generateId() }]);
    this.saveInventory();
  }

  removeWash(id: string): void {
    this.washes.update(washes => washes.filter(w => w.id !== id));
    this.saveInventory();
  }

  // BRUSHES
  addBrush(brush: Omit<Brush, 'id'>): void {
    this.brushes.update(brushes => [...brushes, { ...brush, id: this.generateId() }]);
    this.saveInventory();
  }

  removeBrush(id: string): void {
    this.brushes.update(brushes => brushes.filter(b => b.id !== id));
    this.saveInventory();
  }

  // AIRBRUSHES
  addAirbrush(airbrush: Omit<Airbrush, 'id'>): void {
    this.airbrushes.update(airbrushes => [...airbrushes, { ...airbrush, id: this.generateId() }]);
    this.saveInventory();
  }

  removeAirbrush(id: string): void {
    this.airbrushes.update(airbrushes => airbrushes.filter(a => a.id !== id));
    this.saveInventory();
  }

  // TOOLS
  addTool(tool: Omit<Tool, 'id'>): void {
    this.tools.update(tools => [...tools, { ...tool, id: this.generateId() }]);
    this.saveInventory();
  }

  removeTool(id: string): void {
    this.tools.update(tools => tools.filter(t => t.id !== id));
    this.saveInventory();
  }
}
