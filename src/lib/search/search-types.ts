import type { QuestionnaireStep1, QuestionnaireStep2, QuestionnaireStep3, TextMaterial } from '@/types';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  content?: string;
  extraSnippets?: string[];
}

export type SearchOutcome =
  | { success: true; results: SearchResult[] }
  | { success: false; error: string };

export const DIMENSIONAL_BREAK_DIMENSIONS = [
  'worldview',
  'biography',
  'dialogue',
  'relationships',
  'appearance',
  'memes',
  'archetypes',
  'trivia',
  'taboos',
  'metaInfo',
] as const;

export type DimensionKey = typeof DIMENSIONAL_BREAK_DIMENSIONS[number];

export interface DimensionResult {
  key: DimensionKey;
  content: string;
}

export interface DimensionalBreakResult {
  dimensions: DimensionResult[];
  sources: SearchResult[];
  rawContent: string;
}

export interface QuestionnaireAutoFillResult {
  step1: Partial<QuestionnaireStep1>;
  step2: Partial<QuestionnaireStep2>;
  step3: Partial<QuestionnaireStep3>;
}

export function dimensionalBreakToTextMaterial(
  result: DimensionalBreakResult,
  characterName: string,
  workName: string,
): TextMaterial {
  const content = result.dimensions
    .map((d) => `## ${dimensionLabel(d.key)}\n\n${d.content}`)
    .join('\n\n---\n\n');

  const sourcesSection = result.sources.length > 0
    ? `\n\n---\n\n## Sources\n\n${result.sources.map((s) => `- [${s.title}](${s.url})`).join('\n')}`
    : '';

  return {
    id: `web-search-${Date.now()}`,
    filename: `dimensional-break-${characterName}-${workName}.md`,
    content: content + sourcesSection,
    detectedLanguage: 'und',
    detectedLanguageLabel: 'Auto',
    fileSize: new Blob([content + sourcesSection]).size,
    charCount: (content + sourcesSection).length,
    importedAt: new Date().toISOString(),
  };
}

export function dimensionLabel(key: DimensionKey): string {
  const labels: Record<DimensionKey, string> = {
    worldview: '世界观与力量体系 / Worldview & Power System',
    biography: '完整传记与角色弧光 / Biography & Character Arc',
    dialogue: '原作对话与语言风格 / Dialogue & Language Style',
    relationships: '角色关系网 / Character Relationships',
    appearance: '外貌与标志性视觉要素 / Appearance & Iconic Visuals',
    memes: '梗、名场面与文化符号 / Memes, Iconic Scenes & Cultural Symbols',
    archetypes: '原型与角色定型 / Archetypes & Tropes',
    trivia: '琐事与冷知识 / Trivia & Lesser-Known Facts',
    taboos: '情感禁区与行为边界 / Emotional Taboos & Behavioral Boundaries',
    metaInfo: '作品元信息与版本 / Work Meta-Info & Timeline',
  };
  return labels[key];
}
