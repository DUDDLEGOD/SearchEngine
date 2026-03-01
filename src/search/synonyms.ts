const SYNONYMS: Record<string, string[]> = {
  search: ["find", "lookup", "query"],
  engine: ["system", "platform"],
  machine: ["automated"],
  learning: ["education", "training"],
  recipe: ["cook", "cooking", "meal"],
  ai: ["artificial", "intelligence"],
  python: ["py"],
};

export function getSynonyms(term: string): string[] {
  return SYNONYMS[term] ?? [];
}
