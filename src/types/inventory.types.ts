
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

export interface ProjectStep {
  stepNumber: number;
  description: string;
  paintName: string;
  paintMix?: string;
  tool: 'Airbrush' | 'Paintbrush';
  brushSize?: string;
  dilution: string;
  tips: string;
  imageRegions?: {x: number; y: number; width: number; height: number}[];
}

export interface ProjectPaint {
    name: string;
    brand: string;
    hex: string;
}

export interface ProjectPlan {
  projectName: string;
  source: string;
  paintsToUse: ProjectPaint[];
  steps: ProjectStep[];
  fixationTips: string[];
  warnings?: string[];
  referenceImage: {
    data: string; // base64
    type: string; // mime type
  };
}
