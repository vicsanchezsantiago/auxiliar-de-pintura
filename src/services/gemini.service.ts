import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FullInventory, ProjectPlan, Paint, Thinner, Varnish, Wash } from '../types/inventory.types';
import { InventoryService } from './inventory.service';
import { SettingsService } from './settings.service';

export interface ParsedInventory {
  paints: Omit<Paint, 'id'>[];
  thinners: Omit<Thinner, 'id'>[];
  varnishes: Omit<Varnish, 'id'>[];
  washes: Omit<Wash, 'id'>[];
}

interface LocalLLMResponse {
  choices: {
    message: {
      content: string;
    }
  }[];
}

@Injectable({
  providedIn: 'root',
})
export class GeminiService {
  private ai: any = null;
  private inventoryService = inject(InventoryService);
  private settingsService = inject(SettingsService);
  private http = inject(HttpClient);

  constructor() {
    // Delay loading of the official SDK to runtime to avoid bundling Node-only
    // code into the browser bundle. The SDK will be dynamically imported when
    // first needed.
  }

  private handleError(error: unknown, context: string): never {
    console.error(`Error in ${context}:`, error);
    const errorString = JSON.stringify(error);

    if (errorString.includes('429') || errorString.includes('RESOURCE_EXHAUSTED')) {
        throw new Error('Você atingiu o limite de requisições da API. Por favor, aguarde um minuto e tente novamente.');
    }
    if (errorString.includes('HttpHostConnectException') || (error as any)?.status === 0) {
        throw new Error('Não foi possível conectar ao servidor de IA local. Verifique se o servidor está em execução e o endpoint está correto.');
    }
    
    throw new Error(`Ocorreu uma falha na comunicação com a IA durante a operação '${context}'.`);
  }

