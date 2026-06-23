// ── Raw module.json shape ─────────────────────────────────────────────────────

export type ParamType = "float" | "int" | "boolean" | "color" | "string";

export type Renderer = "JAVA2D" | "P2D" | "P3D";

export type RawParam = {
  default: number | boolean | string;
  type?: ParamType;
  range?: [number, number];
  values?: string[];          // enum options
  description?: string;
  osc?: boolean;              // false = baked at assembly, not live-controllable
};

export type RawModuleJson = {
  id: string;
  name: string;
  description: string;
  version: string;
  oscPrefix: string;
  renderer?: Renderer;        // sketch renderer hint — assembler picks the strictest across modules
  layout:  Record<string, RawParam>;
  physics: Record<string, RawParam>;
  params:  Record<string, RawParam>;
  effects: Record<string, RawParam>;
};

// ── Generated API ─────────────────────────────────────────────────────────────

export type OscParam = {
  address: string;              // e.g. "/eq/springStiffness"
  name: string;                 // camelCase key from JSON
  label: string;                // human-readable, e.g. "Spring Stiffness"
  section: "physics" | "params" | "effects";
  type: ParamType;
  range?: [number, number];
  default: number | boolean | string;
  description: string;
};

export type ControlWidget =
  | { type: "slider"; label: string; address: string; min: number; max: number; step: number; default: number }
  | { type: "toggle"; label: string; address: string; default: boolean }
  | { type: "color";  label: string; address: string; default: string }
  | { type: "select"; label: string; address: string; values: string[]; default: string };

export type ControlSection = {
  id: string;
  title: string;
  controls: ControlWidget[];
};

export type BakedParam = {
  name: string;
  value: number | boolean | string;
  type: ParamType;
  description: string;
};

export type ModuleApi = {
  id: string;
  name: string;
  description: string;
  oscPrefix: string;
  renderer?: Renderer;
  oscParams: OscParam[];        // live-controllable params → OSC
  controller: ControlSection[]; // grouped for the web controller UI
  baked: BakedParam[];          // layout + osc:false params → assembler only
};
