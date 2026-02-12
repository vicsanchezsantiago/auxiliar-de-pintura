
import { Component, ChangeDetectionStrategy, inject, signal, Output, EventEmitter, ChangeDetectorRef, NgZone } from '@angular/core';
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
  private cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);

  @Output() close = new EventEmitter<void>();

  inventoryList = signal('');
  brandName = signal('');
  isProcessing = signal(false);
  isSuccess = signal(false);
  processedCount = signal(0);
  totalCount = signal(0);
  currentItem = signal('');
  errorMessage = signal('');
  savedItemsCount = signal(0);

  async processBulkList() {
    if (!this.inventoryList()) {
      alert('Por favor, insira a lista de itens.');
      return;
    }

    this.isProcessing.set(true);
    this.errorMessage.set('');
    this.currentItem.set('Iniciando análise...');
    this.cdr.markForCheck();

    // Contar linhas válidas
    const lines = this.inventoryList().split('\n').map(l => l.trim()).filter(l => l && l.startsWith('-'));
    this.totalCount.set(lines.length);
    this.processedCount.set(0);
    this.cdr.markForCheck();

    try {
      // Callback para atualizar progresso (dentro da NgZone para Change Detection)
      const onProgress = (current: number, total: number, item: string) => {
        this.ngZone.run(() => {
          this.processedCount.set(current);
          this.totalCount.set(total);
          this.currentItem.set(item);
          this.cdr.markForCheck();
        });
      };

      const parsedInventory = await this.geminiService.parseBulkInventory(
        this.inventoryList(),
        this.brandName(),
        onProgress
      );

      if (!parsedInventory) {
        this.errorMessage.set('A IA não conseguiu processar a lista. Tente com menos itens ou verifique o formato.');
        this.isProcessing.set(false);
        this.cdr.markForCheck();
        return;
      }
      
      const { paints = [], thinners = [], varnishes = [], washes = [] } = parsedInventory;
      const totalItems = paints.length + thinners.length + varnishes.length + washes.length;
      
      this.currentItem.set('Salvando itens no inventário...');
      this.cdr.markForCheck();

      let savedCount = 0;
      for (const paint of paints) {
        this.inventoryService.addPaint(paint);
        savedCount++;
        this.currentItem.set(`Salvo: ${paint.name}`);
        this.cdr.markForCheck();
      }
      for (const thinner of thinners) {
        this.inventoryService.addThinner(thinner);
        savedCount++;
      }
      for (const varnish of varnishes) {
        this.inventoryService.addVarnish(varnish);
        savedCount++;
      }
      for (const wash of washes) {
        this.inventoryService.addWash(wash);
        savedCount++;
      }
      
      this.currentItem.set(`✓ ${savedCount} itens adicionados com sucesso!`);
      this.savedItemsCount.set(savedCount);
      this.isProcessing.set(false);
      this.isSuccess.set(true);
      this.cdr.markForCheck();
    } catch (error: any) {
      console.error('Erro no cadastro massivo:', error);
      this.errorMessage.set(error.message || 'Erro ao processar lista');
      this.isProcessing.set(false);
      this.cdr.markForCheck();
    }
  }

  confirmAndClose() {
    this.close.emit();
  }

  cancel() {
    this.close.emit();
  }
}
