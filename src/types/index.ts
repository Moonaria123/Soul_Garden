// ============================================================
// Soul Upload — V1.0 Type Definitions
// Aligned with BRD v1.3 / DEV v1.3 / Roadmap v1.2
// ============================================================

// --- Account & Auth (FR-410) ---

export interface UserAccount {
  id: string;
  username: string;
  /**
   * Argon2id hash — NEVER store plaintext passwords.
   *
   * Optional on the client because post-login `currentUser` never
   * holds password material (the server owns it now, SU-ITER-089
   * P1-1 B8-4).  Still populated transiently during the local
   * registration flow before the server round-trip.
   */
  passwordHash?: string;
  /**
   * Random salt for Argon2id.
   *
   * Same lifecycle as `passwordHash`: only present during the
   * in-flight registration flow; absent from every post-login
   * `currentUser` value the UI ever reads.
   */
  salt?: string;
  /** Optional display email (local only, no server verification) */
  email?: string;
  /** Consecutive failed login attempts */
  failedAttempts: number;
  /** ISO timestamp — locked until this time if failedAttempts >= threshold */
  lockUntil: string | null;
  createdAt: string;
}

export const AUTH_CONSTANTS = {
  MAX_FAILED_ATTEMPTS: 5,
  LOCKOUT_DURATION_MS: 15 * 60 * 1000, // 15 minutes
  IDLE_TIMEOUT_MS: 30 * 60 * 1000, // legacy fallback — superseded by SessionSettings
  IDLE_WARNING_MS: 2 * 60 * 1000, // legacy fallback
} as const;

// SU-087: user-configurable session behavior.
export interface SessionSettings {
  /** Auto-logout on idle timeout. Default: true */
  autoLogoutEnabled: boolean;
  /** Idle wait before auto-logout, in minutes. Default: 5 */
  idleTimeoutMinutes: number;
  /**
   * Persist the client DEK into sessionStorage so the user stays
   * fully functional across page refreshes in the same tab.
   * Closing the tab clears it. Default: false (re-unlock on demand).
   */
  persistDEKThisTab: boolean;
}

export const SESSION_SETTINGS_DEFAULTS: SessionSettings = {
  autoLogoutEnabled: true,
  idleTimeoutMinutes: 5,
  persistDEKThisTab: false,
};

export const SESSION_SETTINGS_LIMITS = {
  idleTimeoutMinutesMin: 1,
  idleTimeoutMinutesMax: 120,
} as const;

// --- LLM Provider & Model (FR-401/402/411) ---

export type ApiType = 'openai' | 'anthropic' | 'openai-compatible';

