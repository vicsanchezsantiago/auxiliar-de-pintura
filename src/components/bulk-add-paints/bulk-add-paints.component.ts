
import { Component, ChangeDetectionStrategy, inject, signal, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InventoryService } from '../../services/inventory.service';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-bulk-add-paints',
  templateUrl: './bulk-add-paints.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule],
})
export class BulkAddPaintsComponent {
  inventoryService = inject(InventoryService);
  geminiService = inject(GeminiService);

  @Output() close = new EventEmitter<void>();

  inventoryList = signal('');
  brandName = signal('');
  isProcessing = signal(false);
  processedCount = signal(0);
  totalCount = signal(0);
  currentItem = signal('');

  async processBulkList() {
    if (!this.inventoryList()) {
      alert('Por favor, insira a lista de itens.');
      return;
    }

    this.isProcessing.set(true);
    this.currentItem.set('Analisando a lista com IA...');

    try {
      const parsedInventory = await this.geminiService.parseBulkInventory(
        this.inventoryList(),
        this.brandName()
      );

      if (!parsedInventory) {
        alert('A IA retornou uma resposta vazia. Verifique o formato da sua lista ou tente novamente.');
        this.isProcessing.set(false);
        return;
      }
      
      const { paints = [], thinners = [], varnishes = [], washes = [] } = parsedInventory;
      this.totalCount.set(paints.length + thinners.length + varnishes.length + washes.length);
      this.processedCount.set(0);

      for (const paint of paints) {
        this.currentItem.set(`Adicionando tinta: ${paint.brand} ${paint.name}`);
        this.inventoryService.addPaint(paint);
        this.processedCount.update(n => n + 1);
      }
      for (const thinner of thinners) {
        this.currentItem.set(`Adicionando diluente: ${thinner.brand}`);
        this.inventoryService.addThinner(thinner);
        this.processedCount.update(n => n + 1);
      }
      for (const varnish of varnishes) {
        this.currentItem.set(`Adicionando verniz: ${varnish.brand}`);
        this.inventoryService.addVarnish(varnish);
        this.processedCount.update(n => n + 1);
      }
      for (const wash of washes) {
        this.currentItem.set(`Adicionando wash: ${wash.brand} ${wash.composition}`);
        this.inventoryService.addWash(wash);
        this.processedCount.update(n => n + 1);
      }
      
      this.isProcessing.set(false);
      this.close.emit();
    } catch (error: any) {
      alert(error.message);
      this.isProcessing.set(false);
    }
  }

  cancel() {
    this.close.emit();
  }
}
