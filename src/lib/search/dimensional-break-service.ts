'use client';

import type { ActiveSearchTool, SearchToolConfig } from '@/types';
import type {
  SearchResult,
  DimensionalBreakResult,
  DimensionKey,
  DimensionResult,
} from './search-types';
import { DIMENSIONAL_BREAK_DIMENSIONS, dimensionLabel } from './search-types';
import { searchBrave } from './brave-search';
import { searchFirecrawl } from './firecrawl-search';
import { callLLMDirectFull, type LLMCallOptions } from '@/lib/agents/llm-client';

export type DimBreakStepId =
  | 'invoke_llm' | 'parse_dimensions'
  | 'build_queries' | 'execute_search' | 'deduplicate' | 'llm_synthesis';

export type StepStatus = 'done' | 'active' | 'pending' | 'failed';

export const DIMBREAK_STEPS_LLM: DimBreakStepId[] = ['invoke_llm', 'parse_dimensions'];
export const DIMBREAK_STEPS_EXTERNAL: DimBreakStepId[] = ['build_queries', 'execute_search', 'deduplicate', 'llm_synthesis', 'parse_dimensions'];

interface DimensionalBreakOptions {
  characterName: string;
  workName: string;
  activeTool: ActiveSearchTool;
  toolConfig?: SearchToolConfig;
  decryptedApiKey?: string;
  whitelist: string[];
  llmOptions: LLMCallOptions;
  onProgress?: (message: string) => void;
  onStepChange?: (stepId: DimBreakStepId, status: StepStatus) => void;
}

export async function executeDimensionalBreak(
  options: DimensionalBreakOptions,
): Promise<DimensionalBreakResult> {
  const { activeTool, characterName, workName, onProgress, onStepChange } = options;

  if (activeTool === 'llm-native') {
    onStepChange?.('invoke_llm', 'active');
    const result = await executeLLMNativeSearch(options);
    onStepChange?.('invoke_llm', 'done');
    onStepChange?.('parse_dimensions', 'active');
    onStepChange?.('parse_dimensions', 'done');
    return result;
  }

  onStepChange?.('build_queries', 'active');
  onProgress?.('正在穿越次元壁，搜寻 TA 的踪迹…');
  onStepChange?.('build_queries', 'done');
  onStepChange?.('execute_search', 'active');
  const allResults = await executeExternalSearch(options);
  onStepChange?.('execute_search', 'done');
  onStepChange?.('deduplicate', 'active');
  onStepChange?.('deduplicate', 'done');

  onStepChange?.('llm_synthesis', 'active');
  onProgress?.('正在解析来自异世界的信息碎片…');
  const dimensions = await synthesizeWithLLM(
    characterName,
    workName,
    allResults,
    options.llmOptions,
  );
  onStepChange?.('llm_synthesis', 'done');
  onStepChange?.('parse_dimensions', 'active');
  onStepChange?.('parse_dimensions', 'done');

  return {
    dimensions,
    sources: allResults,
    rawContent: allResults.map((r) => `# ${r.title}\n${r.content || r.snippet}`).join('\n\n---\n\n'),
  };
}

async function executeLLMNativeSearch(
  options: DimensionalBreakOptions,
): Promise<DimensionalBreakResult> {
  const { characterName, workName, llmOptions, whitelist, onProgress } = options;

  onProgress?.('正在召唤灵魂共鸣，感知 TA 的存在…');

  const whitelistHint = whitelist.length > 0
    ? `\n\nThe user has configured preferred reference sites: ${whitelist.join(', ')}. Prioritize information commonly found on these types of sources.`
    : '';

  const prompt = `You are a character research specialist. Research the fictional character "${characterName}" from the work "${workName}" and provide detailed information across the following 10 dimensions. For each dimension, provide as much specific detail as possible. If you are uncertain about any information, note your confidence level.${whitelistHint}

Respond in the SAME LANGUAGE as the character name and work name (if they are in Chinese, respond in Chinese; if in English, respond in English; etc.).

Format your response as follows — use exactly these section headers:

## 1. ${dimensionLabel('worldview')}
(Describe the world's rules, power systems, magic/technology, societal structures)

## 2. ${dimensionLabel('biography')}
(Complete character biography: origin, key events, character arc, core wound, growth trajectory)

## 3. ${dimensionLabel('dialogue')}
(Actual quotes, catchphrases, speech patterns, verbal tics, typical sentence structures)

## 4. ${dimensionLabel('relationships')}
(Key relationships: allies, enemies, mentors, love interests — describe dynamics and how they speak to each other)

## 5. ${dimensionLabel('appearance')}
(Physical description, iconic outfit, signature accessories, visual trademarks)

## 6. ${dimensionLabel('memes')}
(Famous scenes, memes, viral moments, cultural references associated with this character)

## 7. ${dimensionLabel('archetypes')}
(Character archetypes, TV Tropes, narrative role, common character comparisons)

## 8. ${dimensionLabel('trivia')}
(Lesser-known facts, behind-the-scenes info, cross-media differences, easter eggs)

## 9. ${dimensionLabel('taboos')}
(Topics the character avoids, emotional triggers, behavioral boundaries, things they would NEVER do)

## 10. ${dimensionLabel('metaInfo')}
(Work publication/release info, different versions/adaptations, timeline context, canonical vs non-canonical)`;

  const result = await callLLMDirectFull(
    [
      { role: 'system', content: 'You are a comprehensive fictional character research assistant.' },
      { role: 'user', content: prompt },
    ],
    llmOptions,
  );

  onProgress?.('正在编织来自另一个世界的记忆…');

  const dimensions = parseDimensionSections(result);

  return {
    dimensions,
    sources: [],
    rawContent: result,
  };
}