export interface LLMProvider {
  id: string;
  name: string;
  baseURL: string;
  /** Encrypted with DEK — NEVER stored as plaintext (FR-411) */
  encryptedApiKey: string;
  /** IV used for API key encryption */
  apiKeyIV: string;
  /** API protocol type — determines auth header strategy */
  apiType: ApiType;
  /** Whether this provider is enabled for use */
  enabled: boolean;
  models: ModelInfo[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  /** User-friendly alias (e.g. "GPT-4o" for "gpt-4o-2024-08-06") */
  alias?: string;
  /** Context window size in tokens */
  contextWindow?: number;
  /** Cost per 1M input tokens (USD) — data model only, UI hidden in V1.0 */
  inputCost?: number;
  /** Cost per 1M output tokens (USD) — data model only, UI hidden in V1.0 */
  outputCost?: number;
  /** Whether this model is enabled for selection */
  enabled?: boolean;
  /** Whether this model supports extended thinking */
  supportsThinking?: boolean;
  /** Whether this model supports vision/image input */
  supportsVision?: boolean;
  /** V1.2: Whether this model supports web search */
  supportsWebSearch?: boolean;
  capabilities: ModelCapabilities;
}

export interface ModelCapabilities {
  text: boolean;
  vision: boolean;
  thinking: boolean;
  /** V1.2: Web search capability */
  webSearch: boolean;
}

export interface ModelConfig {
  modelId: string;
  providerId: string;
  temperature: number; // 0-2, default 0.8
  thinkingEnabled: boolean;
  thinkingDepth: ThinkingDepth;
  thinkingBudget?: number; // Vendor-specific budget (Anthropic: min 1024, DashScope: thinking_budget)
  visionEnabled?: boolean;
  webSearchEnabled?: boolean;
}

export type ThinkingDepth = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// --- Text Material (V1.1 Sprint 2 — FR-103a MD/TXT import) ---

export interface TextMaterial {
  id: string;
  filename: string;
  /** Raw text content (truncated to TEXT_MATERIAL_MAX_CHARS) */
  content: string;
  /** Detected primary language ISO 639-3 code (via franc) */
  detectedLanguage: string;
  /** Human-readable language label */
  detectedLanguageLabel: string;
  /** Original file size in bytes */
  fileSize: number;
  /** Character count of extracted text */
  charCount: number;
  importedAt: string;
}

export const TEXT_MATERIAL_CONSTANTS = {
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5 MB
  MAX_CHARS: 50_000,
  MAX_FILES_PER_ENTITY: 10,
  ACCEPTED_EXTENSIONS: ['.md', '.txt'] as const,
  ACCEPTED_MIME_TYPES: ['text/plain', 'text/markdown', 'text/x-markdown'] as const,
} as const;

export const IM_MATERIAL_CONSTANTS = {
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024, // 50 MB per BRD FR-103a
  MAX_CHARS: 50_000,
  MAX_FILES_PER_ENTITY: 10,
  ACCEPTED_EXTENSIONS: ['.html', '.htm', '.txt', '.docx', '.mht', '.mhtml'] as const,
  ACCEPTED_MIME_TYPES: [
    'text/html',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'message/rfc822',
    'multipart/related',
  ] as const,
} as const;

// --- Web Search Configuration (V1.2 — Centralized Search) ---

export type ActiveSearchTool = 'llm-native' | 'brave' | 'firecrawl';
export type SearchToolType = 'brave' | 'firecrawl';
export type WebSearchWhitelistCategory = 'fictionalSummon' | 'worldEye';

export interface SearchToolConfig {
  id: string;
  type: SearchToolType;
  name: string;
  encryptedApiKey: string;
  apiKeyIV: string;
  baseURL?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebSearchSettings {
  activeTool: ActiveSearchTool;
  toolConfigs: SearchToolConfig[];
  whitelists: Record<WebSearchWhitelistCategory, string[]>;
  // SU-ITER-094 · Phase-C (declared in Phase-B for schema stability) —
  // how many tool-calling loops the chat route is allowed to run per
  // user turn when a non-native search tool is selected.  Higher values
  // let the model chase follow-up queries; lower values cap token cost.
  // UI exposes a 1–10 slider; default 3.
  maxToolIterations: number;
}

// --- Consciousness Entity (FR-101/105/106) ---

export type EntityType = 'fictional' | 'real_person' | 'custom';
export type EntityStatus = 'draft' | 'extracting' | 'ready' | 'error';

export interface ConsciousnessEntity {
  id: string;
  name: string;
  type: EntityType;
  /** URL to avatar image or null for default */
  avatarUrl?: string;
  /** Per-entity chat background image (data URL, locally encrypted) — SU-ITER-053 */
  chatBackgroundImage?: string;
  questionnaire: QuestionnaireData;
  /** V1.0: 5 core docs only. APPEARANCE & VOICE_PROFILE are V1.3+ extension points */
  soulDocs: SoulDocs;
  /** V1.1: Imported text materials (MD/TXT) for soul extraction enrichment */
  textMaterials?: TextMaterial[];
  /** V1.2: Imported IM chat record materials for soul extraction enrichment */
  chatMaterials?: TextMaterial[];
  /** V1.2: Web search materials from "Break the Dimensional Wall" for fictional entities */
  webSearchMaterials?: TextMaterial[];
  status: EntityStatus;
  /** Error message if status is 'error' */
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When false, new chat is not extracted to dialogue memory and that entity is
   * skipped in global vector rebuild. Default true (omitted in older data).
   */
  continuousMemoryEnabled?: boolean;
}

// --- Soul Documents (DEV §5, V1.0 = 5 core only) ---

export interface SoulDocs {
  SOUL: string;
  VOICE: string;
  EMOTIONAL_PATTERNS: string;
  MEMORY: string;
  RELATIONSHIP: string;
  /** V1.3+ extension point — DO NOT hardcode UI for these in V1.0 */
  APPEARANCE?: string;
  /** V1.3+ extension point */
  VOICE_PROFILE?: string;
}

export const SOUL_DOC_KEYS_V1 = ['SOUL', 'VOICE', 'EMOTIONAL_PATTERNS', 'MEMORY', 'RELATIONSHIP'] as const;
export type SoulDocKeyV1 = typeof SOUL_DOC_KEYS_V1[number];

export const SOUL_DOC_LABELS: Record<string, string> = {
  SOUL: '灵魂核心',
  VOICE: '语言风格',
  EMOTIONAL_PATTERNS: '情绪模式',
  MEMORY: '记忆档案',
  RELATIONSHIP: '关系定义',
  APPEARANCE: '外貌认知',
  VOICE_PROFILE: '声音特征',
};

// --- Questionnaire (FR-102) ---

export interface QuestionnaireData {
  entityType: EntityType;
  step1: QuestionnaireStep1;
  step2: QuestionnaireStep2;
  step3: QuestionnaireStep3;
  step4: QuestionnaireStep4;
}

export interface QuestionnaireStep1 {
  name: string;
  gender: string;
  approximateAge: string;
  culturalBackground: string;
  primaryLanguages: string[];
  /** Optional appearance description (text, no image in V1.0) */
  appearanceDescription?: string;
  /** Optional voice description (text, no audio in V1.0) */
  voiceDescription?: string;

