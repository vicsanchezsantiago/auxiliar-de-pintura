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
    };
    finish_reason: string; // 'stop' = completo, 'length' = truncado
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

  /**
   * Identifica partes pintáveis na imagem de referência.
   * Retorna lista de partes com nomes em português e coordenadas de região.
   */
  async identifyPartsInImage(
    projectName: string,
    source: string,
    referenceImageBase64: string,
    imageType: string
  ): Promise<{ partName: string; region: { x: number; y: number; width: number; height: number } | null }[]> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.identifyPartsLocal(projectName, source, referenceImageBase64, imageType);
    }
    return this.identifyPartsGemini(projectName, source, referenceImageBase64, imageType);
  }

  /**
   * Gera o plano de projeto usando regiões já definidas pelo usuário.
   */
  async generateProjectPlanWithRegions(
    projectName: string,
    source: string,
    referenceImageBase64: string,
    imageType: string,
    regions: { partName: string; region: { x: number; y: number; width: number; height: number } | null; regions?: { x: number; y: number; width: number; height: number }[]; confirmed: boolean }[]
  ): Promise<ProjectPlan | null> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.generateProjectPlanLocalWithRegions(projectName, source, referenceImageBase64, imageType, regions);
    }
    return this.generateProjectPlanGeminiWithRegions(projectName, source, referenceImageBase64, imageType, regions);
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

  // Lista de modelos em ordem de prioridade
  // Nota: Usar apenas gemini-2.5-flash pois outros estão indisponíveis ou não existem
  private readonly GEMINI_MODELS = [
    'gemini-2.5-flash',       // Principal: 5 RPM, 250K TPM - ÚNICO CONFIÁVEL
  ];

  private currentModelIndex = 0;

  private getNextModel(): string {
    const model = this.GEMINI_MODELS[this.currentModelIndex];
    this.currentModelIndex = (this.currentModelIndex + 1) % this.GEMINI_MODELS.length;
    return model;
  }

  private resetModelIndex(): void {
    this.currentModelIndex = 0;
  }

  // Tenta parsear JSON mesmo se estiver truncado
  private safeJsonParse(text: string): any {
    // Primeiro tenta parse direto
    try {
      return JSON.parse(text);
    } catch (e) {
      console.log('[safeJsonParse] Parse direto falhou, tentando reparar...');
    }
    
    let fixed = text.trim();
    
    // Remover possíveis caracteres de markdown
    fixed = fixed.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    
    // Tentar parse após limpeza básica
    try {
      return JSON.parse(fixed);
    } catch {}
    
    // Se o JSON está truncado no meio de um valor string (ex: "hex": "#6)
    // Completar a string truncada
    if (fixed.match(/"[^"]*$/)) {
      fixed = fixed.replace(/"[^"]*$/, '"TRUNCATED"');
    }
    
    // Se termina com : (valor faltando)
    if (fixed.match(/:\s*$/)) {
      fixed += 'null';
    }
    
    // Remover última propriedade incompleta (após vírgula)
    fixed = fixed.replace(/,\s*"[^"]*"?\s*:?\s*("[^"]*)?$/, '');
    
    // Remover último objeto incompleto de um array
    fixed = fixed.replace(/,\s*\{[^}]*$/, '');
    
    // Contar e fechar colchetes/chaves
    const openBraces = (fixed.match(/{/g) || []).length;
    const closeBraces = (fixed.match(/}/g) || []).length;
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/]/g) || []).length;
    
    // Fechar arrays primeiro, depois objetos
    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
    
    try {
      const result = JSON.parse(fixed);
      console.log('[safeJsonParse] JSON reparado com sucesso');
      return result;
    } catch (e2) {
      console.error('[safeJsonParse] Falha ao reparar JSON:', (e2 as Error).message);
    }
    
    // Último recurso: tentar extrair array "colors" parcial
    const colorsMatch = fixed.match(/"colors"\s*:\s*\[([\s\S]*)/);
    if (colorsMatch) {
      try {
        let colorsStr = '[' + colorsMatch[1];
        // Remover último objeto incompleto
        colorsStr = colorsStr.replace(/,\s*\{[^}]*$/, '');
        if (!colorsStr.endsWith(']')) colorsStr += ']';
        
        const colors = JSON.parse(colorsStr);
        if (colors.length > 0) {
          console.log('[safeJsonParse] Extraído array colors parcial:', colors.length, 'itens');
          return { colors, totalColors: colors.length };
        }
      } catch {}
    }
    
    return null;
  }

  private async generateProjectPlanGemini(projectName: string, source: string, referenceImageBase64: string, imageType: string): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    const imagePart = { inlineData: { mimeType: imageType, data: referenceImageBase64 } };
    
    // Usar todas as tintas disponíveis
    const availablePaints = inventory.paints;
    const paintsList = availablePaints.map(p => `${p.name}|${p.brand}|${p.hex}`).join('\n');
    
    // Informações do diluente
    const thinnerInfo = inventory.thinners.length > 0 
      ? `Diluente: ${inventory.thinners[0].brand} (${inventory.thinners[0].composition})`
      : 'Diluente: água ou medium acrílico';
    
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    this.resetModelIndex();

    // Tentar com diferentes modelos
    for (let attempt = 0; attempt < this.GEMINI_MODELS.length; attempt++) {
      const model = this.GEMINI_MODELS[attempt];
      console.log(`[generateProjectPlanGemini] Tentativa ${attempt + 1}/${this.GEMINI_MODELS.length} com modelo: ${model}`);

      try {
        const result = await this.tryGenerateWithModel(model, projectName, source, imagePart, paintsList, availablePaints, thinnerInfo, referenceImageBase64, imageType);
        if (result) {
          console.log(`[generateProjectPlanGemini] Sucesso com modelo: ${model}`);
          return result;
        }
      } catch (error: any) {
        const errorStr = JSON.stringify(error);
        
        if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
          console.warn(`[generateProjectPlanGemini] Rate limit no modelo ${model}, tentando próximo...`);
          continue;
        }
        
        console.error(`[generateProjectPlanGemini] Erro com modelo ${model}:`, error);
      }
    }

    console.error('[generateProjectPlanGemini] Todos os modelos falharam');
    return null;
  }

  private async tryGenerateWithModel(
    model: string,
    projectName: string,
    source: string,
    imagePart: any,
    paintsList: string,
    availablePaints: any[],
    thinnerInfo: string,
    referenceImageBase64: string,
    imageType: string
  ): Promise<ProjectPlan | null> {
    
    // ========== FASE 1: Identificar TODAS as cores na imagem ==========
    console.log(`[FASE 1] Identificando cores com ${model}...`);
    
    const colorsPrompt = `Analise esta imagem de referência para pintura de miniatura.
Projeto: "${projectName}" (${source})

TAREFA: Identifique ABSOLUTAMENTE TODAS as cores visíveis na imagem que precisam ser pintadas.
Inclua TODA variação de cor: pele, olhos, pupilas, lábios, cabelo, sobrancelhas, cada peça de roupa/armadura de cor distinta, metais (ouro/prata/bronze), couro, madeira, pedras, base/cenário, sombras visíveis, destaques, etc.

Tintas disponíveis no inventário (nome|marca|hex):
${paintsList}

Retorne um JSON com TODAS as cores identificadas:
{
  "colors": [
    {
      "colorName": "nome descritivo da cor",
      "hex": "#RRGGBB",
      "location": "onde aparece na figura (ex: capa, olhos, botas)",
      "matchedPaint": {"name": "tinta do inventário", "brand": "marca", "hex": "#RRGGBB"} ou null,
      "needsMixing": true ou false,
      "mixRecipe": {
        "targetColor": "nome da cor alvo",
        "targetHex": "#RRGGBB",
        "components": [
          {"paint": "nome tinta do inventário", "brand": "marca", "hex": "#HEX", "ratio": 2},
          {"paint": "outra tinta do inventário", "brand": "marca", "hex": "#HEX", "ratio": 1}
        ],
        "instructions": "Misture 2 partes de X com 1 parte de Y até obter tom uniforme"
      }
    }
  ],
  "totalColors": número
}

REGRAS:
- Liste TODAS as cores distintas — mínimo 10 cores para figuras complexas
- Para cada cor, encontre a tinta mais próxima do inventário
- Se a tinta é exata ou muito próxima: matchedPaint=tinta, needsMixing=false, mixRecipe=null
- Se NÃO houver tinta exata: needsMixing=true, matchedPaint=null, e OBRIGATORIAMENTE inclua mixRecipe com componentes do inventário que misturados produzem a cor
- mixRecipe DEVE usar SOMENTE tintas da lista de inventário acima
- Ratio é número inteiro indicando proporção (ex: 2 partes de branco + 1 de vermelho)
- Seja preciso nos códigos hex`;

    const colorsResponse: any = await this.ai.models.generateContent({
      model,
      contents: { parts: [{ text: colorsPrompt }, imagePart] },
      config: { 
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 12000  // Aumentado para incluir receitas de mistura
      }
    });

    const colorsText = this.extractResponseText(colorsResponse);
    if (!colorsText) {
      console.error('[FASE 1] Sem resposta de cores');
      return null;
    }

    console.log('[FASE 1] Cores recebidas:', colorsText.length, 'chars');
    console.log('[FASE 1] Texto completo:', colorsText);
    
    const colorsData = this.safeJsonParse(colorsText.trim());
    console.log('[FASE 1] JSON parseado:', colorsData);
    
    // Verificar diferentes formatos de resposta
    let colors = colorsData?.colors || colorsData?.identifiedColors || colorsData?.data?.colors;
    
    // Se vier como array direto
    if (Array.isArray(colorsData) && colorsData.length > 0) {
      colors = colorsData;
    }
    
    if (!colors || colors.length === 0) {
      console.error('[FASE 1] Nenhuma cor identificada. Chaves encontradas:', colorsData ? Object.keys(colorsData) : 'null');
      return null;
    }
    
    // Normalizar para usar 'colors'
    const normalizedColorsData = { colors, totalColors: colors.length };

    console.log(`[FASE 1] ${normalizedColorsData.colors.length} cores identificadas`);

    // ========== FASE 2: Dividir em partes/regiões por cor ==========
    console.log(`[FASE 2] Identificando partes da figura com ${model}...`);
    
    const colorsList = normalizedColorsData.colors.map((c: any) => `${c.colorName || c.name} (${c.hex}): ${c.location || c.area || 'N/A'}`).join('\n');
    
    const partsPrompt = `Analise esta imagem de miniatura para pintura.
Projeto: "${projectName}" (${source})

Cores já identificadas na imagem:
${colorsList}

TAREFA: Liste CADA PARTE PINTÁVEL da miniatura como um item separado no array.
Cada parte da miniatura que tem uma cor diferente DEVE ser um item separado.

Exemplo: Se há pele, cabelo, capa, calça, botas, detalhes metálicos → são 6+ partes separadas.

Retorne EXATAMENTE este formato JSON com MÚLTIPLAS partes:
{
  "parts": [
    {
      "partName": "Pele (rosto, mãos)",
      "description": "Todas as áreas de pele expostas: rosto, pescoço, mãos",
      "mainColor": {"name": "Pele", "hex": "#E8BEAC"},
      "region": {"x": 0.3, "y": 0.0, "width": 0.4, "height": 0.3},
      "subParts": ["rosto", "pescoço", "mãos"]
    },
    {
      "partName": "Cabelo",
      "description": "Cabelo da personagem",
      "mainColor": {"name": "Cabelo Ruivo", "hex": "#B7410E"},
      "region": {"x": 0.3, "y": 0.0, "width": 0.4, "height": 0.2},
      "subParts": ["cabelo"]
    }
  ]
}

REGRAS OBRIGATÓRIAS:
- Crie uma parte SEPARADA para CADA cor/material diferente
- Mínimo 5 partes, máximo 15
- Separe por COR/MATERIAL: pele, cabelo, cada peça de roupa de cor diferente, metais, base/cenário
- Use coordenadas relativas 0.0 a 1.0 para a região
- Inclua TODAS as ${normalizedColorsData.colors.length} cores como partes`;

    const partsResponse: any = await this.ai.models.generateContent({
      model,
      contents: { parts: [{ text: partsPrompt }, imagePart] },
      config: { 
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 8000
      }
    });

    const partsText = this.extractResponseText(partsResponse);
    if (!partsText) {
      console.error('[FASE 2] Sem resposta de partes');
      return null;
    }

    console.log('[FASE 2] Partes recebidas:', partsText.length, 'chars');
    console.log('[FASE 2] Texto completo:', partsText);
    const partsData = this.safeJsonParse(partsText.trim());
    
    if (!partsData?.parts || partsData.parts.length === 0) {
      console.warn('[FASE 2] Nenhuma parte identificada pelo modelo, gerando a partir das cores...');
      // Gerar partes automaticamente a partir das cores identificadas
      partsData.parts = normalizedColorsData.colors.map((c: any, idx: number) => ({
        partName: c.colorName || c.name || `Parte ${idx + 1}`,
        description: c.location || 'Área a ser pintada',
        mainColor: { name: c.colorName || c.name, hex: c.hex },
        region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
        subParts: [c.location || 'elemento']
      }));
    }
    
    // Se retornou muito poucas partes comparado com as cores, forçar mais partes
    if (partsData.parts.length < 3 && normalizedColorsData.colors.length > 3) {
      console.warn(`[FASE 2] Apenas ${partsData.parts.length} partes para ${normalizedColorsData.colors.length} cores. Complementando...`);
      const existingPartNames = new Set(partsData.parts.map((p: any) => (p.mainColor?.hex || '').toLowerCase()));
      for (const color of normalizedColorsData.colors) {
        if (!existingPartNames.has((color.hex || '').toLowerCase())) {
          partsData.parts.push({
            partName: color.colorName || color.name,
            description: color.location || 'Área a ser pintada',
            mainColor: { name: color.colorName || color.name, hex: color.hex },
            region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
            subParts: [color.location || 'elemento']
          });
        }
      }
    }

    console.log(`[FASE 2] ${partsData.parts.length} partes identificadas`);

    // ========== FASE 3: Gerar passos detalhados para cada parte ==========
    console.log(`[FASE 3] Gerando passos de pintura com ${model}...`);
    
    const partsDescription = partsData.parts.map((p: any, i: number) => 
      `${i+1}. ${p.partName}: ${p.mainColor?.name || 'cor base'} - ${p.description}`
    ).join('\n');

    const stepsPrompt = `Crie um guia COMPLETO e DETALHADO de pintura para miniatura.
Projeto: "${projectName}" (${source})
${thinnerInfo}

PARTES A PINTAR - gere UM PASSO para CADA parte, mais um passo FINAL de verniz:
${partsDescription}

TINTAS DISPONÍVEIS (nome|marca|hex):
${paintsList}

Retorne JSON com ${partsData.parts.length + 1} passos (um por parte + passo final de verniz).
Cada passo DEVE ter TODOS estes campos:
{
  "steps": [
    {
      "stepNumber": 1,
      "partName": "nome da parte",
      "partDescription": "descrição detalhada do que pintar",
      "baseColor": {"name": "nome da cor base", "hex": "#RRGGBB"},
      "paintsToUse": [
        {"name": "NOME EXATO da tinta do inventário", "brand": "marca", "hex": "#HEX", "purpose": "base"},
        {"name": "OUTRA TINTA para sombra", "brand": "marca", "hex": "#HEX", "purpose": "sombra"},
        {"name": "OUTRA TINTA para highlight", "brand": "marca", "hex": "#HEX", "purpose": "highlight"}
      ],
      "paintMix": null,
      "technique": "basecoat",
      "tool": "Aerógrafo",
      "toolDetails": "PSI 15-20, agulha 0.3mm, distância 10-15cm",
      "dilution": {
        "ratio": "3:1",
        "description": "3 partes de tinta para 1 de diluente — consistência de leite",
        "thinnerNote": "Use o diluente do inventário"
      },
      "imageRegions": [{"x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5, "partName": "área"}],
      "tips": ["dica profissional 1", "dica profissional 2"],
      "warnings": []
    }
  ],
  "fixationTips": ["dica de verniz 1", "dica de proteção 2", "dica de armazenamento 3"],
  "warnings": []
}

REGRAS OBRIGATÓRIAS PARA CADA PASSO:
1. paintsToUse: SEMPRE array com 1-4 tintas do inventário, cada com purpose (base/sombra/highlight/wash/glaze)
2. dilution: SEMPRE objeto {ratio, description, thinnerNote} - NUNCA string
3. tips: SEMPRE array ["dica 1", "dica 2"] - NUNCA string
4. warnings: SEMPRE array (pode ser vazio [])
5. Use SOMENTE tintas da lista de TINTAS DISPONÍVEIS
6. paintMix: SOMENTE se precisa misturar tintas — caso contrário, OBRIGATORIAMENTE null (não {} vazio)
7. Se paintMix não é null, DEVE ter: targetColor (string), targetHex (#RRGGBB), components (array), instructions (string)
8. technique: basecoat, layering, drybrushing, washing, glazing, edge highlight, ou wet blending

REGRAS DE FERRAMENTA (tool):
- "Aerógrafo" para: primer geral, basecoat de áreas GRANDES e uniformes (roupas inteiras, capas, armaduras, pele de corpo todo, cenário), zenithal, transições suaves
- "Pincel" APENAS para: detalhes finos (olhos, lábios, jóias, símbolos), edge highlight, drybrushing, washing, glazing, pequenas áreas
- toolDetails DEVE especificar: PSI e agulha para aerógrafo, tamanho do pincel para pincel

REGRAS DE imageRegions (coordenadas 0.0 a 1.0):
- x,y = canto superior esquerdo da região NA IMAGEM DE REFERÊNCIA
- width,height = tamanho da região
- Foque na PARTE EXATA mencionada no partName (ex: se é "Olhos", a região deve cobrir apenas os olhos, não a testa)
- Seja PRECISO: região de "olhos" deve ter y mais abaixo que "cabelo", região de "botas" deve estar na parte inferior
- Use regiões menores e mais precisas em vez de grandes e genéricas

PASSO FINAL OBRIGATÓRIO - VERNIZ E ACABAMENTO:
- O ÚLTIMO passo DEVE ser aplicação de verniz
- Especifique método por PARTE: aerógrafo para verniz fosco geral, pincel para verniz brilhante em metais/olhos/gemas
- Inclua proporções de diluição do verniz (ex: "1:1 verniz e diluente para aerógrafo")
- Detalhe tempo de secagem e número de camadas

Tudo em português brasileiro`;

    const stepsResponse: any = await this.ai.models.generateContent({
      model,
      contents: { parts: [{ text: stepsPrompt }, imagePart] },
      config: { 
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 65536
      }
    });

    const finishReason = stepsResponse?.candidates?.[0]?.finishReason;
    console.log('[FASE 3] finishReason:', finishReason);

    if (finishReason === 'MAX_TOKENS') {
      console.warn('[FASE 3] ⚠️ RESPOSTA TRUNCADA - considere usar modelo com mais tokens');
    }

    const stepsText = this.extractResponseText(stepsResponse);
    if (!stepsText) {
      console.error('[FASE 3] Sem resposta de passos');
      return null;
    }

    console.log('[FASE 3] Passos recebidos:', stepsText.length, 'chars');
    console.log('[FASE 3] Texto (início):', stepsText.substring(0, 500));
    const stepsData = this.safeJsonParse(stepsText.trim());
    
    if (!stepsData?.steps || stepsData.steps.length === 0) {
      console.error('[FASE 3] Nenhum passo gerado');
      return null;
    }

    // Normalizar os passos para garantir tipos corretos
    stepsData.steps = stepsData.steps.map((step: any, idx: number) => {
      // Garantir que dilution seja objeto
      if (typeof step.dilution === 'string') {
        step.dilution = { ratio: step.dilution, description: step.dilution, thinnerNote: '' };
      } else if (!step.dilution) {
        step.dilution = { ratio: '2:1', description: '2 partes de tinta para 1 de diluente', thinnerNote: '' };
      }
      
      // Garantir que tips seja array
      if (typeof step.tips === 'string') {
        step.tips = step.tips.split(/[.,]\s*/).filter((t: string) => t.trim().length > 5);
      } else if (!Array.isArray(step.tips)) {
        step.tips = ['Aplique em camadas finas e uniformes'];
      }
      
      // Garantir que warnings seja array
      if (typeof step.warnings === 'string') {
        step.warnings = [step.warnings];
      } else if (!Array.isArray(step.warnings)) {
        step.warnings = [];
      }
      
      // Garantir que paintsToUse seja array
      if (!Array.isArray(step.paintsToUse)) {
        step.paintsToUse = [];
      }
      
      // Garantir que imageRegions seja array
      if (!Array.isArray(step.imageRegions)) {
        step.imageRegions = [];
      }
      
      // Garantir stepNumber
      step.stepNumber = step.stepNumber || idx + 1;
      
      // Garantir partName e partDescription
      step.partName = step.partName || `Passo ${idx + 1}`;
      step.partDescription = step.partDescription || step.description || '';
      
      // Garantir baseColor
      if (!step.baseColor) {
        step.baseColor = { name: step.partName, hex: '#808080' };
      }
      
      // Normalizar paintMix: se vazio ou incompleto → null
      if (step.paintMix) {
        if (!step.paintMix.targetColor || !step.paintMix.components || step.paintMix.components.length === 0) {
          step.paintMix = null;
        }
      }
      
      return step;
    });

    console.log(`[FASE 3] ${stepsData.steps.length} passos gerados (normalizados)`);

    // ========== Montar resultado final ==========
    const identifiedColors = normalizedColorsData.colors.map((c: any) => {
      const color: any = {
        colorName: c.colorName || c.name || 'Cor sem nome',
        hex: c.hex || '#888888',
        location: c.location || c.area || 'Não especificado',
        matchedPaint: c.matchedPaint || undefined,
        needsMixing: c.needsMixing || false
      };
      // Incluir receita de mistura se existir e for válida
      if (c.needsMixing && c.mixRecipe && c.mixRecipe.targetColor && c.mixRecipe.components && c.mixRecipe.components.length > 0) {
        color.mixRecipe = c.mixRecipe;
      }
      return color;
    });

    // Coletar todas as tintas usadas
    const allPaintsUsed = new Map<string, any>();
    for (const step of stepsData.steps) {
      if (step.paintsToUse) {
        for (const paint of step.paintsToUse) {
          allPaintsUsed.set(`${paint.name}-${paint.brand}`, {
            name: paint.name,
            brand: paint.brand,
            hex: paint.hex
          });
        }
      }
    }

    return {
      projectName,
      source,
      identifiedColors,
      paintsToUse: Array.from(allPaintsUsed.values()),
      requiredMixes: [],  // Receitas agora estão inline em identifiedColors.mixRecipe
      steps: stepsData.steps,
      fixationTips: stepsData.fixationTips || ['Aplique verniz fosco para proteger.', 'Deixe curar 24h.'],
      warnings: stepsData.warnings || [],
      referenceImage: { data: referenceImageBase64, type: imageType }
    };
  }

  // --- IDENTIFICAÇÃO DE PARTES ---

  private async identifyPartsGemini(
    projectName: string, source: string,
    referenceImageBase64: string, imageType: string
  ): Promise<{ partName: string; region: { x: number; y: number; width: number; height: number } | null }[]> {
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    // Usar resolução menor para identificação de partes (não precisa de alta qualidade)
    let resizedBase64 = referenceImageBase64;
    let resizedType = imageType;
    try {
      const resized = await this.resizeImageForLocalLLM(referenceImageBase64, imageType, 1024);
      resizedBase64 = resized.base64;
      resizedType = resized.type;
    } catch (e) {
      console.warn('[identifyPartsGemini] Falha ao redimensionar:', e);
    }

    const imagePart = { inlineData: { mimeType: resizedType, data: resizedBase64 } };

    const prompt = `Analise esta imagem de referência de uma miniatura/figura para pintura.
Projeto: "${projectName}" (${source})

TAREFA: Identifique TODAS as partes INDIVIDUALMENTE PINTÁVEIS visíveis na miniatura.
Cada parte com cor, material ou textura DIFERENTE deve ser uma entrada separada.

COMO IDENTIFICAR PARTES DISTINTAS:
- Cada SUPERFÍCIE com cor visivelmente diferente = parte separada
- Pele (rosto, mãos, braços expostos) → uma parte
- Cabelo → parte separada (observe COR específica: loiro, castanho, ruivo, preto, etc.)
- Olhos → parte separada (íris + pupila — são detalhes pequenos mas importantes)
- Cada peça de roupa de COR DIFERENTE → parte separada (capa, tunica, calça, etc.)
- Cada peça de armadura/metal → parte separada (peitoral, ombreira, grevas)
- Acessórios (cinto, fivelas, joias, gemas) → parte separada
- Armas (lâmina, cabo, proteção) → podem ser 1-3 partes dependendo de materiais
- Base/cenário → parte separada (pedras, grama, terreno, etc.)

REGRAS DE NOMENCLATURA:
- Nomes SEMPRE em português brasileiro
- Seja DESCRITIVO: "Capa vermelha" ao invés de apenas "Capa"
- Inclua a cor aparente no nome quando possível
- "Pele (rosto e mãos)" ao invés de apenas "Pele"

Retorne um JSON:
{
  "parts": [
    {
      "partName": "nome descritivo em português com cor aparente",
      "region": {"x": 0.0, "y": 0.0, "width": 0.5, "height": 0.3}
    }
  ]
}

REGRAS:
- Nomes SEMPRE em português brasileiro
- Mínimo 6 partes, máximo 15
- Coordenadas relativas 0.0 a 1.0 (x,y = canto superior esquerdo, width,height = tamanho)
- Seja PRECISO nas coordenadas: olhos/rosto na parte superior, botas na parte inferior, etc.
- NÃO agrupe partes de cores/materiais visivelmente diferentes
- Ordene de CIMA para BAIXO (cabeça → corpo → pés → base)`;

    const response: any = await this.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [{ text: prompt }, imagePart] },
      config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 4000 }
    });

    const text = this.extractResponseText(response);
    if (!text) return [];

    const data = this.safeJsonParse(text.trim());
    if (!data?.parts || !Array.isArray(data.parts)) return [];

    return data.parts.map((p: any) => ({
      partName: p.partName || p.name || 'Parte',
      region: p.region && typeof p.region.x === 'number' ? p.region : null
    }));
  }

  private async identifyPartsLocal(
    projectName: string, source: string,
    referenceImageBase64: string, imageType: string
  ): Promise<{ partName: string; region: { x: number; y: number; width: number; height: number } | null }[]> {
    let resizedBase64 = referenceImageBase64;
    let resizedType = imageType;
    try {
      // Resolução menor para identificação de partes — não precisa de alta qualidade
      const resized = await this.resizeImageForLocalLLM(referenceImageBase64, imageType, 1024);
      resizedBase64 = resized.base64;
      resizedType = resized.type;
    } catch (e) {
      console.warn('[identifyPartsLocal] Falha ao redimensionar:', e);
    }

    const prompt = `Analise esta imagem de miniatura/figura para pintura.
Projeto: "${projectName}" (${source})

Liste TODAS as partes individualmente pintáveis. Cada superfície com cor, material ou textura diferente é uma parte separada.

COMO SEPARAR PARTES:
- Pele (rosto, mãos) = uma parte
- Cabelo = parte separada (descreva a cor aparente)
- Olhos = parte separada (detalhe pequeno mas importante)
- Cada peça de roupa de cor diferente = parte separada
- Armadura/metal = parte separada
- Acessórios (cinto, joias, fivelas) = separados
- Base/cenário = parte separada

Responda APENAS com JSON puro:
{
  "parts": [
    {"partName": "Pele (rosto e mãos)"},
    {"partName": "Cabelo castanho"},
    {"partName": "Olhos"},
    {"partName": "Capa vermelha"},
    {"partName": "Armadura peitoral"},
    {"partName": "Calça de couro"},
    {"partName": "Botas"},
    {"partName": "Base/cenário"}
  ]
}

REGRAS:
- Nomes em português brasileiro, DESCRITIVOS (inclua cor aparente)
- Mínimo 6 partes, máximo 12
- Ordene de cima para baixo (cabeça → pés → base)
- JSON puro, sem markdown`;

    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [
          { role: "system", content: "Você é um especialista em pintura de miniaturas. Responda APENAS com JSON puro." },
          { role: "user", content: [
            { type: "image_url", image_url: { url: `data:${resizedType};base64,${resizedBase64}` } },
            { type: "text", text: prompt }
          ]}
        ],
        temperature: 0.2,
        max_tokens: 2000,
        top_p: 0.9,
        repeat_penalty: 1.1
      }, 'vision');

      if (!response?.choices?.[0]?.message?.content) return [];
      
      const jsonContent = this.extractJson(response.choices[0].message.content);
      const data = this.safeJsonParse(jsonContent);
      
      if (!data?.parts || !Array.isArray(data.parts)) return [];
      
      return data.parts.map((p: any) => ({
        partName: p.partName || p.name || 'Parte',
        region: null  // LLM local não é confiável para coordenadas
      }));
    } catch (error) {
      console.error('[identifyPartsLocal] Erro:', error);
      throw error;
    }
  }

  // --- GERAÇÃO COM REGIÕES PRÉ-DEFINIDAS ---

  private async generateProjectPlanGeminiWithRegions(
    projectName: string, source: string,
    referenceImageBase64: string, imageType: string,
    regions: { partName: string; region: { x: number; y: number; width: number; height: number } | null; regions?: { x: number; y: number; width: number; height: number }[]; confirmed: boolean }[]
  ): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    const imagePart = { inlineData: { mimeType: imageType, data: referenceImageBase64 } };
    const availablePaints = inventory.paints;
    const paintsList = availablePaints.map(p => `${p.name}|${p.brand}|${p.hex}`).join('\n');
    const thinnerInfo = inventory.thinners.length > 0 
      ? `Diluente: ${inventory.thinners[0].brand} (${inventory.thinners[0].composition})`
      : 'Diluente: água ou medium acrílico';

    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

    const model = 'gemini-2.5-flash';
    const partsDescription = regions.map((r, i) => {
      const regionStr = r.region 
        ? ` [região: x=${r.region.x.toFixed(2)}, y=${r.region.y.toFixed(2)}, w=${r.region.width.toFixed(2)}, h=${r.region.height.toFixed(2)}]`
        : '';
      return `${i+1}. ${r.partName}${regionStr}`;
    }).join('\n');

    // ========== FASE 1: Identificar cores para as partes definidas ==========
    console.log('[FASE 1 w/regions] Identificando cores...');
    
    const colorsPrompt = `Você é um pintor profissional de miniaturas analisando uma imagem de referência.
Projeto: "${projectName}" (${source})

PARTES JÁ IDENTIFICADAS PELO USUÁRIO:
${partsDescription}

TAREFA PRINCIPAL: Para CADA parte listada, OBSERVE CUIDADOSAMENTE A IMAGEM e determine a cor REAL do ELEMENTO ESPECÍFICO nomeado.

⚠️ REGRAS CRÍTICAS DE ANÁLISE POR ELEMENTO:
- "Olhos" → olhe APENAS a cor da ÍRIS na imagem (azul, verde, castanho, etc.). NÃO é a pele ao redor.
- "Cabelo" → olhe APENAS a cor dos fios de cabelo (loiro, castanho, ruivo, preto, grisalho). NÃO é o fundo.
- "Pele" → olhe APENAS o tom de pele (claro, médio, escuro, rosado). NÃO é a roupa.
- "Armadura/Metal" → olhe APENAS a superfície metálica (prata, dourado, bronze, oxidado).
- "Base/cenário" → olhe APENAS o terreno/base (pedra, grama, areia, lava, neve).
- Cada parte = analise SOMENTE aquele elemento, ignorando tudo ao redor.

INVENTÁRIO DE TINTAS DISPONÍVEIS (nome|marca|hex):
${paintsList}

INSTRUÇÕES DE CORRESPONDÊNCIA DE COR:
1. Determine o HEX exato da cor que você VÊ na imagem para cada elemento
2. Compare com TODAS as tintas do inventário por proximidade de cor (hex)
3. Se alguma tinta tem cor próxima (< 15% de distância), use-a como matchedPaint
4. Se NENHUMA tinta é próxima o suficiente, crie uma receita de MISTURA (needsMixing=true)
5. Tons de pele, cabelos, tecidos e materiais naturais FREQUENTEMENTE precisam de mistura
6. NUNCA use preto ou branco como cor base de pele, cabelo, olhos ou tecidos coloridos
7. Use cores REALISTAS — olhos são tipicamente azul/verde/castanho/cinza, não verde-limão ou rosa

Retorne JSON:
{
  "colors": [
    {
      "colorName": "nome descritivo da cor REAL vista na imagem, em português",
      "hex": "#RRGGBB (a cor EXATA que você vê na imagem para este elemento)",
      "location": "nome da parte do usuário",
      "matchedPaint": {"name": "NOME EXATO do inventário", "brand": "marca", "hex": "#HEX"} ou null,
      "needsMixing": true/false,
      "mixRecipe": {
        "targetColor": "cor alvo descrita em português",
        "targetHex": "#RRGGBB",
        "components": [{"paint": "NOME EXATO do inventário", "brand": "marca", "hex": "#HEX", "ratio": 2}],
        "instructions": "Como misturar em português"
      }
    }
  ]
}

VALIDAÇÃO FINAL — verifique antes de responder:
✅ Uma cor para CADA parte do usuário
✅ O hex retornado reflete a cor REAL do elemento na imagem
✅ matchedPaint usa NOME EXATO como cadastrado no inventário
✅ Cores de pele NÃO são preto/branco (são tons warm/flesh)
✅ Cores de cabelo refletem o tom REAL visto na imagem
✅ Cores de olhos refletem a cor da ÍRIS (não da pele)
✅ Cada parte tem cor realista e distinta (não tudo preto/branco/cinza)`;

    const colorsResponse: any = await this.ai.models.generateContent({
      model,
      contents: { parts: [{ text: colorsPrompt }, imagePart] },
      config: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 12000 }
    });

    const colorsText = this.extractResponseText(colorsResponse);
    if (!colorsText) return null;

    const colorsData = this.safeJsonParse(colorsText.trim());
    let colors = colorsData?.colors || colorsData?.identifiedColors;
    if (Array.isArray(colorsData)) colors = colorsData;
    if (!colors || colors.length === 0) return null;

    console.log(`[FASE 1 w/regions] ${colors.length} cores identificadas`);

    // ========== FASE 2: Gerar passos para as partes definidas pelo usuário ==========
    console.log('[FASE 2 w/regions] Gerando passos...');
    
    const colorsList = colors.map((c: any) => `${c.colorName} (${c.hex}): ${c.location}`).join('\n');

    const stepsPrompt = `Você é um instrutor profissional de pintura de miniaturas criando um guia completo.
Projeto: "${projectName}" (${source})
${thinnerInfo}

PARTES DEFINIDAS PELO USUÁRIO (gere UM PASSO para CADA, mais verniz final):
${partsDescription}

CORES IDENTIFICADAS NA FASE ANTERIOR:
${colorsList}

TINTAS DISPONÍVEIS NO INVENTÁRIO (nome|marca|hex):
${paintsList}

⚠️ TABELA DE TÉCNICA + FERRAMENTA POR TIPO DE PARTE:
| Tipo de Parte | Técnica Recomendada | Ferramenta | Diluição |
|---|---|---|---|
| Pele | layering ou glazing | Pincel redondo tamanho 1 | 3:1 (bem diluída) |
| Olhos | detalhes com ponta fina | Pincel de detalhe tamanho 000 | 2:1 |
| Cabelo | layering + edge highlight | Pincel redondo tamanho 0 | 2:1 |
| Tecido/Roupa | layering ou glazing | Pincel redondo tamanho 1 | 2:1 |
| Metal/Armadura | basecoat + drybrushing + edge highlight | Pincel chato (dry) + fino (edge) | 2:1 |
| Couro | layering | Pincel redondo tamanho 1 | 2:1 |
| Gemas/Joias | glazing (translúcido) | Pincel de detalhe tamanho 00 | 3:1 |
| Arma (metal) | basecoat + edge highlight | Pincel tamanho 0-1 | 2:1 |
| Base/Cenário | drybrushing + washing | Pincel chato velho (dry) | 1:1 (wash ralo) |
| Primeiro passo geral | basecoat | Pincel redondo tamanho 2 | 2:1 |

⚠️ REGRAS CRÍTICAS DE COR POR TIPO:
- PELE: tons warm (flesh/carne/bege/rosado). Shadow=tom mais escuro de flesh. Highlight=flesh+branco. NUNCA preto como base.
- OLHOS: a cor REAL da íris (azul, verde, castanho, cinza). NUNCA verde-limão ou rosa. Pupila=preto. Highlight=ponto de branco.
- CABELO: a cor REAL vista na imagem (castanho, loiro, ruivo, preto). Shadow=tom mais escuro. Highlight=tom mais claro.
- METAL: tons metálicos/cinzas (prata, steel, gunmetal). Shadow=preto/cinza escuro. Highlight=prata brilhante.
- COURO: marrons, tans. Shadow=marrom escuro. Highlight=marrom claro/tan.
- BASE/CENÁRIO: observe a cor REAL (pedra=cinza, terra=marrom, grama=verde). Use cores variadas, NÃO apenas preto+branco.

Retorne JSON com ${regions.length + 1} passos (um por parte + verniz final):
{
  "steps": [
    {
      "stepNumber": 1,
      "partName": "EXATAMENTE o nome da parte do usuário",
      "partDescription": "Descrição detalhada: (1) o que observar na referência, (2) como aplicar a base, (3) onde colocar sombras, (4) onde fazer highlights. Inclua dicas de pintura de miniatura profissional para ESTE tipo específico de parte.",
      "baseColor": {"name": "cor principal do elemento", "hex": "#RRGGBB"},
      "paintsToUse": [
        {"name": "NOME EXATO do inventário - tom médio", "brand": "marca", "hex": "#HEX", "purpose": "base"},
        {"name": "NOME EXATO - tom ESCURO para sombras", "brand": "marca", "hex": "#HEX", "purpose": "sombra"},
        {"name": "NOME EXATO - tom CLARO para highlights", "brand": "marca", "hex": "#HEX", "purpose": "luz"}
      ],
      "paintMix": null,
      "technique": "layering",
      "tool": "Pincel",
      "toolDetails": "Pincel redondo tamanho 1",
      "dilution": {"ratio": "2:1", "description": "2 partes tinta, 1 diluente", "thinnerNote": "${thinnerInfo}"},
      "imageRegions": [{"x": 0.0, "y": 0.0, "width": 0.5, "height": 0.5, "partName": "área"}],
      "tips": [
        "Dica prática específica para pintar este tipo de parte",
        "Dica sobre técnica profissional (pesquise as melhores práticas de miniature painting para este elemento)"
      ],
      "warnings": []
    }
  ],
  "fixationTips": ["dica verniz 1", "dica proteção 2"],
  "warnings": []
}

REGRAS OBRIGATÓRIAS:
1. Gere UM passo para CADA parte listada, usando EXATAMENTE o nome da parte do usuário
2. paintsToUse: SEMPRE 3 tintas por parte com purpose diferentes:
   - "base": cor principal do ELEMENTO (tom médio). NOME EXATO do inventário.
   - "sombra": cor mais ESCURA para regiões de sombra. Deve ter relação cromática com a base (mesma família de cor, mais escuro).
   - "luz": cor mais CLARA para highlights. Deve ter relação cromática com a base (mesma família, mais claro).
3. DIVERSIDADE DE CORES: cada parte DEVE ter cores diferentes e realistas. NÃO use preto+branco para tudo.
   - Se a peça tem 8 partes, deve haver pelo menos 5-6 cores BASE diferentes
   - Pele NÃO usa preto como base. Metal NÃO usa branco como base. Cabelo NÃO usa preto como sombra (a menos que o cabelo seja muito escuro).
4. TÉCNICA E FERRAMENTA conforme a tabela acima — use a técnica CORRETA para cada tipo de parte
5. OLHOS: NUNCA use drybrushing. Use pincel 000 e técnica de detalhe fino. A cor deve ser a da íris observada.
6. paintMix: quando a cor exata não existe no inventário, crie uma mistura com componentes do inventário.
7. dilution: SEMPRE objeto {ratio, description, thinnerNote}
8. tips: SEMPRE array com 2-4 dicas PRÁTICAS E ESPECÍFICAS para pintar aquele tipo de parte.
   - Pesquise/aplique conhecimento de técnicas profissionais de miniature painting
   - Ex para olhos: "Pinte o branco do olho primeiro, depois a íris, depois a pupila com um ponto de preto"
   - Ex para pele: "Aplique sombras nas cavidades dos olhos, sob o nariz e no pescoço"
   - Ex para metal: "Drybrushing leve nas arestas para simular desgaste natural"
9. warnings: SEMPRE array
10. Último passo = verniz protetor (pode ter apenas 1 tinta)
11. Tudo em português brasileiro
12. Use coordenadas de imageRegions das partes do usuário quando disponíveis`;

    const stepsResponse: any = await this.ai.models.generateContent({
      model,
      contents: { parts: [{ text: stepsPrompt }, imagePart] },
      config: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 65536 }
    });

    const stepsText = this.extractResponseText(stepsResponse);
    if (!stepsText) return null;

    const stepsData = this.safeJsonParse(stepsText.trim());
    if (!stepsData?.steps || stepsData.steps.length === 0) return null;

    // Normalizar passos
    stepsData.steps = stepsData.steps.map((step: any, idx: number) => {
      if (typeof step.dilution === 'string') step.dilution = { ratio: step.dilution, description: step.dilution, thinnerNote: '' };
      if (!step.dilution) step.dilution = { ratio: '2:1', description: '2:1', thinnerNote: '' };
      if (typeof step.tips === 'string') step.tips = [step.tips];
      if (!Array.isArray(step.tips)) step.tips = [];
      if (!Array.isArray(step.warnings)) step.warnings = [];
      if (!Array.isArray(step.paintsToUse)) step.paintsToUse = [];
      if (!Array.isArray(step.imageRegions)) step.imageRegions = [];
      step.stepNumber = step.stepNumber || idx + 1;
      step.partName = step.partName || `Passo ${idx + 1}`;
      step.partDescription = step.partDescription || '';
      if (!step.baseColor) step.baseColor = { name: step.partName, hex: '#808080' };
      
      // Corrigir técnica e ferramenta baseado no nome da parte
      step.technique = this.normalizeStepTechniqueForPart(step.technique, step.partName, idx);
      if (!step.toolDetails || step.toolDetails === 'Pincel redondo tamanho 1') {
        step.toolDetails = this.getToolDetailsByPartName(step.partName, step.technique);
      }
      step.tool = step.tool || 'Pincel';
      if (step.paintMix && (!step.paintMix.targetColor || !step.paintMix.components?.length)) step.paintMix = null;

      // SEMPRE usar regiões do usuário quando disponíveis (prioridade sobre IA)
      const userRegion = regions.find(r => r.partName.toLowerCase() === step.partName.toLowerCase());
      if (userRegion) {
        const allRegions = userRegion.regions && userRegion.regions.length > 0
          ? userRegion.regions
          : (userRegion.region ? [userRegion.region] : []);
        if (allRegions.length > 0) {
          step.imageRegions = allRegions.map((reg: any) => ({ ...reg, partName: userRegion.partName }));
        }
      }
      
      return step;
    });

    console.log(`[FASE 2 w/regions] ${stepsData.steps.length} passos gerados`);

    // Montar resultado
    const identifiedColors = colors.map((c: any) => ({
      colorName: c.colorName || c.name || 'Cor',
      hex: c.hex || '#888888',
      location: c.location || '',
      matchedPaint: c.matchedPaint || undefined,
      needsMixing: c.needsMixing || false,
      mixRecipe: (c.needsMixing && c.mixRecipe?.targetColor && c.mixRecipe?.components?.length) ? c.mixRecipe : undefined
    }));

    const allPaintsUsed = new Map<string, any>();
    for (const step of stepsData.steps) {
      for (const paint of (step.paintsToUse || [])) {
        allPaintsUsed.set(`${paint.name}-${paint.brand}`, { name: paint.name, brand: paint.brand, hex: paint.hex });
      }
    }

    return {
      projectName, source, identifiedColors,
      paintsToUse: Array.from(allPaintsUsed.values()),
      requiredMixes: [],
      steps: stepsData.steps,
      fixationTips: stepsData.fixationTips || ['Aplique verniz fosco para proteger.'],
      warnings: stepsData.warnings || [],
      referenceImage: { data: referenceImageBase64, type: imageType }
    };
  }

  private async generateProjectPlanLocalWithRegions(
    projectName: string, source: string,
    referenceImageBase64: string, imageType: string,
    regions: { partName: string; region: { x: number; y: number; width: number; height: number } | null; regions?: { x: number; y: number; width: number; height: number }[]; confirmed: boolean }[]
  ): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    if (inventory.paints.length === 0) {
      throw new Error('Seu inventário está vazio. Adicione tintas antes de gerar um projeto.');
    }

    let resizedBase64 = referenceImageBase64;
    let resizedType = imageType;
    try {
      const resized = await this.resizeImageForLocalLLM(referenceImageBase64, imageType, 1536);
      resizedBase64 = resized.base64;
      resizedType = resized.type;
    } catch (e) { console.warn('[generateLocalWithRegions] Falha ao redimensionar:', e); }

    const paintsList = inventory.paints.map(p => `${p.name}|${p.brand}|${p.hex}`).join('\n');
    const thinnerInfo = inventory.thinners.length > 0 
      ? `${inventory.thinners[0].brand} (${inventory.thinners[0].composition})`
      : 'água ou medium acrílico';

    const partsDescription = regions.map((r, i) => `${i+1}. ${r.partName}`).join('\n');

    // Construir descrição das tintas com cores descritivas
    const paintsWithColorDesc = inventory.paints.map(p => {
      const colorDesc = this.describeColor(p.hex);
      return `${p.name} | ${p.brand} | ${p.hex} | ${colorDesc}`;
    }).join('\n');

    const systemPrompt = `You are a master-level miniature painting instructor with 20+ years of experience.
You generate detailed painting guides as pure JSON. RESPOND ONLY with valid JSON — no markdown, no code blocks, no text.
All descriptive text in Brazilian Portuguese.

ABSOLUTE RULES FOR COLOR ANALYSIS:
When the user names a part, you MUST analyze ONLY that specific element in the image:
- "Olhos" (Eyes) → the IRIS color only (blue, green, brown, hazel, gray). NOT the surrounding skin. NEVER lime green or pink.
- "Cabelo" (Hair) → the HAIR color only (blonde, brown, red, black, gray). NOT background or skin.
- "Pele" (Skin) → the SKIN TONE only (pale, medium, dark, rosy). Base is ALWAYS a flesh/warm tone, NEVER black or white.
- "Armadura/Metal" → the METAL surface (silver, gold, bronze, rusty). Use metallic/gray tones.
- "Base/Cenário" → the TERRAIN (stone=gray, dirt=brown, grass=green, sand=tan). Use appropriate earth/nature tones.

TECHNIQUE + TOOL TABLE (you MUST follow this):
| Part Type | Technique | Tool | Notes |
|-----------|-----------|------|-------|
| Skin/Pele | layering or glazing | Round brush size 1 | Thin layers, warm tones |
| Eyes/Olhos | detail painting | Detail brush size 000 | NEVER drybrushing. Tiny precise strokes |
| Hair/Cabelo | layering + edge highlight | Round brush size 0 | Follow hair flow direction |
| Fabric/Cloth | layering or glazing | Round brush size 1 | Smooth transitions |
| Metal/Armor | basecoat + drybrushing + edge highlight | Flat brush (dry) + fine (edge) | Metallic paints |
| Leather | layering | Round brush size 1 | Warm browns |
| Gems/Jewels | glazing | Detail brush size 00 | Translucent layers |
| Weapon blade | basecoat + edge highlight | Brush size 0-1 | Sharp edge highlights |
| Base/Scenery | drybrushing + washing | Old flat brush | Heavy texture work |

COLOR DIVERSITY REQUIREMENT:
- Each part MUST have a DISTINCT, REALISTIC color palette
- A miniature with 8 parts should use AT LEAST 5-6 different base colors
- NEVER default to just black + white for everything
- Skin = flesh tones (warm). Hair = actual hair color. Eyes = actual iris color.
- Shadow paint must be SAME COLOR FAMILY as base, just darker
- Highlight paint must be SAME COLOR FAMILY as base, just lighter

COLOR MIXING: When the inventory lacks a close color match (>15% distance):
- Create a paintMix using inventory paints
- Hair, skin, and natural materials OFTEN need mixing
- Format: {"targetColor": "desc", "targetHex": "#HEX", "components": [{"paint": "EXACT name", "brand": "brand", "hex": "#HEX", "ratio": 2}], "instructions": "Portuguese instructions"}

TIPS QUALITY:
- Each step must have 2-4 SPECIFIC, PRACTICAL tips
- Tips should reference professional miniature painting techniques
- Eye tips: "Paint white of eye first, then iris color, then black pupil dot, finally white reflection dot"
- Skin tips: "Apply shadows in eye sockets, under nose, neck creases. Highlight cheekbones, nose bridge, forehead"
- Metal tips: "Light drybrush on edges for natural wear. Use washes in recesses for depth"
- Each tip must be actionable, not generic`;

    const userPrompt = `Look at this miniature reference image and create a detailed painting guide.

Project: "${projectName}" (${source})
Thinner available: ${thinnerInfo}

MINIATURE PARTS (user-defined — paint these EXACTLY):
${partsDescription}

AVAILABLE PAINTS IN INVENTORY (name | brand | hex | color description):
${paintsWithColorDesc}

YOUR TASK:
1. For EACH part, LOOK at the image and identify the REAL color of THE SPECIFIC NAMED ELEMENT
   - "Olhos" → What color are the IRISES in this image? (blue? green? brown?)
   - "Pele" → What is the skin tone? (pale? medium? dark? rosy?)
   - "Cabelo" → What hair color do you see? (blonde? brown? red? black?)
   - Look at EACH part and describe its ACTUAL color, not a default

2. For EACH part, select THREE paints from inventory:
   - "base": the closest match to the REAL color of this element (mid-tone)
   - "sombra": a DARKER shade from the SAME color family (for shadows)
   - "luz": a LIGHTER shade from the SAME color family (for highlights)

3. If no inventory paint matches the real color, create a paintMix

COLOR RULES — ENFORCE STRICTLY:
- Pele/Skin → base MUST be a flesh/warm tone paint (NOT black, NOT pure white, NOT gray)
- Olhos/Eyes → base MUST be the iris color you SEE (blue, green, brown etc.), NOT a random color
- Cabelo/Hair → base MUST match the hair color visible in the image
- Metal/Armadura → use metallic/gray paints
- Each part should have DISTINCT colors — don't reuse the same 2 paints for everything
- Shadow = same hue but DARKER. Highlight = same hue but LIGHTER.

TECHNIQUE RULES — ENFORCE STRICTLY:
- Olhos/Eyes → technique MUST be "detail painting", tool MUST be "Pincel de detalhe tamanho 000". NEVER drybrushing.
- Pele/Skin → technique should be "layering" or "glazing", brush size 1
- Metal/Armor → technique should include "drybrushing" for texture
- Base/Scenery → technique should be "drybrushing" + "washing"
- NEVER use drybrushing for delicate parts (eyes, gems, fine details)

Generate this JSON (${regions.length + 1} steps total = one per part + final varnish):
{
  "identifiedColors": [
    {
      "colorName": "nome descritivo da cor REAL em português",
      "hex": "#RRGGBB (a cor real do elemento)",
      "location": "nome exato da parte",
      "matchedPaint": {"name": "NOME EXATO DO INVENTÁRIO", "brand": "marca", "hex": "#HEX"},
      "needsMixing": false
    }
  ],
  "paintsToUse": [
    {"name": "NOME EXATO DO INVENTÁRIO", "brand": "marca", "hex": "#HEX"}
  ],
  "steps": [
    {
      "stepNumber": 1,
      "partName": "nome exato da parte do usuário",
      "partDescription": "Instrução detalhada em português: (1) observe a referência, (2) aplique a cor base no elemento, (3) onde colocar sombras, (4) onde fazer highlights. Dicas profissionais específicas.",
      "baseColor": {"name": "cor real do elemento", "hex": "#RRGGBB"},
      "paintsToUse": [
        {"name": "INVENTÁRIO EXATO", "brand": "marca", "hex": "#HEX", "purpose": "base"},
        {"name": "INVENTÁRIO EXATO", "brand": "marca", "hex": "#HEX", "purpose": "sombra"},
        {"name": "INVENTÁRIO EXATO", "brand": "marca", "hex": "#HEX", "purpose": "luz"}
      ],
      "paintMix": null,
      "technique": "layering",
      "tool": "Pincel",
      "toolDetails": "Pincel redondo tamanho 1",
      "dilution": {"ratio": "2:1", "description": "2 partes tinta, 1 diluente", "thinnerNote": "${thinnerInfo}"},
      "imageRegions": [],
      "tips": ["dica prática específica para este tipo de parte", "dica de técnica profissional"],
      "warnings": []
    }
  ],
  "fixationTips": ["Aplique verniz fosco para proteger.", "Deixe curar 24h."],
  "warnings": [],
  "requiredMixes": []
}

FINAL VALIDATION CHECKLIST:
✅ One step for each user part + final varnish = ${regions.length + 1} steps
✅ partName = EXACTLY the user's part name
✅ Each step has 3 paints (base, sombra, luz) with DIFFERENT and REALISTIC colors
✅ Paint names are EXACTLY as written in inventory list
✅ Eyes use detail brush 000, NEVER drybrushing
✅ Skin uses warm/flesh tone, NEVER black
✅ At least 5-6 different base colors across all steps
✅ Tips are specific and practical (2-4 per step)
✅ Technique matches the part type per the technique table
✅ dilution, tips, warnings are proper objects/arrays`;

    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: [
            { type: "image_url", image_url: { url: `data:${resizedType};base64,${resizedBase64}` } },
            { type: "text", text: userPrompt }
          ]}
        ],
        temperature: 0.2,
        max_tokens: 16384,
        top_p: 0.9,
        repeat_penalty: 1.1
      }, 'vision');

      if (!response?.choices?.[0]?.message?.content) throw new Error('Resposta vazia');

      const rawContent = response.choices[0].message.content;
      console.log('[generateLocalWithRegions] Resposta:', rawContent.length, 'chars');
      
      const jsonContent = this.extractJson(rawContent);
      let plan = this.safeJsonParse(jsonContent);
      if (!plan) {
        plan = JSON.parse(this.tryRepairJson(jsonContent));
      }

      plan = this.normalizeLocalPlan(plan, inventory, projectName, source);

      // SEMPRE usar regiões do usuário (prioridade sobre qualquer coisa gerada pela IA)
      if (plan.steps) {
        for (const step of plan.steps) {
          const userRegion = regions.find(r => r.partName.toLowerCase() === (step.partName || '').toLowerCase());
          if (userRegion) {
            const allRegions = userRegion.regions && userRegion.regions.length > 0
              ? userRegion.regions
              : (userRegion.region ? [userRegion.region] : []);
            if (allRegions.length > 0) {
              step.imageRegions = allRegions.map((reg: any) => ({ ...reg, partName: userRegion.partName }));
            }
          }
        }
      }

      return { ...plan, referenceImage: { data: referenceImageBase64, type: imageType } };
    } catch (error: any) {
      console.error('[generateLocalWithRegions] Erro:', error);
      if (error instanceof SyntaxError || error?.message?.includes('JSON')) {
        throw new Error('O modelo local não gerou JSON válido. Verifique se o modelo está carregado no LM Studio.');
      }
      throw error;
    }
  }

  // Extrai texto da resposta de diferentes formatos
  private extractResponseText(response: any): string | null {
    if (typeof response === 'string') return response;
    if (response?.text) {
      return typeof response.text === 'function' ? response.text() : response.text;
    }
    if (response?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return response.candidates[0].content.parts[0].text;
    }
    if (response?.response?.text) {
      return typeof response.response.text === 'function' ? response.response.text() : response.response.text;
    }
    console.error('[extractResponseText] Formato não reconhecido:', Object.keys(response || {}));
    return null;
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
      // Usar modelo de texto para identificar cor
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 12
      }, 'text');
      
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

  // Mapa de cores expandido para tintas de modelismo - cores mais precisas
  private colorMap: { [key: string]: string } = {
    // Pretos e Cinzas
    'black': '#1a1a1a', 'preto': '#1a1a1a', 'negro': '#1a1a1a', 'noir': '#1a1a1a',
    'abaddon black': '#231F20', 'chaos black': '#1a1a1a',
    'gray': '#6B7280', 'grey': '#6B7280', 'cinza': '#6B7280',
    'dark gray': '#374151', 'dark grey': '#374151', 'cinza escuro': '#374151',
    'light gray': '#9CA3AF', 'light grey': '#9CA3AF', 'cinza claro': '#9CA3AF',
    'administratum grey': '#949B95', 'dawnstone': '#70756E', 'mechanicus standard': '#3D4B4D',
    'eshin grey': '#484B4E', 'skavenblight dinge': '#47413B',
    
    // Brancos e Off-whites
    'white': '#FAFAFA', 'branco': '#FAFAFA', 'blanc': '#FAFAFA',
    'corax white': '#F3F3F3', 'white scar': '#FFFFFF', 'pallid wych flesh': '#CECCBB',
    'ivory': '#FFFFF0', 'marfim': '#FFFFF0', 'bone': '#E3DAC9', 'osso': '#E3DAC9',
    'ushabti bone': '#ABA173', 'screaming skull': '#B9C099',
    
    // Vermelhos
    'red': '#DC2626', 'vermelho': '#DC2626', 'rouge': '#DC2626',
    'mephiston red': '#9A1115', 'khorne red': '#6A0001', 'wazdakka red': '#8C0A0C',
    'evil sunz scarlet': '#C01411', 'wild rider red': '#EA2F28',
    'blood red': '#CB0000', 'sangue': '#8B0000', 'dark red': '#8B0000', 'vermelho escuro': '#8B0000',
    'crimson': '#DC143C', 'carmesim': '#DC143C', 'scarlet': '#FF2400', 'escarlate': '#FF2400',
    'burgundy': '#800020', 'bordô': '#800020', 'vinho': '#722F37',
    
    // Laranjas
    'orange': '#EA580C', 'laranja': '#EA580C',
    'troll slayer orange': '#F36C21', 'fire dragon bright': '#F4874E',
    'jokaero orange': '#EE3823', 'ryza rust': '#EC6227',
    'burnt orange': '#CC5500', 'laranja queimado': '#CC5500',
    
    // Amarelos
    'yellow': '#EAB308', 'amarelo': '#EAB308', 'jaune': '#EAB308',
    'averland sunset': '#FBB81C', 'yriel yellow': '#FFD900', 'flash gitz yellow': '#FFF300',
    'golden yellow': '#FFD700', 'lemon': '#FFF44F', 'limão': '#FFF44F',
    'ochre': '#CC7722', 'ocre': '#CC7722', 'mustard': '#FFDB58', 'mostarda': '#FFDB58',
    
    // Azuis
    'blue': '#2563EB', 'azul': '#2563EB', 'bleu': '#2563EB',
    'macragge blue': '#0F3D7C', 'caledor sky': '#366699', 'teclis blue': '#317EC1',
    'altdorf guard blue': '#2D4696', 'kantor blue': '#02134E', 'thousand sons blue': '#00506F',
    'dark blue': '#1E3A5F', 'azul escuro': '#1E3A5F', 'navy': '#000080', 'marinho': '#000080',
    'light blue': '#60A5FA', 'azul claro': '#60A5FA', 'sky blue': '#87CEEB', 'celeste': '#87CEEB',
    'ultramarine': '#3F00FF', 'ultramarino': '#3F00FF',
    'cyan': '#06B6D4', 'ciano': '#06B6D4', 'turquoise': '#40E0D0', 'turquesa': '#40E0D0',
    'ftalocianina': '#000F89', 'phthalo': '#000F89',
    'vibrante': '#0066FF', 'azul vibrante': '#0066FF',
    
    // Verdes
    'green': '#16A34A', 'verde': '#16A34A', 'vert': '#16A34A',
    'warpstone glow': '#1F7A1F', 'moot green': '#3DAF44', 'warboss green': '#3B8440',
    'caliban green': '#003D15', 'waaagh flesh': '#1E5434', 'castellan green': '#264715',
    'dark green': '#14532D', 'verde escuro': '#14532D', 'forest green': '#228B22',
    'lime': '#84CC16', 'lima': '#84CC16', 'lime green': '#32CD32',
    'olive': '#6B7215', 'oliva': '#6B7215', 'military green': '#4B5320',
    'teal': '#0D9488', 'verde azulado': '#0D9488',
    'jade': '#00A86B', 'esmeralda': '#50C878', 'emerald': '#50C878',
    
    // Marrons
    'brown': '#78350F', 'marrom': '#78350F', 'brun': '#78350F',
    'rhinox hide': '#462F30', 'mournfang brown': '#640909', 'XV-88': '#6C4811',
    'steel legion drab': '#5E5134', 'balor brown': '#8B5930', 'skrag brown': '#904E01',
    'dark brown': '#3D1F0D', 'marrom escuro': '#3D1F0D',
    'light brown': '#A67B5B', 'marrom claro': '#A67B5B',
    'wood': '#8B5A2B', 'madeira': '#8B5A2B', 'chestnut': '#954535', 'castanho': '#954535',
    'chocolate': '#7B3F00', 'terra': '#5C4033', 'earth': '#5C4033',
    'umber': '#635147', 'sienna': '#A0522D', 'siena': '#A0522D',
    'sepia': '#704214', 'sépia': '#704214',
    'leather': '#906040', 'couro': '#906040',
    
    // Tons de Pele
    'flesh': '#E8BEAC', 'pele': '#E8BEAC', 'skin': '#E8BEAC', 'carne': '#E8BEAC',
    'kislev flesh': '#D1A570', 'cadian fleshtone': '#C47B5A', 'bugmans glow': '#805341',
    'pallid flesh': '#CECCBB', 'flayed one flesh': '#EEC483',
    'ratskin flesh': '#AD6B4C', 'ungor flesh': '#D6A766',
    'dark flesh': '#8D5524', 'pele escura': '#8D5524',
    'light flesh': '#FFDBAC', 'pele clara': '#FFDBAC',
    
    // Metálicos
    'gold': '#D4AF37', 'dourado': '#D4AF37', 'golden': '#D4AF37', 'ouro': '#D4AF37', 'or': '#D4AF37',
    'retributor armour': '#C39C3A', 'auric armour': '#D6A726', 'liberator gold': '#CCB13B',
    'silver': '#C0C0C0', 'prata': '#C0C0C0', 'argent': '#C0C0C0',
    'leadbelcher': '#8A8A8A', 'ironbreaker': '#A1A1A1', 'stormhost silver': '#BFBFBF',
    'aluminium': '#A8A8A8', 'aluminio': '#A8A8A8',
    'bronze': '#CD7F32', 'brass': '#B5A642', 'latão': '#B5A642',
    'copper': '#B87333', 'cobre': '#B87333',
    'iron': '#5A5A5A', 'ferro': '#5A5A5A', 'steel': '#71797E', 'aço': '#71797E',
    'chrome': '#DBE4EB', 'cromo': '#DBE4EB',
    
    // Roxos e Violetas
    'purple': '#7C3AED', 'roxo': '#7C3AED', 'violet': '#8B5CF6', 'violeta': '#8B5CF6',
    'naggaroth night': '#3D2B4F', 'xereus purple': '#47085E', 'genestealer purple': '#7658A5',
    'daemonette hide': '#6C6084', 'druchii violet': '#3D1845',
    'magenta': '#EC4899', 'pink': '#F472B6', 'rosa': '#F472B6',
    'indigo': '#4B0082',
    
    // Oxidação e Efeitos
    'rust': '#B7410E', 'ferrugem': '#B7410E', 'oxidado': '#B7410E',
    'verdigris': '#43B3AE', 'patina': '#43B3AE',
    'typhus corrosion': '#463D2B',
    
    // Outros
    'buff': '#E5C8A8', 'bege': '#F5F5DC', 'beige': '#F5F5DC',
    'cream': '#FFFDD0', 'creme': '#FFFDD0',
    'sand': '#C2B280', 'areia': '#C2B280', 'zandri dust': '#9D8B61',
    'khaki': '#C3B091', 'caqui': '#C3B091', 'tan': '#D2B48C',
    'coral': '#FF7F50',
    
    // Primers
    'primer': '#808080', 'primer gray': '#808080', 'primer grey': '#808080',
    'primer black': '#1a1a1a', 'primer white': '#FAFAFA',
    
    // Acabamentos (não são cores, mas termos comuns)
    'matt': '#808080', 'matte': '#808080', 'fosco': '#808080',
    'gloss': '#FFFFFF', 'brilhante': '#FFFFFF', 'satin': '#E5E5E5', 'acetinado': '#E5E5E5'
  };

  // Extrair cor hex do nome localmente (sem IA) - busca mais inteligente
  private extractHexFromName(name: string): string {
    const nameLower = name.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // Remove acentos
    
    // Primeiro, tenta encontrar correspondência exata ou parcial mais longa
    let bestMatch: { key: string; hex: string; matchLength: number } | null = null;
    
    for (const [colorName, hex] of Object.entries(this.colorMap)) {
      const colorNameNormalized = colorName.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      
      if (nameLower.includes(colorNameNormalized)) {
        // Prioriza matches mais longos (mais específicos)
        if (!bestMatch || colorNameNormalized.length > bestMatch.matchLength) {
          bestMatch = { key: colorName, hex, matchLength: colorNameNormalized.length };
        }
      }
    }
    
    if (bestMatch) {
      return bestMatch.hex;
    }
    
    // Tenta extrair código de cor do nome (ex: "FS12246" pode indicar laranja federal)
    const fsMatch = nameLower.match(/fs\s*(\d+)/);
    if (fsMatch) {
      const fsCode = fsMatch[1];
      // Alguns códigos FS comuns
      const fsCodes: { [key: string]: string } = {
        '12246': '#FF8C00', // International Orange
        '17038': '#6B7280', // Gray
        '34087': '#3D5934', // Olive Drab
        '36375': '#808080', // Light Gray
        '35237': '#6B7280', // Gray
        '33531': '#D2B48C', // Sand
      };
      if (fsCodes[fsCode]) return fsCodes[fsCode];
    }
    
    // Tenta extrair número de cor comum (ex: "120" em "ACRYLIC COLOR 120 LIME GREEN")
    const numMatch = nameLower.match(/\b(\d{3,4})\b/);
    if (numMatch) {
      const num = numMatch[1];
      // Alguns números de cores comuns da Talento e outras marcas
      const numberCodes: { [key: string]: string } = {
        '1000': '#FAFAFA', // Branco
        '1001': '#1a1a1a', // Preto
        '1002': '#EAB308', // Amarelo
        '1003': '#DC2626', // Vermelho
        '1004': '#000F89', // Azul Ftalocianina
        '1051': '#E8BEAC', // Flesh/Pele
        '103': '#E5C8A8',  // Buff
        '112': '#B7410E',  // Rust
        '120': '#32CD32',  // Lime Green
        '158': '#704214',  // Sepia
        '159': '#78350F',  // Brown
        '164': '#1a1a1a',  // Black Gloss
        '180': '#8B5A2B',  // Wood
        '195': '#4B0082',  // Indigo
        '259': '#EA580C',  // Orange
        '400': '#A8A8A8',  // Aluminium
        '402': '#D4AF37',  // Golden
        '1500': '#6B7280', // Primer Gray
      };
      if (numberCodes[num]) return numberCodes[num];
    }
    
    // Cor padrão cinza médio se não encontrar
    return '#6B7280';
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
    
    // Verificar se há tintas no inventário
    if (inventory.paints.length === 0) {
      throw new Error('Seu inventário está vazio. Adicione tintas antes de gerar um projeto.');
    }
    
    console.log('[generateProjectPlanLocal] Gerando tutorial com LLM local (Qwen2-VL-7B ou similar)...');
    console.log('[generateProjectPlanLocal] Tintas no inventário:', inventory.paints.length);
    console.log('[generateProjectPlanLocal] Imagem original base64 tamanho:', referenceImageBase64.length, 'chars (~', Math.round(referenceImageBase64.length * 0.75 / 1024), 'KB)');
    
    // Redimensionar imagem para não sobrecarregar o LLM local (max 1536px, JPEG 85%)
    let resizedBase64 = referenceImageBase64;
    let resizedType = imageType;
    try {
      const resized = await this.resizeImageForLocalLLM(referenceImageBase64, imageType, 1536);
      resizedBase64 = resized.base64;
      resizedType = resized.type;
      console.log('[generateProjectPlanLocal] Imagem redimensionada base64 tamanho:', resizedBase64.length, 'chars (~', Math.round(resizedBase64.length * 0.75 / 1024), 'KB)');
    } catch (e) {
      console.warn('[generateProjectPlanLocal] Falha ao redimensionar, usando original:', e);
    }
    
    const paintsList = inventory.paints.map(p => `${p.name}|${p.brand}|${p.hex}`).join('\n');
    
    const thinnerInfo = inventory.thinners.length > 0 
      ? `${inventory.thinners[0].brand} (${inventory.thinners[0].composition})`
      : 'água ou medium acrílico';
    
    const systemPrompt = `Você é um especialista em pintura de miniaturas. Analise imagens de referência e gere guias de pintura profissionais.
Resposta OBRIGATORIAMENTE em JSON puro, sem markdown, sem texto antes ou depois.
Todos os textos em português brasileiro.`;

    const userPrompt = `Analise esta imagem de referência e crie um guia completo de pintura para a miniatura.

Projeto: "${projectName}" (${source})
Diluente disponível: ${thinnerInfo}

TINTAS DISPONÍVEIS (nome|marca|hex):
${paintsList}

Gere um JSON com esta estrutura EXATA:
{
  "identifiedColors": [
    {
      "colorName": "nome da cor (ex: Pele, Cabelo Ruivo)",
      "hex": "#RRGGBB",
      "location": "onde aparece na miniatura",
      "matchedPaint": {"name": "NOME EXATO da tinta", "brand": "marca", "hex": "#HEX"} ou null,
      "needsMixing": false
    }
  ],
  "paintsToUse": [
    {"name": "NOME EXATO da tinta", "brand": "marca", "hex": "#HEX"}
  ],
  "requiredMixes": [],
  "steps": [
    {
      "stepNumber": 1,
      "partName": "nome da parte (ex: Pele)",
      "partDescription": "descrição do que pintar neste passo",
      "baseColor": {"name": "cor base", "hex": "#RRGGBB"},
      "paintsToUse": [
        {"name": "NOME EXATO tinta", "brand": "marca", "hex": "#HEX", "purpose": "base"}
      ],
      "paintMix": null,
      "technique": "basecoat",
      "tool": "Pincel",
      "toolDetails": "Pincel redondo tamanho 1",
      "dilution": {
        "ratio": "2:1",
        "description": "2 partes de tinta para 1 de diluente",
        "thinnerNote": "${thinnerInfo}"
      },
      "imageRegions": [],
      "tips": ["dica 1", "dica 2"],
      "warnings": []
    }
  ],
  "fixationTips": ["Aplique verniz fosco para proteção", "Deixe secar 24h"],
  "warnings": []
}

REGRAS:
- Identifique TODAS as cores visíveis na imagem
- Use SOMENTE tintas da lista fornecida
- Gere 5-10 passos, um por parte/cor da miniatura
- paintsToUse em cada step: array com 1-3 tintas
- dilution: SEMPRE objeto {ratio, description, thinnerNote}
- tips: SEMPRE array de strings
- warnings: SEMPRE array (pode ser vazio)
- Técnicas: basecoat, layering, drybrushing, washing, glazing, edge highlight`;

    const messages: any[] = [
      {
        role: "system",
        content: systemPrompt
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${resizedType};base64,${resizedBase64}`
            }
          },
          {
            type: "text",
            text: userPrompt
          }
        ]
      }
    ];

    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: messages,
        temperature: 0.2,
        max_tokens: 16384,
        top_p: 0.9,
        repeat_penalty: 1.1
      }, 'vision');
      
      if (!response?.choices?.[0]?.message?.content) {
        throw new Error('Resposta vazia do modelo');
      }
      
      const rawContent = response.choices[0].message.content;
      const finishReason = response.choices[0].finish_reason;
      
      console.log('[generateProjectPlanLocal] Finish reason:', finishReason);
      console.log('[generateProjectPlanLocal] Resposta tamanho:', rawContent.length, 'chars');
      console.log('[generateProjectPlanLocal] Resposta (início):', rawContent.substring(0, 500));
      
      if (finishReason === 'length') {
        console.warn('[generateProjectPlanLocal] AVISO: Resposta truncada pelo max_tokens');
      }
      
      const jsonContent = this.extractJson(rawContent);
      
      let plan;
      try {
        plan = JSON.parse(jsonContent);
      } catch {
        console.warn('[generateProjectPlanLocal] JSON inválido, tentando reparar...');
        plan = this.safeJsonParse(jsonContent);
        if (!plan) {
          const repairedJson = this.tryRepairJson(jsonContent);
          plan = JSON.parse(repairedJson);
        }
      }
      
      // VALIDAÇÃO E NORMALIZAÇÃO para garantir tipos corretos
      plan = this.normalizeLocalPlan(plan, inventory, projectName, source);
      
      console.log('[generateProjectPlanLocal] Tutorial gerado com', plan.steps?.length, 'passos e', plan.identifiedColors?.length, 'cores');
      return { ...plan, referenceImage: { data: referenceImageBase64, type: imageType } };
      
    } catch (error: any) {
      console.error('[generateProjectPlanLocal] Erro:', error);
      
      if (error instanceof SyntaxError || error?.message?.includes('JSON')) {
        throw new Error('O modelo local não conseguiu gerar JSON válido. Verifique se o modelo está carregado no LM Studio (recomendado: qwen2-vl-7b-instruct para RTX 4060 8GB).');
      }
      throw error;
    }
  }

  /**
   * Normaliza o plano do LLM local para garantir que todos os campos
   * estejam no formato correto dos novos tipos (ProjectStep, etc.)
   */
  private normalizeLocalPlan(plan: any, inventory: FullInventory, projectName: string, source: string): any {
    plan.projectName = plan.projectName || projectName;
    plan.source = plan.source || source;
    
    // Garantir identifiedColors
    if (!plan.identifiedColors || !Array.isArray(plan.identifiedColors)) {
      plan.identifiedColors = [];
    }
    
    // Garantir paintsToUse
    if (!plan.paintsToUse || !Array.isArray(plan.paintsToUse)) {
      plan.paintsToUse = [];
    }
    
    // Garantir requiredMixes
    if (!plan.requiredMixes || !Array.isArray(plan.requiredMixes)) {
      plan.requiredMixes = [];
    }
    
    // Garantir fixationTips
    if (!plan.fixationTips || !Array.isArray(plan.fixationTips)) {
      plan.fixationTips = [
        'Aplique verniz fosco para proteger toda a pintura',
        'Deixe secar completamente por 24 horas antes de manusear',
        'Guarde em local seco e protegido da luz direta'
      ];
    }
    
    // Garantir warnings
    if (!plan.warnings || !Array.isArray(plan.warnings)) {
      plan.warnings = [];
    }
    
    // Normalizar steps para os novos tipos
    if (!plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      plan.warnings.push('⚠️ O modelo não gerou passos. Tente novamente.');
      plan.steps = [];
    } else {
      plan.steps = plan.steps.map((step: any, idx: number) => {
        // Converter formato antigo para novo se necessário
        const normalized: any = {
          stepNumber: step.stepNumber || idx + 1,
          partName: step.partName || step.paintName || `Passo ${idx + 1}`,
          partDescription: step.partDescription || step.description || '',
          baseColor: step.baseColor || { name: step.partName || 'Cor base', hex: '#808080' },
          technique: this.normalizeStepTechniqueForPart(step.technique, step.partName || step.paintName || '', idx),
          tool: step.tool || 'Pincel',
          toolDetails: step.toolDetails ? step.toolDetails : (step.brushSize ? `Pincel tamanho ${step.brushSize}` : this.getToolDetailsByPartName(step.partName || '', step.technique)),
          imageRegions: Array.isArray(step.imageRegions) ? step.imageRegions : [],
        };
        
        // paintsToUse: converter de formato antigo (paintName string) para novo (array)
        if (Array.isArray(step.paintsToUse) && step.paintsToUse.length > 0) {
          normalized.paintsToUse = step.paintsToUse;
        } else if (step.paintName) {
          const matchedPaint = this.findBestPaintMatch(step.paintName, inventory.paints);
          normalized.paintsToUse = [{
            name: matchedPaint?.name || step.paintName,
            brand: matchedPaint?.brand || 'Desconhecida',
            hex: matchedPaint?.hex || '#808080',
            purpose: 'base'
          }];
        } else {
          normalized.paintsToUse = [];
        }
        
        // dilution: converter string para objeto
        if (typeof step.dilution === 'string') {
          normalized.dilution = { ratio: step.dilution, description: step.dilution, thinnerNote: '' };
        } else if (step.dilution && typeof step.dilution === 'object') {
          normalized.dilution = {
            ratio: step.dilution.ratio || '2:1',
            description: step.dilution.description || step.dilution.ratio || '2:1',
            thinnerNote: step.dilution.thinnerNote || ''
          };
        } else {
          normalized.dilution = { ratio: '2:1', description: '2 partes de tinta para 1 de diluente', thinnerNote: '' };
        }
        
        // tips: converter string para array
        if (typeof step.tips === 'string') {
          normalized.tips = step.tips.split(/\n|\. /).filter((t: string) => t.trim().length > 3).map((t: string) => t.trim());
          if (normalized.tips.length === 0) normalized.tips = [step.tips];
        } else if (Array.isArray(step.tips)) {
          normalized.tips = step.tips;
        } else {
          normalized.tips = ['Aplique em camadas finas e uniformes'];
        }
        
        // warnings: converter string para array
        if (typeof step.warnings === 'string') {
          normalized.warnings = [step.warnings];
        } else if (Array.isArray(step.warnings)) {
          normalized.warnings = step.warnings;
        } else {
          normalized.warnings = [];
        }
        
        // paintMix
        normalized.paintMix = step.paintMix || null;
        
        return normalized;
      });
    }
    
    // Coletar tintas usadas nos passos se paintsToUse global estiver vazio
    if (plan.paintsToUse.length === 0) {
      const allPaintsUsed = new Map<string, any>();
      for (const step of plan.steps) {
        if (step.paintsToUse) {
          for (const paint of step.paintsToUse) {
            if (paint.name) {
              allPaintsUsed.set(`${paint.name}-${paint.brand}`, {
                name: paint.name,
                brand: paint.brand || '',
                hex: paint.hex || '#808080'
              });
            }
          }
        }
      }
      plan.paintsToUse = Array.from(allPaintsUsed.values());
    }
    
    // Verificar qualidade da resposta
    const isBadResponse = this.detectBadModelResponse(plan, inventory);
    if (isBadResponse) {
      plan.warnings.push('⚠️ O modelo de IA local pode não ter analisado a imagem corretamente. Verifique os passos.');
    }
    
    return plan;
  }

  /**
   * Retorna toolDetails padrão baseado na técnica
   */
  /** Normaliza a técnica do passo — aceita valores válidos do LLM e garante variedade */
  private normalizeStepTechnique(technique: string | undefined, stepIndex: number): string {
    const validTechniques = ['basecoat', 'layering', 'washing', 'drybrushing', 'edge highlight', 'glazing', 'detail painting'];
    const t = (technique || '').toLowerCase().trim();
    // Se o LLM retornou uma técnica válida, respeitar
    if (validTechniques.includes(t)) return t;
    // Mapear variantes comuns
    if (t.includes('wash')) return 'washing';
    if (t.includes('drybrush') || t.includes('dry brush')) return 'drybrushing';
    if (t.includes('highlight') || t.includes('edge')) return 'edge highlight';
    if (t.includes('layer')) return 'layering';
    if (t.includes('glaz')) return 'glazing';
    if (t.includes('base')) return 'basecoat';
    if (t.includes('detail') || t.includes('detalhe')) return 'detail painting';
    // Fallback com rotação baseada no índice para garantir variedade
    const rotation = ['basecoat', 'layering', 'washing', 'drybrushing', 'edge highlight', 'glazing'];
    return rotation[stepIndex % rotation.length];
  }

  /** Normaliza técnica levando em conta o NOME DA PARTE — impede combinações ruins */
  private normalizeStepTechniqueForPart(technique: string | undefined, partName: string, stepIndex: number): string {
    const name = (partName || '').toLowerCase();
    const t = (technique || '').toLowerCase().trim();
    
    // REGRAS DE BLOQUEIO: certas partes NUNCA devem usar certas técnicas
    // Olhos NUNCA usam drybrushing — são detalhes delicados
    if ((name.includes('olho') || name.includes('eye')) && (t.includes('drybrush') || t.includes('dry brush'))) {
      return 'detail painting';
    }
    // Gemas/joias NUNCA usam drybrushing
    if ((name.includes('gema') || name.includes('joia') || name.includes('gem')) && (t.includes('drybrush'))) {
      return 'glazing';
    }
    
    // Se o LLM deu uma técnica válida e não é bloqueada, usar
    const normalized = this.normalizeStepTechnique(technique, stepIndex);
    
    // Se caiu no fallback por rotação, usar a técnica baseada no nome da parte
    if (!technique || technique.trim() === '') {
      return this.getTechniqueByPartName(partName, stepIndex);
    }
    
    return normalized;
  }

  private getDefaultToolDetails(technique: string): string {
    switch ((technique || '').toLowerCase()) {
      case 'washing': return 'Pincel redondo tamanho 2';
      case 'drybrushing': return 'Pincel chato velho para drybrush';
      case 'edge highlight': case 'highlight': return 'Pincel fino tamanho 0 ou 00';
      case 'layering': return 'Pincel redondo tamanho 1';
      case 'glazing': return 'Pincel macio tamanho 2';
      case 'detalhes': case 'details': case 'detail painting': return 'Pincel de detalhe tamanho 000';
      default: return 'Pincel redondo tamanho 1';
    }
  }

  /** Retorna a ferramenta mais adequada baseada no NOME DA PARTE */
  private getToolDetailsByPartName(partName: string, technique: string): string {
    const name = (partName || '').toLowerCase();
    if (name.includes('olho') || name.includes('eye')) return 'Pincel de detalhe tamanho 000';
    if (name.includes('gema') || name.includes('joia') || name.includes('gem')) return 'Pincel de detalhe tamanho 00';
    if (name.includes('runa') || name.includes('símbolo') || name.includes('detalhe')) return 'Pincel de detalhe tamanho 00';
    if (name.includes('cabelo') || name.includes('hair')) return 'Pincel redondo tamanho 0';
    if (name.includes('base') || name.includes('cenário') || name.includes('terreno')) return 'Pincel chato tamanho 4 para drybrush';
    if (name.includes('armadura') || name.includes('metal') || name.includes('armor')) return 'Pincel redondo tamanho 1 + chato para drybrush';
    return this.getDefaultToolDetails(technique);
  }

  /** Retorna a técnica mais adequada baseada no NOME DA PARTE */
  private getTechniqueByPartName(partName: string, stepIndex: number): string {
    const name = (partName || '').toLowerCase();
    if (name.includes('olho') || name.includes('eye')) return 'detail painting';
    if (name.includes('gema') || name.includes('joia') || name.includes('gem')) return 'glazing';
    if (name.includes('pele') || name.includes('skin') || name.includes('rosto')) return 'layering';
    if (name.includes('cabelo') || name.includes('hair')) return 'layering';
    if (name.includes('base') || name.includes('cenário') || name.includes('terreno')) return 'drybrushing';
    if (name.includes('armadura') || name.includes('metal') || name.includes('armor')) return 'drybrushing';
    if (name.includes('capa') || name.includes('manto') || name.includes('túnica') || name.includes('roupa')) return 'layering';
    if (name.includes('verniz') || name.includes('proteção') || name.includes('selo')) return 'basecoat';
    // Fallback com rotação
    const rotation = ['basecoat', 'layering', 'washing', 'drybrushing', 'edge highlight', 'glazing'];
    return rotation[stepIndex % rotation.length];
  }

  /**
   * Descreve uma cor hex em português para ajudar o modelo
   */
  private describeColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    // Calcular luminosidade
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const brightness = luminance > 0.6 ? 'claro' : luminance < 0.3 ? 'escuro' : 'médio';
    
    // Detectar cor dominante
    if (r > 200 && g > 200 && b > 200) return 'branco';
    if (r < 50 && g < 50 && b < 50) return 'preto';
    if (r > g + 50 && r > b + 50) return `vermelho ${brightness}`;
    if (g > r + 50 && g > b + 50) return `verde ${brightness}`;
    if (b > r + 50 && b > g + 50) return `azul ${brightness}`;
    if (r > 180 && g > 180 && b < 100) return 'amarelo';
    if (r > 180 && g > 100 && g < 180 && b < 100) return 'laranja';
    if (r > 150 && g > 100 && b > 80 && Math.abs(r - g) < 50) return 'tom de pele';
    if (r > 150 && g > 150 && b < 100 && r > 180) return 'dourado';
    if (r > 100 && g > 100 && b > 100 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) return 'cinza';
    if (r > 80 && g < 60 && b < 60) return 'marrom';
    if (r > 100 && b > 100 && g < 80) return 'roxo';
    if (r > 200 && g < 150 && b > 150) return 'rosa';
    
    return `cor mista (R:${r} G:${g} B:${b})`;
  }

  /**
   * Valida e corrige o plano gerado pelo modelo local
   * Se o modelo retornou dados muito ruins, gera um tutorial básico de qualidade
   */
  private validateAndFixPlan(plan: any, inventory: FullInventory, projectName: string, source: string): any {
    // Garantir campos básicos
    plan.projectName = plan.projectName || projectName;
    plan.source = plan.source || source;
    plan.warnings = plan.warnings || [];
    plan.fixationTips = plan.fixationTips || [];
    plan.identifiedColors = plan.identifiedColors || [];
    plan.requiredMixes = plan.requiredMixes || [];
    
    // Verificar se o modelo retornou dados muito ruins
    const isBadResponse = this.detectBadModelResponse(plan, inventory);
    
    if (isBadResponse) {
      console.warn('[validateAndFixPlan] Resposta de baixa qualidade detectada. Gerando tutorial base...');
      plan.warnings.push('⚠️ O modelo de IA local não conseguiu analisar a imagem corretamente. Foi gerado um tutorial base que você deve adaptar.');
      plan.warnings.push('💡 Dica: Considere usar o Gemini ou um modelo local maior.');
      
      return this.generateBasicTutorial(plan, inventory, projectName, source);
    }
    
    // Normalizar steps usando normalizeLocalPlan
    return this.normalizeLocalPlan(plan, inventory, projectName, source);
  }

  /**
   * Detecta se o modelo retornou uma resposta de baixa qualidade
   */
  private detectBadModelResponse(plan: any, inventory: FullInventory): boolean {
    // Verificar se paintsToUse contém códigos hex ao invés de nomes
    if (plan.paintsToUse && Array.isArray(plan.paintsToUse)) {
      const hexPattern = /^#[0-9a-fA-F]{6}$/;
      const badPaints = plan.paintsToUse.filter((p: any) => 
        hexPattern.test(p.name) || !p.name || p.name.length < 3
      );
      if (badPaints.length > plan.paintsToUse.length * 0.5) {
        return true;
      }
    }
    
    // Verificar se os steps têm descrições muito curtas ou genéricas
    if (plan.steps && Array.isArray(plan.steps)) {
      const badSteps = plan.steps.filter((s: any) => {
        const desc = s.partDescription || s.description || '';
        const name = s.partName || s.paintName || '';
        return (
          (desc.length < 10 && name.length < 3) ||
          /^#[0-9a-fA-F]{6}$/.test(name)
        );
      });
      if (badSteps.length > plan.steps.length * 0.6) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Gera um tutorial básico de qualidade quando o modelo falha
   */
  private generateBasicTutorial(plan: any, inventory: FullInventory, projectName: string, source: string): any {
    const paints = inventory.paints;
    
    // Encontrar tintas por categoria (baseado no nome/cor)
    const findPaintByKeywords = (keywords: string[]): Paint | undefined => {
      for (const kw of keywords) {
        const found = paints.find(p => p.name.toLowerCase().includes(kw.toLowerCase()));
        if (found) return found;
      }
      return paints[0]; // fallback para primeira tinta
    };
    
    const primerPaint = findPaintByKeywords(['primer', 'cinza', 'gray', 'grey', 'base']);
    const skinPaint = findPaintByKeywords(['pele', 'skin', 'flesh', 'carne', 'caucasian']);
    const darkPaint = findPaintByKeywords(['preto', 'black', 'dark', 'escuro', 'sombra']);
    const lightPaint = findPaintByKeywords(['branco', 'white', 'claro', 'light']);
    const mainPaint = paints.find(p => !['primer', 'cinza', 'preto', 'branco'].some(k => p.name.toLowerCase().includes(k))) || paints[0];
    
    const usedPaints = new Set<Paint>();
    [primerPaint, skinPaint, darkPaint, lightPaint, mainPaint].forEach(p => { if (p) usedPaints.add(p); });
    
    const makePaintRef = (p: Paint | undefined, purpose: string) => ({
      name: p?.name || 'Tinta Base',
      brand: p?.brand || 'Desconhecida',
      hex: p?.hex || '#808080',
      purpose
    });
    
    const steps = [
      {
        stepNumber: 1,
        partName: 'Primer',
        partDescription: 'Aplicar primer em toda a miniatura para criar uma superfície uniforme que ajude a tinta a aderir.',
        baseColor: { name: primerPaint?.name || 'Primer Cinza', hex: primerPaint?.hex || '#808080' },
        paintsToUse: [makePaintRef(primerPaint, 'base')],
        paintMix: null,
        technique: 'basecoat',
        tool: 'Aerógrafo',
        toolDetails: 'Spray ou aerógrafo a 15-20cm',
        dilution: { ratio: 'Pronto', description: 'Pronto para uso ou 3:1 água/primer', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Aplique em camadas finas à distância de 15-20cm', 'Duas camadas finas são melhores que uma grossa', 'Deixe secar 30 minutos entre camadas'],
        warnings: [] as string[]
      },
      {
        stepNumber: 2,
        partName: 'Pele',
        partDescription: 'Pintar as áreas de pele expostas (rosto, mãos, braços) com a cor base.',
        baseColor: { name: skinPaint?.name || 'Cor de Pele', hex: skinPaint?.hex || '#E8BEAC' },
        paintsToUse: [makePaintRef(skinPaint, 'base')],
        paintMix: null,
        technique: 'basecoat',
        tool: 'Pincel',
        toolDetails: 'Pincel redondo tamanho 1',
        dilution: { ratio: '2:1', description: '2 partes de tinta para 1 de água (consistência de leite)', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Use pinceladas suaves seguindo a anatomia', 'Aplique 2-3 camadas finas para cobertura total'],
        warnings: [] as string[]
      },
      {
        stepNumber: 3,
        partName: 'Roupas / Cor Principal',
        partDescription: 'Pintar roupas e tecidos principais com a cor dominante na referência.',
        baseColor: { name: mainPaint?.name || 'Cor Principal', hex: mainPaint?.hex || '#808080' },
        paintsToUse: [makePaintRef(mainPaint, 'base')],
        paintMix: null,
        technique: 'basecoat',
        tool: 'Pincel',
        toolDetails: 'Pincel redondo tamanho 2',
        dilution: { ratio: '2:1', description: '2 partes de tinta para 1 de água', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Pinte primeiro as áreas maiores', 'Evite acumular tinta nas dobras'],
        warnings: [] as string[]
      },
      {
        stepNumber: 4,
        partName: 'Sombras (Wash)',
        partDescription: 'Aplicar wash escuro para criar sombras naturais nas reentrâncias.',
        baseColor: { name: darkPaint?.name || 'Wash Escuro', hex: darkPaint?.hex || '#1a1a1a' },
        paintsToUse: [makePaintRef(darkPaint, 'wash')],
        paintMix: null,
        technique: 'washing',
        tool: 'Pincel',
        toolDetails: 'Pincel redondo tamanho 2',
        dilution: { ratio: '1:5', description: '1 parte de tinta para 5 de água (bem aguado)', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Aplique generosamente nas reentrâncias', 'Remova excesso com pincel seco', 'Deixe secar 30+ minutos'],
        warnings: [] as string[]
      },
      {
        stepNumber: 5,
        partName: 'Layering / Realces',
        partDescription: 'Reaplicar cores base nas áreas elevadas e highlights nas bordas.',
        baseColor: { name: lightPaint?.name || 'Cor Clara', hex: lightPaint?.hex || '#FAFAFA' },
        paintsToUse: [makePaintRef(mainPaint, 'base'), makePaintRef(lightPaint, 'highlight')],
        paintMix: null,
        technique: 'layering',
        tool: 'Pincel',
        toolDetails: 'Pincel fino tamanho 0 ou 00',
        dilution: { ratio: '2:1', description: '2 partes de tinta para 1 de água', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Pinte apenas áreas elevadas', 'Use drybrushing para textura', 'Toque apenas bordas e pontos de luz'],
        warnings: [] as string[]
      },
      {
        stepNumber: 6,
        partName: 'Detalhes',
        partDescription: 'Pintar detalhes pequenos: olhos, joias, fivelas, botões e símbolos.',
        baseColor: { name: darkPaint?.name || 'Preto', hex: darkPaint?.hex || '#1a1a1a' },
        paintsToUse: [makePaintRef(darkPaint, 'base'), makePaintRef(lightPaint, 'highlight')],
        paintMix: null,
        technique: 'basecoat',
        tool: 'Pincel',
        toolDetails: 'Pincel de detalhe tamanho 000 ou 00',
        dilution: { ratio: '1:1', description: '1 parte de tinta para 1 de água', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Apoie a mão para estabilidade', 'Use pouca tinta no pincel', 'Para olhos: branco, íris, ponto de luz'],
        warnings: [] as string[]
      },
      {
        stepNumber: 7,
        partName: 'Base / Cenário',
        partDescription: 'Pintar a base com cores que representem o cenário.',
        baseColor: { name: findPaintByKeywords(['marrom', 'brown', 'terra'])?.name || 'Marrom', hex: findPaintByKeywords(['marrom', 'brown', 'terra'])?.hex || '#78350F' },
        paintsToUse: [makePaintRef(findPaintByKeywords(['marrom', 'brown', 'terra', 'cinza']), 'base')],
        paintMix: null,
        technique: 'drybrushing',
        tool: 'Pincel',
        toolDetails: 'Pincel chato para drybrushing',
        dilution: { ratio: '2:1', description: '2 partes de tinta para 1 de água', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Use drybrushing para texturas', 'Adicione grama estática para realismo'],
        warnings: [] as string[]
      },
      {
        stepNumber: 8,
        partName: 'Verniz Protetor',
        partDescription: 'Aplicar verniz protetor para selar a pintura.',
        baseColor: { name: 'Verniz Fosco', hex: '#E5E5E5' },
        paintsToUse: [{ name: 'Verniz Fosco', brand: 'Qualquer', hex: '#E5E5E5', purpose: 'base' }],
        paintMix: null,
        technique: 'basecoat',
        tool: 'Aerógrafo ou Spray',
        toolDetails: 'Spray a 20cm de distância',
        dilution: { ratio: 'Pronto', description: 'Pronto para uso', thinnerNote: '' },
        imageRegions: [] as any[],
        tips: ['Aplique em ambiente ventilado', 'Verniz fosco para acabamento natural', 'Brilhante apenas em metais e olhos'],
        warnings: [] as string[]
      }
    ];
    
    return {
      projectName,
      source,
      identifiedColors: [],
      warnings: plan.warnings || ['⚠️ Tutorial gerado automaticamente. Adapte as cores conforme sua referência.'],
      paintsToUse: Array.from(usedPaints).map(p => ({ name: p.name, brand: p.brand, hex: p.hex })),
      requiredMixes: [],
      steps,
      fixationTips: [
        'Deixe a miniatura secar completamente por 24-48 horas antes de manusear',
        'Guarde em local seco e protegido da luz solar direta',
        'Use uma vitrine ou caixa com tampa para proteger da poeira',
        'Para transporte, use espuma ou material acolchoado'
      ]
    };
  }

  /**
   * Encontra a melhor correspondência de tinta no inventário
   */
  private findBestPaintMatch(paintName: string, paints: Paint[]): Paint | null {
    if (!paintName) return null;
    
    const nameLower = paintName.toLowerCase().trim();
    
    // 1. Correspondência exata
    let match = paints.find(p => p.name.toLowerCase() === nameLower);
    if (match) return match;
    
    // 2. Correspondência parcial (nome contém ou está contido)
    match = paints.find(p => 
      p.name.toLowerCase().includes(nameLower) || 
      nameLower.includes(p.name.toLowerCase())
    );
    if (match) return match;
    
    // 3. Correspondência por palavras-chave
    const keywords = nameLower.split(/\s+/);
    match = paints.find(p => {
      const paintWords = p.name.toLowerCase().split(/\s+/);
      return keywords.some(kw => paintWords.some(pw => pw.includes(kw) || kw.includes(pw)));
    });
    if (match) return match;
    
    // 4. Se o nome parece ser uma cor, tentar encontrar por cor
    const colorKeywords = ['branco', 'preto', 'vermelho', 'azul', 'verde', 'amarelo', 'marrom', 'cinza', 'pele', 'flesh', 'white', 'black', 'red', 'blue', 'green', 'yellow', 'brown', 'gray', 'grey'];
    for (const color of colorKeywords) {
      if (nameLower.includes(color)) {
        match = paints.find(p => p.name.toLowerCase().includes(color));
        if (match) return match;
      }
    }
    
    return null;
  }

  /**
   * Verifica se uma tinta é usada nos passos
   */
  private isPaintUsedInSteps(paintName: string, steps: any[]): boolean {
    if (!steps || !Array.isArray(steps)) return false;
    const nameLower = paintName.toLowerCase();
    return steps.some(step => 
      step.paintName?.toLowerCase().includes(nameLower) ||
      nameLower.includes(step.paintName?.toLowerCase() || '')
    );
  }

  /**
   * Redimensiona imagem base64 para caber no limite do LLM local.
   * Converte para JPEG com qualidade reduzida e limita dimensões.
   */
  private resizeImageForLocalLLM(base64: string, mimeType: string, maxDim: number): Promise<{base64: string, type: string}> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.naturalWidth;
          let h = img.naturalHeight;
          
          // Só redimensionar se necessário
          if (w <= maxDim && h <= maxDim && mimeType === 'image/jpeg') {
            resolve({ base64, type: mimeType });
            return;
          }
          
          // Calcular novas dimensões mantendo aspect ratio
          if (w > h) {
            if (w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          } else {
            if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          
          // Converter para JPEG com qualidade 85%
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          const resizedBase64 = dataUrl.split(',')[1];
          console.log(`[resizeImageForLocalLLM] ${img.naturalWidth}x${img.naturalHeight} → ${w}x${h} (JPEG 85%)`);
          resolve({ base64: resizedBase64, type: 'image/jpeg' });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Failed to load image for resizing'));
      img.src = `data:${mimeType};base64,${base64}`;
    });
  }

  /**
   * Envia requisição para LLM local
   * @param payload - Dados da requisição
   * @param modelType - 'vision' para Qwen2-VL, 'text' para Gemma
   */
  private async postToLocalLLM<T>(payload: object, modelType: 'vision' | 'text' = 'vision'): Promise<T> {
    const endpoint = this.settingsService.settings().localEndpoint;
    // Use Vite proxy for local LLM to avoid CORS issues
    // The proxy /api/llm forwards to http://127.0.0.1:1234
    // LM Studio uses /v1/chat/completions endpoint (OpenAI-compatible)
    const url = '/api/llm/v1/chat/completions';
    
    // Especificar o modelo baseado no tipo de tarefa
    // LM Studio aceita nome parcial do modelo ou "local-model" para o primeiro carregado
    // Para RTX 4060 (8GB VRAM): usar modelos de até 7-8B parâmetros
    // Recomendados: qwen2-vl-7b-instruct, llava-v1.6-mistral-7b, minicpm-v-2.6
    const modelName = modelType === 'vision' 
      ? 'qwen2-vl-7b-instruct'     // Modelo de visão ~7B (cabe em 8GB VRAM)
      : 'qwen2-vl-7b-instruct';    // Mesmo modelo para texto
    
    console.log(`[postToLocalLLM] Enviando para ${modelType} (${modelName}):`, url);
    console.log(`[postToLocalLLM] Payload size: ~${Math.round(JSON.stringify(payload).length / 1024)} KB`);
    
    try {
      const response = await firstValueFrom(this.http.post<T>(url, { 
        model: modelName, 
        ...payload 
      }));
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
    // Primeiro, tenta extrair JSON de blocos de código markdown (```json ... ```)
    // O regex agora é mais flexível com espaços e quebras de linha
    const markdownMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (markdownMatch && markdownMatch[1]) {
      const extracted = markdownMatch[1].trim();
      console.log('[extractJson] Extraído de bloco markdown:', extracted.substring(0, 100) + '...');
      return extracted;
    }
    
    // Se não encontrou bloco markdown, tenta encontrar um objeto JSON diretamente
    const jsonMatch = text.match(/(\{[\s\S]*\})/);
    if (jsonMatch && jsonMatch[1]) {
      console.log('[extractJson] Extraído JSON direto:', jsonMatch[1].substring(0, 100) + '...');
      return jsonMatch[1];
    }
    
    console.log('[extractJson] Nenhum JSON encontrado, retornando texto original');
    return text;
  }

  /**
   * Tenta reparar um JSON truncado fechando arrays e objetos abertos
   */
  private tryRepairJson(json: string): string {
    let repaired = json.trim();
    
    // Remover vírgula pendente no final (comum em truncamentos)
    repaired = repaired.replace(/,\s*$/, '');
    
    // Se terminou com uma chave incompleta (ex: "stepNumber":), remover
    repaired = repaired.replace(/,?"[^"]*":\s*$/, '');
    
    // Contar chaves e colchetes abertos
    let openBraces = 0;
    let openBrackets = 0;
    let inString = false;
    let prevChar = '';
    
    for (const char of repaired) {
      if (char === '"' && prevChar !== '\\') {
        inString = !inString;
      } else if (!inString) {
        if (char === '{') openBraces++;
        else if (char === '}') openBraces--;
        else if (char === '[') openBrackets++;
        else if (char === ']') openBrackets--;
      }
      prevChar = char;
    }
    
    // Se terminou no meio de uma string, fechar
    if (inString) {
      repaired += '"';
    }
    
    // Remover vírgula pendente novamente após fechar string
    repaired = repaired.replace(/,\s*$/, '');
    
    // Fechar arrays e objetos abertos na ordem correta
    // Primeiro arrays dentro de objetos, depois objetos
    while (openBrackets > 0) {
      repaired += ']';
      openBrackets--;
    }
    while (openBraces > 0) {
      repaired += '}';
      openBraces--;
    }
    
    console.log('[tryRepairJson] JSON reparado (final):', repaired.substring(Math.max(0, repaired.length - 100)));
    return repaired;
  }
}
