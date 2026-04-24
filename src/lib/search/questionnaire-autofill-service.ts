'use client';

import type { ActiveSearchTool, SearchToolConfig } from '@/types';
import type { SearchResult, QuestionnaireAutoFillResult } from './search-types';
import { searchBrave } from './brave-search';
import { searchFirecrawl } from './firecrawl-search';
import { callLLMDirectFull, type LLMCallOptions } from '@/lib/agents/llm-client';

export type AutoFillStepId =
  | 'search_query' | 'llm_synthesis' | 'parse_result'
  | 'build_queries' | 'execute_search' | 'deduplicate';

export type StepStatus = 'done' | 'active' | 'pending' | 'failed';

interface AutoFillOptions {
  characterName: string;
  workName: string;
  activeTool: ActiveSearchTool;
  toolConfig?: SearchToolConfig;
  decryptedApiKey?: string;
  whitelist: string[];
  llmOptions: LLMCallOptions;
  onProgress?: (message: string) => void;
  onStepChange?: (stepId: AutoFillStepId, status: StepStatus) => void;
}

export const AUTOFILL_STEPS_LLM: AutoFillStepId[] = ['search_query', 'llm_synthesis', 'parse_result'];
export const AUTOFILL_STEPS_EXTERNAL: AutoFillStepId[] = ['build_queries', 'execute_search', 'deduplicate', 'llm_synthesis', 'parse_result'];

export async function autoFillQuestionnaire(
  options: AutoFillOptions,
): Promise<QuestionnaireAutoFillResult> {
  const { activeTool, characterName, workName, onProgress, onStepChange } = options;

  if (activeTool === 'llm-native') {
    onStepChange?.('search_query', 'active');
    onProgress?.('正在以英名召唤，感知 TA 的灵魂轮廓…');
    onStepChange?.('search_query', 'done');
    onStepChange?.('llm_synthesis', 'active');
    const result = await autoFillViaLLMNative(options);
    onStepChange?.('llm_synthesis', 'done');
    onStepChange?.('parse_result', 'active');
    onStepChange?.('parse_result', 'done');
    return result;
  }

  onStepChange?.('build_queries', 'active');
  onProgress?.('正在搜寻 TA 在这个世界的痕迹…');
  onStepChange?.('build_queries', 'done');
  onStepChange?.('execute_search', 'active');
  const results = await gatherSearchResults(options);
  onStepChange?.('execute_search', 'done');
  onStepChange?.('deduplicate', 'active');
  onStepChange?.('deduplicate', 'done');

  onStepChange?.('llm_synthesis', 'active');
  onProgress?.('正在解读 TA 的人格特征…');
  const synthesized = await synthesizeAutoFill(characterName, workName, results, options.llmOptions);
  onStepChange?.('llm_synthesis', 'done');
  onStepChange?.('parse_result', 'active');
  onStepChange?.('parse_result', 'done');
  return synthesized;
}

