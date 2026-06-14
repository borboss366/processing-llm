import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAG_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../rag"
);
const SKETCHES_DIR = path.join(RAG_DIR, "sketches");
const CATALOG_FILE = path.join(RAG_DIR, "catalog.json");

type CatalogEntry = {
  file: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
};

let _catalog: CatalogEntry[] | null = null;

function catalog(): CatalogEntry[] {
  if (!_catalog) {
    _catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, "utf8"));
  }
  return _catalog!;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function score(entry: CatalogEntry, queryTokens: string[]): number {
  let s = 0;
  const nameLower = entry.name.toLowerCase();
  const descLower = entry.description.toLowerCase();
  const catLower = entry.category.toLowerCase();

  for (const tok of queryTokens) {
    if (nameLower.includes(tok)) s += 4;
    if (entry.tags.includes(tok)) s += 3;
    if (catLower.includes(tok)) s += 2;
    if (descLower.includes(tok)) s += 1;
  }
  return s;
}

export function retrieveExamples(
  userDescription: string,
  topN = 3
): string[] {
  const tokens = tokenize(userDescription);
  if (!tokens.length) return [];

  const scored = catalog()
    .map((entry) => ({ entry, s: score(entry, tokens) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topN);

  return scored.map(({ entry }) => {
    const code = fs.readFileSync(path.join(SKETCHES_DIR, entry.file), "utf8");
    return `// Example: ${entry.name} [${entry.category}]\n// ${entry.description}\n\n${code}`;
  });
}
