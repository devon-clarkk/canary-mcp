import { randomInt } from "node:crypto";

/**
 * Adjectives + scientist/engineer surnames, combined Docker-style into
 * two-word tags (e.g. "vigilant-curie"). Large enough pool that visual
 * repetition across turns is rare without being a security boundary.
 */
export const ADJECTIVES: string[] = [
  "vigilant", "stoic", "lucid", "tenacious", "wry", "restless", "candid",
  "brisk", "earnest", "placid", "dogged", "keen", "wistful", "blunt",
  "nimble", "steadfast", "guarded", "frank", "patient", "curious",
  "sober", "wary", "deliberate", "quiet", "stark", "alert", "spry",
  "thorough", "measured", "resolute", "sharp", "calm", "diligent",
  "watchful", "exacting", "plain", "rigorous", "attentive", "level",
  "methodical", "unhurried", "precise", "grounded", "lean", "austere",
  "composed", "discerning", "meticulous", "sturdy", "clear", "honest",
  "deft", "tireless", "even", "subtle", "terse", "wakeful", "prudent",
  "steady", "rugged", "skeptical", "perceptive", "spare", "intent",
  "observant", "weathered", "stalwart", "lively", "crisp", "veiled",
  "faithful",
];

export const NOUNS: string[] = [
  "curie", "turing", "lovelace", "hopper", "tesla", "noether", "darwin",
  "newton", "faraday", "maxwell", "bohr", "feynman", "einstein", "hawking",
  "franklin", "mendel", "pasteur", "kepler", "galileo", "copernicus",
  "babbage", "shannon", "knuth", "dijkstra", "ritchie", "torvalds",
  "wozniak", "lamarr", "engelbart", "kay", "hamilton", "carson",
  "goodall", "sagan", "tyson", "shockley", "euler", "gauss", "fermat",
  "pascal", "leibniz", "boole", "venn", "fourier", "laplace", "lagrange",
  "tukey", "fisher", "nightingale", "mcclintock", "bardeen", "watson",
  "crick", "mendeleev", "rutherford", "planck", "schrodinger", "dirac",
  "heisenberg", "fermi", "oppenheimer", "vonneumann", "church", "kleene",
  "lamport", "liskov", "perlman", "goldwasser", "yao", "hertz", "ampere",
  "volta", "ohm", "watt",
];

/**
 * Generates a random "adjective-noun" key, e.g. "vigilant-curie".
 */
export function randomTag(): string {
  const adjective = ADJECTIVES[randomInt(ADJECTIVES.length)];
  const noun = NOUNS[randomInt(NOUNS.length)];
  return `${adjective}-${noun}`;
}
