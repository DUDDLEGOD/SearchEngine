import natural from "natural";
import { removeStopwords } from "stopword";

const stemmer = natural.PorterStemmer;

export function preprocess(text: string): string[] {
  if (!text) return [];

  // Normalize
  text = text.toLowerCase();

  // Remove special characters
  text = text.replace(/[^a-z0-9\s]/g, " ");

  // Tokenize
  let tokens = text.split(/\s+/).filter(Boolean);

  // Remove stopwords
  tokens = removeStopwords(tokens);

  // Stem
  tokens = tokens.map(t => stemmer.stem(t));

  return tokens;
}
