
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
  composition: 'Original' | 'Caseiro';
}

export interface Varnish {
  id: string;
  brand: string;
  finish: 'Brilhante' | 'Acetinado' | 'Fosco' | 'Vitral Brilhante';
}

export interface Wash {
  id: string;
  brand: string;
  composition: string;
}

export interface FullInventory {
  paints: Paint[];
  thinners: Thinner[];
  varnishes: Varnish[];
  washes: Wash[];
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
