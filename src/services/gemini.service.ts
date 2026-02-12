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

  async parseBulkInventory(inventoryList: string, brand: string = ''): Promise<ParsedInventory | null> {
    const settings = this.settingsService.settings();
    if (settings.provider === 'local') {
      return this.parseBulkInventoryLocal(inventoryList, brand);
    }
    return this.parseBulkInventoryGemini(inventoryList, brand);
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

  private async parseBulkInventoryGemini(inventoryList: string, brand: string = ''): Promise<ParsedInventory | null> {
    if (!this.ai) {
      const mod = await import('@google/genai');
      this.ai = new mod.GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }

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
      return JSON.parse(response.text.trim());
    } catch {
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
    const prompt = `Retorne APENAS código hexadecimal para: "${brand} ${name}"\nFormato: #RRGGBB\nSem explicações.`;
    
    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 10
      });
      if (!response?.choices?.[0]?.message?.content) {
        console.error('Invalid response structure from local LLM:', response);
        return null;
      }
      const text = response.choices[0].message.content.trim();
      // Accept 3, 4, 5, 6 digit hex codes and normalize to 6 digits
      const match = text.match(/#([0-9a-fA-F]{3,6})/);
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
        return '#' + hex.toUpperCase();
      }
      return null;
    } catch (error) {
      console.error('Error getting hex for paint from local LLM:', error);
      return null;
    }
  }

  private async parseBulkInventoryLocal(inventoryList: string, brand: string = ''): Promise<ParsedInventory | null> {
    const lines = inventoryList.split('\n').map(l => l.trim()).filter(l => l);
    
    const prompt = `Parse itens (1 por linha). Categorize: tinta/diluente/verniz/wash.
Se tinta: especifique Acrylic ou Ink, e hex (#RRGGBB).
Use marca: "${brand}"

${lines.map((line, i) => `${i + 1}. ${line}`).join('\n')}

JSON: {"paints": [{"brand":"","name":"","type":"Acrylic|Ink","hex":"#..."}], "thinners": [{"brand":"","composition":""}], "varnishes": [{"brand":"","finish":""}], "washes": [{"brand":"","composition":""}]}`;

    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 1500
      });
      if (!response?.choices?.[0]?.message?.content) {
        console.error('Invalid response structure from local LLM:', response);
        return null;
      }
      return JSON.parse(this.extractJson(response.choices[0].message.content));
    } catch (error) {
      console.error('Error parsing bulk inventory from local LLM:', error);
      return null;
    }
  }

  private async generateProjectPlanLocal(projectName: string, source: string, referenceImageBase64: string, imageType: string): Promise<ProjectPlan | null> {
    const inventory = this.inventoryService.fullInventory();
    const prompt = `Gere um guia de pintura JSON para o projeto "${projectName}" (${source}) usando este inventário: ${JSON.stringify(inventory)}.`;
    try {
      const response = await this.postToLocalLLM<LocalLLMResponse>({
        messages: [
          { role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${imageType};base64,${referenceImageBase64}` } }
          ]}
        ],
        temperature: 0.5,
        response_format: { type: "json_object" }
      });
      if (!response?.choices?.[0]?.message?.content) {
        console.error('Invalid response structure from local LLM:', response);
        return null;
      }
      const plan = JSON.parse(this.extractJson(response.choices[0].message.content));
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
    try {
      const response = await firstValueFrom(this.http.post<T>(url, { model: "local-model", ...payload }));
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