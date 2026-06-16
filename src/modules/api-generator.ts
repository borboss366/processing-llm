import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  RawModuleJson, RawParam, ParamType,
  OscParam, ControlWidget, ControlSection, BakedParam, ModuleApi,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function camelToLabel(name: string): string {
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

function inferType(p: RawParam): ParamType {
  if (p.type) return p.type;
  if (typeof p.default === "boolean") return "boolean";
  if (typeof p.default === "string" && p.default.startsWith("#")) return "color";
  if (p.range && Number.isInteger(p.range[0]) && Number.isInteger(p.range[1])
      && Number.isInteger(p.default)) return "int";
  return "float";
}

function sliderStep(range: [number, number], type: ParamType): number {
  if (type === "int") return 1;
  const span = range[1] - range[0];
  if (span <= 0.01) return 0.0001;
  if (span <= 0.1)  return 0.001;
  if (span <= 1)    return 0.01;
  return Math.round(span / 100);
}

function makeWidget(
  name: string,
  param: RawParam,
  address: string,
  type: ParamType,
): ControlWidget {
  const label = camelToLabel(name);

  if (type === "boolean") {
    return { type: "toggle", label, address, default: param.default as boolean };
  }
  if (type === "color") {
    return { type: "color", label, address, default: param.default as string };
  }
  if (param.values) {
    return { type: "select", label, address, values: param.values, default: param.default as string };
  }
  const range = param.range ?? [0, 1];
  return {
    type: "slider",
    label,
    address,
    min: range[0],
    max: range[1],
    step: sliderStep(range, type),
    default: param.default as number,
  };
}

// ── Core generator ────────────────────────────────────────────────────────────

type SectionId = "physics" | "params" | "effects";

const SECTION_TITLES: Record<SectionId, string> = {
  physics: "Physics",
  params:  "Parameters",
  effects: "Effects",
};

export function generateApi(moduleJson: RawModuleJson): ModuleApi {
  const { id, name, description, oscPrefix } = moduleJson;

  const oscParams:  OscParam[]       = [];
  const sections:   ControlSection[] = [];
  const baked:      BakedParam[]     = [];

  // Layout params are always baked (not OSC-controllable)
  for (const [pName, p] of Object.entries(moduleJson.layout ?? {})) {
    baked.push({
      name:        pName,
      value:       p.default,
      type:        inferType(p),
      description: p.description ?? "",
    });
  }

  // physics / params / effects
  for (const sectionId of ["physics", "params", "effects"] as SectionId[]) {
    const raw = moduleJson[sectionId] ?? {};
    const controls: ControlWidget[] = [];

    for (const [pName, p] of Object.entries(raw)) {
      const type    = inferType(p);
      const address = `/${oscPrefix}/${pName}`;

      if (p.osc === false) {
        baked.push({ name: pName, value: p.default, type, description: p.description ?? "" });
        continue;
      }

      const oscParam: OscParam = {
        address,
        name:        pName,
        label:       camelToLabel(pName),
        section:     sectionId,
        type,
        default:     p.default,
        description: p.description ?? "",
        ...(p.range ? { range: p.range } : {}),
      };
      oscParams.push(oscParam);
      controls.push(makeWidget(pName, p, address, type));
    }

    if (controls.length > 0) {
      sections.push({ id: sectionId, title: SECTION_TITLES[sectionId], controls });
    }
  }

  return { id, name, description, oscPrefix, oscParams, controller: sections, baked };
}

// ── Load from file ────────────────────────────────────────────────────────────

export function loadModule(moduleDirOrJsonPath: string): RawModuleJson {
  const p = moduleDirOrJsonPath.endsWith(".json")
    ? moduleDirOrJsonPath
    : join(moduleDirOrJsonPath, "module.json");
  return JSON.parse(readFileSync(resolve(p), "utf8")) as RawModuleJson;
}

export function generateApiFromPath(moduleDirOrJsonPath: string): ModuleApi {
  return generateApi(loadModule(moduleDirOrJsonPath));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("api-generator.ts") || process.argv[1]?.endsWith("api-generator.js")) {
  const modulePath = process.argv[2];
  if (!modulePath) {
    console.error("Usage: tsx src/modules/api-generator.ts <module-dir>");
    process.exit(1);
  }

  const api = generateApiFromPath(modulePath);

  const outPath = join(
    modulePath.endsWith(".json") ? modulePath.replace("module.json", "") : modulePath,
    "module.api.json"
  );
  writeFileSync(outPath, JSON.stringify(api, null, 2), "utf8");

  // Human-readable summary to stdout
  console.log(`\n${api.name}  (prefix: /${api.oscPrefix}/)\n`);
  console.log(`OSC addresses (${api.oscParams.length}):`);
  for (const p of api.oscParams) {
    const rangeStr = p.range ? `  [${p.range[0]} – ${p.range[1]}]` : "";
    console.log(`  ${p.address.padEnd(32)} ${p.type.padEnd(8)} default: ${String(p.default).padEnd(8)}${rangeStr}`);
  }
  console.log(`\nBaked (${api.baked.length}):`);
  for (const b of api.baked) {
    console.log(`  ${b.name.padEnd(20)} ${String(b.value)}`);
  }
  console.log(`\nController sections: ${api.controller.map(s => s.title).join(", ")}`);
  console.log(`\nWritten → ${outPath}`);
}