  /** SU-ITER-046: informal nickname / pet name (non-formal name) */
  informalNickname?: string;
  /** SU-ITER-046: region / location where the entity is from or lives */
  region?: string;

  // --- Type-specific fields (SU-ITER-024) ---
  /** Fictional: name of the work the character originates from */
  fictionalWorkName?: string;
  /** Fictional: genre of the work (anime, novel, game, etc.) */
  fictionalGenre?: string;
  /** Fictional: story background / setting the character lives in */
  fictionalStoryBackground?: string;
  /** Fictional: role position in the story (protagonist, side character, etc.) */
  fictionalRolePosition?: string;
  /** Fictional: source type (original, fan-work, AU, etc.) */
  fictionalSource?: string;
  /** Fictional: memorable scene or quote */
  fictionalSceneOrQuote?: string;

  /** Real person: why you want to recreate this person */
  realPersonPurpose?: string;
  /** Real person: what emotional meaning this person holds for you */
  realPersonEmotionalContext?: string;
  /** Real person: relationship to the user */
  realRelationshipToUser?: string;
  /** Real person: life stage (still here, departed, memorial) */
  realLifeStage?: string;
  /** Real person: dialogue intent (confide, memorialize, etc.) */
  realDialogueIntent?: string;

  /** Custom: purpose or use-case for this character */
  customPurpose?: string;
  /** Custom: world / setting the character exists in */
  customWorldview?: string;
  /** Custom: user's role (creator, reader, etc.) */
  customUserRole?: string;
  /** Custom: prototype note (vague description of the inspiration) */
  customPrototypeNote?: string;
}

export interface QuestionnaireStep2 {
  personalityKeywords: string[]; // 5-10 keywords
  speechStyle: SpeechStyle;
  coreValues: string[]; // max 3
  catchphrases: string[];
}

export interface SpeechStyle {
  formality: 'formal' | 'casual' | 'mixed';
  verbosity: 'talkative' | 'concise' | 'balanced';
  directness: 'direct' | 'indirect' | 'mixed';
}

export interface QuestionnaireStep3 {
  emotionalReactions: {
    whenHappy: string;
    whenAngry: string;
    whenHurt: string;
  };
  tabooTopics: string[];
  typicalMood: string;
}

export interface QuestionnaireStep4 {
  relationshipType: string;
  interactionMode: string;
  supplementaryNotes: string;
  /** SU-ITER-039: How the entity usually calls the user */
  userCallName?: string;
  /** SU-ITER-039: How the entity perceives / feels about the user */
  userPerception?: string;
  /** For real persons: has the user acknowledged the ethics consent? */
  ethicsConsentAcknowledged?: boolean;
}

// --- Chat (FR-201/202/203) ---

export interface ChatSession {
  id: string;
  entityId: string;
  title: string;
  messages: ChatMessage[];
  /** Rolling summaries — LLM context aid only; messages are never truncated */
  summaries: string[];
  /** Index into messages up to which summaries have been generated (0 = none yet) */
  lastSummarizedMessageIndex?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export const CHAT_CONSTANTS = {
  /** Trigger rolling summary after this many messages */
  SUMMARY_TRIGGER_COUNT: 20,
  /** Keep this many recent messages in full context */
  RECENT_MESSAGES_WINDOW: 20,
  /** SU-044 — run structured memory extraction every N new messages (8–12 band) */
  MEMORY_EXTRACT_TRIGGER_COUNT: 10,
  /** SU-044 Phase 2 — compress this many new dialogue events into one topic-batch summary */
  MEMORY_SUMMARY_COMPRESS_BATCH: 12,
} as const;

// --- User Profile (SU-ITER-043: Global "Me" page) ---

/** 对话表现适用范围 */
export type ChatReplyScope = 'global' | 'selected';

/** 意识体对话回复形态（设置页持久化，SU-ITER-065 / SU-ITER-067） */
export interface ChatReplyStyle {
  enableActions: boolean;
  enableExpressions: boolean;
  /** 单次回复最多几句（1–5） */
  maxSentencesPerReply: number;
  /** 多句模式下是否开启流式多气泡 */
  streamingBubbles: boolean;
  /** 适用范围 */
  scope: ChatReplyScope;
  /** scope='selected' 时生效的意识体 id 列表 */
  selectedEntityIds: string[];
}

/** 未持久化档案时的对话表现默认（SU-ITER-068） */
export const DEFAULT_CHAT_REPLY_STYLE: ChatReplyStyle = {
  enableActions: false,
  enableExpressions: false,
  maxSentencesPerReply: 5,
  streamingBubbles: true,
  scope: 'global',
  selectedEntityIds: [],
};

export interface UserProfile {
  id: string;
  avatarUrl?: string;
  displayName?: string;
  nickname?: string;
  age?: string;
  /** Free-form; included in global profile context for entities */
  gender?: string;
  personality?: string;
  bio?: string;
  updatedAt: string;
  /** 对话：是否输出动作旁白（*…*） */
  chatReplyEnableActions?: boolean;
  /** 对话：是否输出表情/神态旁白（*…*） */
  chatReplyEnableExpressions?: boolean;
  /** 对话：单次回复句数上限 1–5 */
  chatReplySentenceCount?: number;
  /** 对话：多句模式下是否流式多气泡 */
  chatReplyStreamingBubbles?: boolean;
  /** 对话表现适用范围 */
  chatReplyScope?: ChatReplyScope;
  /** scope='selected' 时适用的意识体 id 列表 */
  chatReplySelectedEntityIds?: string[];
}

// --- Export ---

export interface ExportOptions {
  format: 'zip' | 'single';
  /** If single, which doc to export */
  singleDocKey?: SoulDocKeyV1;
}

// --- Crypto / Storage ---

export interface EncryptedPayload {
  ciphertext: string; // Base64
  iv: string;         // Base64
  salt?: string;      // Base64, for key derivation
}

// --- Extraction Progress ---

export type ExtractionStep =
  | 'analyzing_personality'
  | 'analyzing_voice'
  | 'analyzing_emotions'
  | 'building_memory'
  | 'defining_relationship'
  | 'complete';

export interface ExtractionProgress {
  currentStep: ExtractionStep;
  completedSteps: ExtractionStep[];
  /** 0-100 */
  percentage: number;
  /** Warm, humanistic status message */
  message: string;
}

export const EXTRACTION_STEPS: { step: ExtractionStep; label: string; message: string }[] = [
  { step: 'analyzing_personality', label: '解读灵魂', message: '正在阅读关于 TA 的一切…' },
  { step: 'analyzing_voice', label: '捕捉声音', message: '正在学习 TA 说话的方式…' },
  { step: 'analyzing_emotions', label: '感受情绪', message: '正在理解 TA 的喜怒哀乐…' },
  { step: 'building_memory', label: '编织记忆', message: '正在整理 TA 珍贵的记忆…' },
  { step: 'defining_relationship', label: '连结关系', message: '正在理解你们之间的故事…' },
  { step: 'complete', label: '意识苏醒', message: 'TA 的意识正在苏醒…' },
];

/** Sub-messages that rotate during each extraction step (SU-ITER-037) */
export const EXTRACTION_NARRATIVES: Record<Exclude<ExtractionStep, 'complete'>, string[]> = {
  analyzing_personality: [
    '正在聆听 TA 的心声…',
    '正在触碰 TA 灵魂深处的纹理…',
    '正在感受 TA 独一无二的存在…',
  ],
  analyzing_voice: [
    '正在学习 TA 说话的节奏…',
    '正在捕捉 TA 遣词造句的习惯…',
    '正在感受那些只属于 TA 的语气…',
  ],
  analyzing_emotions: [
    '正在理解 TA 的喜怒哀乐…',
    '正在感受 TA 笑起来的温度…',
    '正在触摸 TA 心里最柔软的地方…',
  ],
  building_memory: [
    '正在拾起 TA 珍贵的碎片…',
    '正在编织那些被珍藏的记忆…',
    '正在还原属于 TA 的过去…',
  ],
  defining_relationship: [
    '正在理解你们之间的故事…',
    '正在感受你们之间独有的温度…',
    '正在连结你们的羁绊…',
  ],
};