async function executeExternalSearch(
  options: DimensionalBreakOptions,
): Promise<SearchResult[]> {
  const { characterName, workName, activeTool, decryptedApiKey, toolConfig, whitelist } = options;

  if (!decryptedApiKey) {
    throw new Error('Search API key is required for external search');
  }

  const siteFilter = whitelist.length > 0
    ? ` site:${whitelist.slice(0, 5).join(' OR site:')}`
    : '';

  const queries = [
    `"${characterName}" "${workName}" character wiki biography${siteFilter}`,
    `"${characterName}" "${workName}" personality quotes dialogue${siteFilter}`,
    `"${characterName}" "${workName}" relationships abilities${siteFilter}`,
    `"${characterName}" "${workName}" memes trivia tropes${siteFilter}`,
  ];

  const allResults: SearchResult[] = [];

  for (const query of queries) {
    let outcome;
    if (activeTool === 'brave') {
      outcome = await searchBrave(query, decryptedApiKey, { count: 5 });
    } else {
      outcome = await searchFirecrawl(
        query,
        decryptedApiKey,
        toolConfig?.baseURL,
        { limit: 3 },
      );
    }

    if (outcome.success) {
      allResults.push(...outcome.results);
    }
  }

  const seen = new Set<string>();
  return allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

async function synthesizeWithLLM(
  characterName: string,
  workName: string,
  results: SearchResult[],
  llmOptions: LLMCallOptions,
): Promise<DimensionResult[]> {
  const contextChunks = results
    .map((r) => `### ${r.title} (${r.url})\n${r.content || r.snippet}`)
    .join('\n\n');

  const truncated = contextChunks.slice(0, 40000);

  const prompt = `Based on the following web search results about the fictional character "${characterName}" from "${workName}", synthesize the information into these 10 dimensions. Respond in the same language as the character/work name.

Use exactly these section headers:

## 1. 世界观与力量体系
## 2. 完整传记与角色弧光
## 3. 原作对话与语言风格
## 4. 角色关系网
## 5. 外貌与标志性视觉要素
## 6. 梗、名场面与文化符号
## 7. 原型与角色定型
## 8. 琐事与冷知识
## 9. 情感禁区与行为边界
## 10. 作品元信息与版本

--- Search Results ---

${truncated}`;

  const result = await callLLMDirectFull(
    [
      { role: 'system', content: 'You are a character information synthesis specialist. Organize raw web data into structured character profiles.' },
      { role: 'user', content: prompt },
    ],
    llmOptions,
  );

  return parseDimensionSections(result);
}

function parseDimensionSections(text: string): DimensionResult[] {
  const dimensionKeys: DimensionKey[] = [...DIMENSIONAL_BREAK_DIMENSIONS];

  // RLX-ESL-02 (SU-092-batch1): single greedy group, no nested quantifiers,
  // input is already bounded LLM-produced outline text — safe-regex false positive.
  // eslint-disable-next-line security/detect-unsafe-regex
  const sectionPattern = /##\s*(?:\d+\.\s*)?(.+)/g;
  // SU-ITER-090c · P2-09 — track full-match end index so the content slice
  // starts exactly after the matched header line, not after a hand-rolled
  // `header.length + 3` offset (which mis-accounts for `##`, the optional
  // numeric prefix `1. `, and any `\s*` variation, lopping off the leading
  // chars of the first content line when the numeric prefix is absent or
  // the whitespace is wider than one space).
  const matches: { index: number; endIndex: number; header: string }[] = [];
  let match;
  while ((match = sectionPattern.exec(text)) !== null) {
    matches.push({
      index: match.index,
      endIndex: match.index + match[0].length,
      header: match[1].trim(),
    });
  }

  if (matches.length === 0) {
    return [{ key: 'biography', content: text.trim() }];
  }

  const sections: DimensionResult[] = [];
  const keywordMap: Record<string, DimensionKey> = {
    '世界观': 'worldview', 'worldview': 'worldview', 'power system': 'worldview',
    '传记': 'biography', 'biography': 'biography', 'character arc': 'biography',
    '对话': 'dialogue', 'dialogue': 'dialogue', 'language style': 'dialogue',
    '关系': 'relationships', 'relationship': 'relationships',
    '外貌': 'appearance', 'appearance': 'appearance', 'visual': 'appearance',
    '梗': 'memes', 'meme': 'memes', 'iconic': 'memes', '名场面': 'memes',
    '原型': 'archetypes', 'archetype': 'archetypes', 'trope': 'archetypes',
    '琐事': 'trivia', 'trivia': 'trivia', '冷知识': 'trivia',
    '禁区': 'taboos', 'taboo': 'taboos', '边界': 'taboos',
    '元信息': 'metaInfo', 'meta': 'metaInfo', '版本': 'metaInfo', 'timeline': 'metaInfo',
  };

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].endIndex;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const content = text.slice(start, end).trim();

    const headerLower = matches[i].header.toLowerCase();
    let key: DimensionKey = dimensionKeys[i] || 'biography';

    for (const [keyword, dimKey] of Object.entries(keywordMap)) {
      if (headerLower.includes(keyword)) {
        key = dimKey;
        break;
      }
    }

    if (content) {
      sections.push({ key, content });
    }
  }

  return sections;
}
