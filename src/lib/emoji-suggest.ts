import data from "@emoji-mart/data";

export const DEFAULT_PRODUCT_EMOJI = "📦";

interface EmojiEntry {
  id: string;
  name: string;
  keywords: string[];
  skins: { native: string }[];
}

interface EmojiData {
  categories: { id: string; emojis: string[] }[];
  emojis: Record<string, EmojiEntry>;
}

// Common product-name words that emoji-mart's keywords don't cover well.
const SYNONYMS: Record<string, string> = {
  api: "electric_plug",
  app: "iphone",
  apps: "iphone",
  mobile: "iphone",
  ios: "iphone",
  android: "robot_face",
  web: "globe_with_meridians",
  website: "globe_with_meridians",
  site: "globe_with_meridians",
  docs: "books",
  documentation: "books",
  blog: "memo",
  marketing: "loudspeaker",
  sales: "chart_with_upwards_trend",
  analytics: "bar_chart",
  dashboard: "bar_chart",
  data: "floppy_disk",
  database: "file_cabinet",
  db: "file_cabinet",
  infra: "building_construction",
  infrastructure: "building_construction",
  ops: "gear",
  devops: "gear",
  backend: "gear",
  frontend: "art",
  design: "art",
  ui: "art",
  ux: "art",
  security: "lock",
  auth: "key",
  billing: "credit_card",
  payments: "credit_card",
  finance: "moneybag",
  support: "sos",
  ai: "robot_face",
  agent: "robot_face",
  agents: "robot_face",
  bot: "robot_face",
  cli: "computer",
  sdk: "hammer_and_wrench",
  tools: "hammer_and_wrench",
  tooling: "hammer_and_wrench",
  internal: "office",
  hr: "busts_in_silhouette",
  team: "busts_in_silhouette",
  community: "busts_in_silhouette",
  email: "email",
  newsletter: "email",
  chat: "speech_balloon",
  search: "mag",
  shop: "shopping_trolley",
  store: "shopping_trolley",
  ecommerce: "shopping_trolley",
  launch: "rocket",
  research: "microscope",
  video: "movie_camera",
  music: "musical_note",
  game: "video_game",
  games: "video_game",
  fitness: "muscle",
  workout: "muscle",
  travel: "airplane",
  health: "stethoscope",
};

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "to", "in", "on", "my", "our", "your",
  "with", "by", "at", "or", "v1", "v2", "v3", "new", "project", "product",
]);

// Categories that produce poor matches for product names (e.g. country flags).
const EXCLUDED_CATEGORIES = new Set(["flags"]);

const typed = data as unknown as EmojiData;
const excludedIds = new Set(
  typed.categories.filter((c) => EXCLUDED_CATEGORIES.has(c.id)).flatMap((c) => c.emojis)
);

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function variants(token: string): string[] {
  const out = [token];
  if (token.length > 3 && token.endsWith("ies")) out.push(token.slice(0, -3) + "y");
  else if (token.length > 3 && token.endsWith("es")) out.push(token.slice(0, -2), token.slice(0, -1));
  else if (token.length > 3 && token.endsWith("s")) out.push(token.slice(0, -1));
  return out;
}

function scoreEmoji(emoji: EmojiEntry, token: string): number {
  const nameWords = tokenize(emoji.name);
  const idWords = emoji.id.split(/[_-]/);
  const keywords = emoji.keywords.map((k) => k.toLowerCase());

  let best = 0;
  for (const v of variants(token)) {
    if (emoji.id === v || emoji.name.toLowerCase() === v) best = Math.max(best, 10);
    else if (nameWords.includes(v) || idWords.includes(v)) best = Math.max(best, 6 - Math.min(nameWords.length, 4));
    else if (keywords.includes(v)) best = Math.max(best, 3);
    else if (v.length >= 4 && keywords.some((k) => k.startsWith(v))) best = Math.max(best, 1);
  }
  return best;
}

/**
 * Pick an emoji that fits a product name by searching emoji names and
 * keywords. Falls back to 📦 when nothing matches.
 */
export function suggestEmoji(name: string): string {
  const tokens = tokenize(name);
  if (tokens.length === 0) return DEFAULT_PRODUCT_EMOJI;

  const scores = new Map<string, number>();
  tokens.forEach((token, i) => {
    // Earlier words in the name weigh slightly more.
    const weight = 1 + (tokens.length - i) * 0.1;
    for (const v of variants(token)) {
      const synonym = SYNONYMS[v];
      if (synonym && typed.emojis[synonym]) {
        scores.set(synonym, (scores.get(synonym) ?? 0) + 8 * weight);
        break;
      }
    }
    for (const emoji of Object.values(typed.emojis)) {
      if (excludedIds.has(emoji.id)) continue;
      const s = scoreEmoji(emoji, token);
      if (s > 0) scores.set(emoji.id, (scores.get(emoji.id) ?? 0) + s * weight);
    }
  });

  let bestId: string | null = null;
  let bestScore = 0;
  for (const [id, score] of scores) {
    if (score > bestScore) {
      bestId = id;
      bestScore = score;
    }
  }

  return (bestId && typed.emojis[bestId]?.skins[0]?.native) || DEFAULT_PRODUCT_EMOJI;
}