  private async withRetry<T>(apiCall: () => Promise<T>, context: string, maxRetries = 4, initialDelay = 5000): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await apiCall();
      } catch (error) {
        const errorString = JSON.stringify(error);
        const isRateLimitError = errorString.includes('429') || errorString.includes('RESOURCE_EXHAUSTED');

        if (isRateLimitError && retries < maxRetries) {
          retries++;
          console.warn(`Rate limit exceeded in ${context}. Retrying in ${delay}ms... (${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          this.handleError(error, context);
        }
      }
    }
  }

  async getHexForPaint(brand: string, name: string): Promise<string | null> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.getHexForPaintLocal(brand, name);
    }
    return this.getHexForPaintGemini(brand, name);
  }

  async parseBulkInventory(
    inventoryList: string, 
    brand: string = '',
    onProgress?: (current: number, total: number, item: string) => void
  ): Promise<ParsedInventory | null> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.parseBulkInventoryLocal(inventoryList, brand, onProgress);
    }
    return this.parseBulkInventoryGemini(inventoryList, brand, onProgress);
  }

  async generateProjectPlan(
    projectName: string,
    source: string,
    referenceImageBase64: string,
    imageType: string
  ): Promise<ProjectPlan | null> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.generateProjectPlanLocal(projectName, source, referenceImageBase64, imageType);
    }
    return this.generateProjectPlanGemini(projectName, source, referenceImageBase64, imageType);
  }

  // --- MÉTODOS GEMINI ---
  private async getHexForPaintGemini(brand: string, name: string): Promise<string | null> {
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    const apiCall = () => this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Provide the hex color code for the miniature paint with brand "${brand}" and name "${name}". Respond with only the hex code in "#RRGGBB" format.`,
      config: { temperature: 0 }
    });

    const response: any = await this.withRetry(apiCall, 'getHexForPaint');
    const text = (response && response.text) ? response.text.trim() : '';
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text : null;
  }

  private async parseBulkInventoryGemini(
    inventoryList: string, 
    brand: string = '',
    onProgress?: (current: number, total: number, item: string) => void
  ): Promise<ParsedInventory | null> {
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    const lines = inventoryList.split('\n').filter(l => l.trim()).length;
    if (onProgress) onProgress(0, lines, 'Enviando para Gemini API...');

    const mod = await import('@google/genai');
    const Type = (mod as any).Type;

    const schema = {
      type: Type.OBJECT,
      properties: {
        paints: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { brand: { type: Type.STRING }, name: { type: Type.STRING }, type: { type: Type.STRING, enum: ["Ink", "Acrylic", "Varnish", "Other"] }, hex: { type: Type.STRING } }, required: ["brand", "name", "type", "hex"] } },
        thinners: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { brand: { type: Type.STRING }, composition: { type: Type.STRING, enum: ["Original", "Caseiro"] } }, required: ["brand", "composition"] } },
        varnishes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { brand: { type: Type.STRING }, finish: { type: Type.STRING, enum: ["Brilhante", "Acetinado", "Fosco", "Vitral Brilhante"] } }, required: ["brand", "finish"] } },
        washes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { brand: { type: Type.STRING }, composition: { type: Type.STRING } }, required: ["brand", "composition"] } }
      },
      required: ["paints", "thinners", "varnishes", "washes"]
    };

    const brandNote = brand ? `Se for tinta, sempre use marca "${brand}".\n` : '';
    const apiCall = () => this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `${brandNote}Categorize esta lista de produtos de modelismo para inventário (linha por linha):\n${inventoryList}`,
      config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.1 }
    });

    const response: any = await this.withRetry(apiCall, 'parseBulkInventory');
    try {
      const result = JSON.parse(response.text.trim());
      if (onProgress) onProgress(lines, lines, 'Processamento concluído!');
      return result;
    } catch {
      if (onProgress) onProgress(lines, lines, 'Erro no processamento');
      return null;
    }
  }

  private async generateProjectPlanGemini(projectName: string, source: string, referenceImageBase64: string, imageType: string): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    const imagePart = { inlineData: { mimeType: imageType, data: referenceImageBase64 } };
    const textPart = { text: `Projeto: ${projectName}. Fonte: ${source}. Inventário: ${JSON.stringify(inventory)}. Analise a imagem e crie um guia de pintura em português seguindo o esquema JSON padrão.` };
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    const mod = await import('@google/genai');
    const Type = (mod as any).Type;

    const schema = {
      type: Type.OBJECT,
      properties: {
        projectName: { type: Type.STRING },
        source: { type: Type.STRING },
        warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
        paintsToUse: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { name: { type: Type.STRING }, brand: { type: Type.STRING }, hex: { type: Type.STRING } } } },
        steps: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { stepNumber: { type: Type.INTEGER }, description: { type: Type.STRING }, paintName: { type: Type.STRING }, paintMix: { type: Type.STRING }, tool: { type: Type.STRING }, brushSize: { type: Type.STRING }, dilution: { type: Type.STRING }, tips: { type: Type.STRING }, imageRegions: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, width: { type: Type.NUMBER }, height: { type: Type.NUMBER } } } } } } },
        fixationTips: { type: Type.ARRAY, items: { type: Type.STRING } }
      }
    };

    const apiCall = () => this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [textPart, imagePart] },
      config: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0.5 }
    });

    const response: any = await this.withRetry(apiCall, 'generateProjectPlan');
    try {
      const plan = JSON.parse(response.text.trim());
      return { ...plan, referenceImage: { data: referenceImageBase64, type: imageType } };
    } catch {
      return null;
    }
  }

  // --- MÉTODOS LOCAIS ---
  private async getHexForPaintLocal(brand: string, name: string): Promise<string | null> {
    // Extrair palavras-chave de cor do nome da tinta
    const prompt = `Analise o nome da tinta e retorne APENAS o código hex (#RRGGBB) da cor.
Nome: "${name}"
Marca: "${brand}"

Traduza palavras de cor para hex:
- BLACK/PRETO = #000000
- WHITE/BRANCO = #FFFFFF  
- RED/VERMELHO = #FF0000
- BLUE/AZUL = #0000FF
- GREEN/VERDE = #00FF00
- YELLOW/AMARELO = #FFFF00
- ORANGE/LARANJA = #FF8C00
- BROWN/MARROM/WOOD/MADEIRA = #8B4513
- GRAY/GREY/CINZA = #808080
- GOLD/DOURADO/GOLDEN = #FFD700
- SILVER/PRATA = #C0C0C0
- FLESH/PELE/SKIN = #FFDBAC
- RUST/FERRUGEM = #B7410E
- SEPIA = #704214
- BUFF = #F0DC82
- INDIGO = #4B0082
- LIME = #32CD32

Retorne APENAS o hex, nada mais.`;
    
    console.log('[getHexForPaintLocal] Enviando prompt para:', name);
    
    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 12
      });
      
      console.log('[getHexForPaintLocal] Resposta recebida:', JSON.stringify(response));
      
      if (!response?.choices?.[0]?.message?.content) {
        console.error('[getHexForPaintLocal] Estrutura inválida:', response);
        return null;
      }
      const text = response.choices[0].message.content.trim();
      console.log('[getHexForPaintLocal] Texto extraído:', text);
      
      // Accept 3, 4, 5, 6 digit hex codes and normalize to 6 digits
      const match = text.match(/#([0-9a-fA-F]{3,6})/);
      console.log('[getHexForPaintLocal] Match do regex:', match);
      
      if (match) {
        let hex = match[1];
        // Expand 3-digit hex to 6-digit (e.g., #FFF -> #FFFFFF)
        if (hex.length === 3) {
          hex = hex.split('').map(c => c + c).join('');
        }
        // Pad with 0 if needed (e.g., #A68A6 -> #A68A60)
        if (hex.length === 5) {
          hex = hex + '0';
        }
        const result = '#' + hex.toUpperCase();
        console.log('[getHexForPaintLocal] Hex normalizado:', result);
        return result;
      }
      console.log('[getHexForPaintLocal] Nenhum hex encontrado no texto');
      return null;
    } catch (error) {
      console.error('[getHexForPaintLocal] Erro:', error);
      return null;
    }
  }

  // Mapa de cores comum para processamento local (sem IA)
  private colorMap: { [key: string]: string } = {
    'black': '#000000', 'preto': '#000000', 'negro': '#000000',
    'white': '#FFFFFF', 'branco': '#FFFFFF',
    'red': '#FF0000', 'vermelho': '#FF0000',
    'blue': '#0000FF', 'azul': '#0000FF',
    'green': '#00FF00', 'verde': '#00FF00',
    'yellow': '#FFFF00', 'amarelo': '#FFFF00',
    'orange': '#FF8C00', 'laranja': '#FF8C00',
    'brown': '#8B4513', 'marrom': '#8B4513', 'wood': '#8B4513', 'madeira': '#8B4513',
    'gray': '#808080', 'grey': '#808080', 'cinza': '#808080',
    'gold': '#FFD700', 'dourado': '#FFD700', 'golden': '#FFD700', 'ouro': '#FFD700',
    'silver': '#C0C0C0', 'prata': '#C0C0C0',
    'flesh': '#FFDBAC', 'pele': '#FFDBAC', 'skin': '#FFDBAC', 'carne': '#FFDBAC',
    'rust': '#B7410E', 'ferrugem': '#B7410E', 'oxidado': '#B7410E',
    'sepia': '#704214',
    'buff': '#F0DC82', 'bege': '#F5F5DC',
    'indigo': '#4B0082',
    'lime': '#32CD32', 'lima': '#32CD32',
    'purple': '#800080', 'roxo': '#800080', 'violeta': '#8B00FF',
    'pink': '#FFC0CB', 'rosa': '#FFC0CB',
    'cyan': '#00FFFF', 'ciano': '#00FFFF',
    'magenta': '#FF00FF',
    'olive': '#808000', 'oliva': '#808000',
    'navy': '#000080', 'marinho': '#000080',
    'bronze': '#CD7F32',
    'copper': '#B87333', 'cobre': '#B87333',
    'tan': '#D2B48C',
    'khaki': '#C3B091', 'caqui': '#C3B091',
    'crimson': '#DC143C', 'carmesim': '#DC143C',
    'scarlet': '#FF2400', 'escarlate': '#FF2400',
    'turquoise': '#40E0D0', 'turquesa': '#40E0D0',
    'vibrante': '#0066FF',
    'matt': '#808080', 'fosco': '#808080',
    'gloss': '#FFFFFF'
  };

  // Extrair cor hex do nome localmente (sem IA)
  private extractHexFromName(name: string): string {
    const nameLower = name.toLowerCase();
    for (const [colorName, hex] of Object.entries(this.colorMap)) {
      if (nameLower.includes(colorName)) {
        return hex;
      }
    }
    // Cor padrão se não encontrar
    return '#808080';
  }

  // Categorizar item localmente baseado em palavras-chave
  private categorizeItem(line: string, brand: string): { type: string; data: any } | null {
    const lineLower = line.toLowerCase();
    const cleanName = line.replace(/\d+ml|\d+ ml|und|unid/gi, '').trim();
    
    // Verniz
    if (lineLower.includes('verniz') || lineLower.includes('varnish')) {
      let finish: 'Brilhante' | 'Acetinado' | 'Fosco' | 'Vitral Brilhante' = 'Brilhante';
      if (lineLower.includes('fosco') || lineLower.includes('matt') || lineLower.includes('matte')) {
        finish = 'Fosco';
      } else if (lineLower.includes('acetinado') || lineLower.includes('satin')) {
        finish = 'Acetinado';
      } else if (lineLower.includes('vitral')) {
        finish = 'Vitral Brilhante';
      }
      return { type: 'varnish', data: { brand, name: cleanName, finish } };
    }
    
    // Diluente
    if (lineLower.includes('diluente') || lineLower.includes('thinner')) {
      const composition = lineLower.includes('caseiro') ? 'Caseiro' : 'Original';
      return { type: 'thinner', data: { brand, name: cleanName, composition } };
    }
    
    // Wash
    if (lineLower.includes('wash') || lineLower.includes('shade')) {
      const hex = this.extractHexFromName(line);
      return { type: 'wash', data: { brand, name: cleanName, hex, composition: cleanName } };
    }
    
    // Tinta (padrão) - Acrylic ou Ink
    const paintType = lineLower.includes('ink') ? 'Ink' : 'Acrylic';
    const hex = this.extractHexFromName(line);
    return { type: 'paint', data: { brand, name: cleanName, type: paintType, hex } };
  }

  private async parseBulkInventoryLocal(
    inventoryList: string, 
    brand: string = '',
    onProgress?: (current: number, total: number, item: string) => void
  ): Promise<ParsedInventory | null> {
    // Separar linhas que começam com hífen ou qualquer linha
    const lines = inventoryList
      .split('\n')
      .map(l => l.trim().replace(/^-+\s*/, ''))
      .filter(l => l && l.length > 2);
    
    console.log('[parseBulkInventoryLocal] Linhas a processar:', lines.length);
    
    const result: ParsedInventory = { paints: [], thinners: [], varnishes: [], washes: [] };
    const usedBrand = brand || 'Desconhecida';
    
    // Processar cada item LOCALMENTE (sem IA) para velocidade
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (onProgress) {
        onProgress(i + 1, lines.length, `Processando: ${line.substring(0, 40)}...`);
      }
      
      const categorized = this.categorizeItem(line, usedBrand);
      
      if (categorized) {
        switch (categorized.type) {
          case 'paint':
            result.paints.push(categorized.data);
            break;
          case 'thinner':
            result.thinners.push(categorized.data);
            break;
          case 'varnish':
            result.varnishes.push(categorized.data);
            break;
          case 'wash':
            result.washes.push(categorized.data);
            break;
        }
      }
    }
    
    console.log('[parseBulkInventoryLocal] Resultado:', result);
    
    if (onProgress) {
      onProgress(lines.length, lines.length, 'Processamento concluído!');
    }
    
    return result.paints.length || result.thinners.length || result.varnishes.length || result.washes.length 
      ? result 
      : null;
  }

  private async generateProjectPlanLocal(projectName: string, source: string, referenceImageBase64: string, imageType: string): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    
    // Modelos locais geralmente não suportam visão, então enviamos apenas texto
    const prompt = `Você é um especialista em pintura de miniaturas. Crie um guia de pintura detalhado em JSON.

Projeto: "${projectName}"
Universo/Fonte: "${source}"

Inventário disponível (use APENAS tintas deste inventário):
${JSON.stringify(inventory.paints.map(p => ({ name: p.name, brand: p.brand, hex: p.hex })), null, 2)}

Gere um JSON com esta estrutura EXATA:
{
  "projectName": "${projectName}",
  "source": "${source}",
  "warnings": ["lista de avisos se faltar tintas importantes"],
  "paintsToUse": [{"name": "nome da tinta", "brand": "marca", "hex": "#cor"}],
  "steps": [
    {
      "stepNumber": 1,
      "description": "descrição do passo",
      "paintName": "nome da tinta a usar",
      "paintMix": "mistura se necessário ou null",
      "tool": "pincel ou aerógrafo",
      "brushSize": "tamanho do pincel",
      "dilution": "diluição recomendada",
      "tips": "dicas para este passo"
    }
  ],
  "fixationTips": ["dicas de fixação e finalização"]
}

Responda APENAS com o JSON, sem markdown ou explicações.`;

    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 2000
      });
      
      if (!response?.choices?.[0]?.message?.content) {
        console.error('Invalid response structure from local LLM:', response);
        return null;
      }
      
      const jsonContent = this.extractJson(response.choices[0].message.content);
      const plan = JSON.parse(jsonContent);
      return { ...plan, referenceImage: { data: referenceImageBase64, type: imageType } };
    } catch (error) {
      console.error('Error generating project plan from local LLM:', error);
      return null;
    }
  }

  private async postToLocalLLM<T>(payload: object): Promise<T> {
    const endpoint = this.settingsService.settings().localEndpoint;
    // Use Vite proxy for local LLM to avoid CORS issues
    // The proxy /api/llm forwards to http://127.0.0.1:1234
    // LM Studio uses /v1/chat/completions endpoint (OpenAI-compatible, not /api/v1/chat)
    const url = '/api/llm/v1/chat/completions';
    console.log('[postToLocalLLM] Enviando para:', url);
    console.log('[postToLocalLLM] Payload:', JSON.stringify(payload));
    
    try {
      const response = await firstValueFrom(this.http.post<T>(url, { model: "local-model", ...payload }));
      console.log('[postToLocalLLM] Resposta HTTP recebida');
      if (!response) {
        throw new Error('Empty response from local LLM');
      }
      return response;
    } catch (error) {
      console.error('Local LLM request failed:', error);
      throw error;
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/```json\n([\s\S]*?)\n```|({[\s\S]*})/);
    return match ? (match[1] || match[2]) : text;
  }
}