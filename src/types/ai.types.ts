export type AIProvider = 'gemini' | 'local';

export interface AISettings {
  provider: AIProvider;
  localEndpoint: string;
}