async function autoFillViaLLMNative(
  options: AutoFillOptions,
): Promise<QuestionnaireAutoFillResult> {
  const { characterName, workName, llmOptions, whitelist } = options;

  const whitelistHint = whitelist.length > 0
    ? `\nReference sites for accuracy: ${whitelist.slice(0, 5).join(', ')}`
    : '';

  const prompt = buildAutoFillPrompt(characterName, workName, whitelistHint);

  const result = await callLLMDirectFull(
    [
      { role: 'system', content: 'You are a fictional character expert. Your task is to fill out a character profile questionnaire based on your knowledge. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ],
    { ...llmOptions, temperature: 0.3 },
  );

  return parseAutoFillResponse(result, characterName, workName);
}

async function gatherSearchResults(options: AutoFillOptions): Promise<SearchResult[]> {
  const { characterName, workName, activeTool, decryptedApiKey, toolConfig, whitelist } = options;

  if (!decryptedApiKey) throw new Error('Search API key required');

  const siteFilter = whitelist.length > 0
    ? ` site:${whitelist.slice(0, 3).join(' OR site:')}`
    : '';

  const queries = [
    `"${characterName}" "${workName}" character profile personality${siteFilter}`,
    `"${characterName}" "${workName}" quotes speech style emotional reactions${siteFilter}`,
  ];

  const allResults: SearchResult[] = [];
  for (const query of queries) {
    const outcome = activeTool === 'brave'
      ? await searchBrave(query, decryptedApiKey, { count: 5 })
      : await searchFirecrawl(query, decryptedApiKey, toolConfig?.baseURL, { limit: 3 });

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

async function synthesizeAutoFill(
  characterName: string,
  workName: string,
  results: SearchResult[],
  llmOptions: LLMCallOptions,
): Promise<QuestionnaireAutoFillResult> {
  const context = results
    .map((r) => `### ${r.title}\n${r.content || r.snippet}`)
    .join('\n\n')
    .slice(0, 30000);

  const prompt = buildAutoFillPrompt(characterName, workName, `\n\n--- Web Search Results ---\n\n${context}`);

  const result = await callLLMDirectFull(
    [
      { role: 'system', content: 'You are a fictional character analyst. Extract character data from search results and fill out a profile questionnaire. Always respond with valid JSON.' },
      { role: 'user', content: prompt },
    ],
    { ...llmOptions, temperature: 0.3 },
  );

  return parseAutoFillResponse(result, characterName, workName);
}

function buildAutoFillPrompt(characterName: string, workName: string, extraContext: string): string {
  return `Fill out this character profile questionnaire for "${characterName}" from "${workName}".${extraContext}

Respond with a JSON object matching this exact structure. Use the SAME language as the character/work name for all values. If unsure about a field, use your best guess or leave the string empty.

{
  "step1": {
    "name": "${characterName}",
    "gender": "(character's gender)",
    "approximateAge": "(age or age range, e.g. '17' or '成年')",
    "culturalBackground": "(cultural context)",
    "primaryLanguages": ["(languages the character speaks)"],
    "appearanceDescription": "(physical appearance description)",
    "voiceDescription": "(voice characteristics)",
    "fictionalWorkName": "${workName}",
    "fictionalGenre": "(genre: anime, game, novel, etc.)",
    "fictionalStoryBackground": "(story setting and background)",
    "fictionalRolePosition": "(protagonist, antagonist, side character, etc.)",
    "fictionalSource": "(original, adaptation, etc.)",
    "fictionalSceneOrQuote": "(iconic scene or memorable quote)"
  },
  "step2": {
    "personalityKeywords": ["(5-8 personality trait keywords)"],
    "speechStyle": {
      "formality": "(formal|casual|mixed)",
      "verbosity": "(talkative|concise|balanced)",
      "directness": "(direct|indirect|mixed)"
    },
    "coreValues": ["(1-3 core values)"],
    "catchphrases": ["(notable catchphrases or verbal habits)"]
  },
  "step3": {
    "emotionalReactions": {
      "whenHappy": "(how the character expresses happiness)",
      "whenAngry": "(how the character expresses anger)",
      "whenHurt": "(how the character behaves when hurt)"
    },
    "tabooTopics": ["(topics the character avoids)"],
    "typicalMood": "(general mood/demeanor)"
  }
}`;
}

function parseAutoFillResponse(
  raw: string,
  characterName: string,
  workName: string,
): QuestionnaireAutoFillResult {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return fallbackResult(characterName, workName);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const step1 = parsed.step1 || {};
    const step2 = parsed.step2 || {};
    const step3 = parsed.step3 || {};

    return {
      step1: {
        name: step1.name || characterName,
        gender: step1.gender || '',
        approximateAge: step1.approximateAge || '',
        culturalBackground: step1.culturalBackground || '',
        primaryLanguages: Array.isArray(step1.primaryLanguages) ? step1.primaryLanguages : [],
        appearanceDescription: step1.appearanceDescription || undefined,
        voiceDescription: step1.voiceDescription || undefined,
        fictionalWorkName: step1.fictionalWorkName || workName,
        fictionalGenre: step1.fictionalGenre || undefined,
        fictionalStoryBackground: step1.fictionalStoryBackground || undefined,
        fictionalRolePosition: step1.fictionalRolePosition || undefined,
        fictionalSource: step1.fictionalSource || undefined,
        fictionalSceneOrQuote: step1.fictionalSceneOrQuote || undefined,
      },
      step2: {
        personalityKeywords: Array.isArray(step2.personalityKeywords) ? step2.personalityKeywords : [],
        speechStyle: {
          formality: validateEnum(step2.speechStyle?.formality, ['formal', 'casual', 'mixed'], 'casual'),
          verbosity: validateEnum(step2.speechStyle?.verbosity, ['talkative', 'concise', 'balanced'], 'balanced'),
          directness: validateEnum(step2.speechStyle?.directness, ['direct', 'indirect', 'mixed'], 'mixed'),
        },
        coreValues: Array.isArray(step2.coreValues) ? step2.coreValues : [],
        catchphrases: Array.isArray(step2.catchphrases) ? step2.catchphrases : [],
      },
      step3: {
        emotionalReactions: {
          whenHappy: step3.emotionalReactions?.whenHappy || '',
          whenAngry: step3.emotionalReactions?.whenAngry || '',
          whenHurt: step3.emotionalReactions?.whenHurt || '',
        },
        tabooTopics: Array.isArray(step3.tabooTopics) ? step3.tabooTopics : [],
        typicalMood: step3.typicalMood || '',
      },
    };
  } catch {
    return fallbackResult(characterName, workName);
  }
}

function validateEnum<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  return fallback;
}

function fallbackResult(
  characterName: string,
  workName: string,
): QuestionnaireAutoFillResult {
  return {
    step1: { name: characterName, fictionalWorkName: workName },
    step2: {},
    step3: {},
  };
}
