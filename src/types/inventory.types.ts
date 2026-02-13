
export interface Paint {
  id: string;
  type: 'Ink' | 'Acrylic' | 'Varnish' | 'Other';
  brand: string;
  name: string;
  hex: string;
}

export interface Thinner {
  id: string;
  brand: string;
  name: string;
  composition: 'Original' | 'Caseiro';
}

export interface Varnish {
  id: string;
  brand: string;
  name: string;
  finish: 'Brilhante' | 'Acetinado' | 'Fosco' | 'Vitral Brilhante';
}

export interface Wash {
  id: string;
  brand: string;
  name: string;
  hex: string;
  composition: string;
}

// Novos tipos de equipamentos
export interface Brush {
  id: string;
  brand: string;
  series: string;
  size: string;
  type: 'Redondo' | 'Chato' | 'Angular' | 'Leque' | 'Detalhe' | 'Drybrush' | 'Outro';
}

export interface Airbrush {
  id: string;
  brand: string;
  model: string;
  nozzleSize: string; // Ex: 0.2mm, 0.3mm, 0.5mm
  type: 'Gravidade' | 'Sucção' | 'Lateral';
  psi?: string;
}

export interface Tool {
  id: string;
  name: string;
  brand?: string;
  category: 'Corte' | 'Modelagem' | 'Medição' | 'Limpeza' | 'Suporte' | 'Outro';
  description?: string;
}

export interface FullInventory {
  paints: Paint[];
  thinners: Thinner[];
  varnishes: Varnish[];
  washes: Wash[];
  brushes: Brush[];
  airbrushes: Airbrush[];
  tools: Tool[];
}

// Cor identificada na imagem de referência
export interface IdentifiedColor {
  colorName: string;       // Nome descritivo da cor (ex: "Vermelho sangue", "Azul gelo")
  hex: string;             // Código hex da cor identificada
  location: string;        // Onde aparece (ex: "Capa, detalhes da armadura")
  matchedPaint?: {         // Tinta mais próxima do inventário (se houver)
    name: string;
    brand: string;
    hex: string;
  };
  needsMixing: boolean;    // Se precisa misturar tintas para conseguir
  mixRecipe?: PaintMix;    // Receita de mistura (quando needsMixing=true)
}

// Mistura de tintas para criar uma cor
export interface PaintMix {
  targetColor: string;     // Cor alvo (ex: "Laranja queimado")
  targetHex: string;       // Hex da cor desejada
  components: {
    paint: string;         // Nome da tinta
    brand: string;         // Marca
    hex: string;           // Hex da tinta
    ratio: number;         // Proporção (ex: 2 para 2:1)
  }[];
  instructions: string;    // Como misturar (ex: "2 partes de vermelho para 1 de amarelo")
}

// Região da imagem para um passo
export interface ImageRegion {
  x: number;              // Posição X (0-1)
  y: number;              // Posição Y (0-1)
  width: number;          // Largura (0-1)
  height: number;         // Altura (0-1)
  partName: string;       // Nome da parte (ex: "Braço esquerdo")
}

// Passo de pintura - agora baseado em PARTES com mesma cor
export interface ProjectStep {
  stepNumber: number;
  partName: string;        // Nome da parte (ex: "Pele", "Cabelo", "Capa vermelha")
  partDescription: string; // Descrição detalhada do que pintar
  
  // Cores e tintas
  baseColor: {
    name: string;
    hex: string;
  };
  paintsToUse: {           // Tintas necessárias para este passo
    name: string;
    brand: string;
    hex: string;
    purpose: string;       // "base", "sombra", "highlight", "wash", "glaze"
  }[];
  paintMix?: PaintMix;     // Se precisar misturar tintas
  
  // Técnicas e ferramentas
  technique: string;       // "basecoat", "layering", "drybrushing", "washing", "glazing", "edge highlight"
  tool: string;            // Ferramenta (pincel, aerógrafo)
  toolDetails: string;     // Detalhes (tamanho do pincel, PSI do aerógrafo)
  
  // Diluição
  dilution: {
    ratio: string;         // Ex: "1:1", "2:1", "puro"
    description: string;   // Ex: "1 parte de tinta para 1 de diluente"
    thinnerNote?: string;  // Nota sobre o diluente cadastrado
  };
  
  // Regiões da imagem onde aplicar
  imageRegions: ImageRegion[];
  
  // Dicas
  tips: string[];          // Lista de dicas profissionais
  warnings?: string[];     // Avisos específicos do passo
}

export interface ProjectPaint {
  name: string;
  brand: string;
  hex: string;
}

export interface ProjectPlan {
  projectName: string;
  source: string;
  
  // Todas as cores identificadas na referência
  identifiedColors: IdentifiedColor[];
  
  // Tintas do inventário que serão usadas
  paintsToUse: ProjectPaint[];
  
  // Misturas necessárias (para cores não disponíveis)
  requiredMixes: PaintMix[];
  
  // Passos organizados por parte/cor
  steps: ProjectStep[];
  
  // Dicas finais
  fixationTips: string[];
  warnings?: string[];
  
  // Imagem de referência
  referenceImage: {
    data: string;
    type: string;
  };
}
