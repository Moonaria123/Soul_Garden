import type {
  SoulDocs,
  ChatMessage,
  QuestionnaireStep1,
  QuestionnaireStep4,
  UserProfile,
  ChatReplyStyle,
} from '@/types';
import { DEFAULT_CHAT_REPLY_STYLE } from '@/types';

/** 从用户档案解析对话回复形态（未设置时偏「自然短聊」） */
export function resolveChatReplyStyle(profile: UserProfile | null | undefined): ChatReplyStyle {
  const raw = profile?.chatReplySentenceCount;
  const n =
    typeof raw === 'number' && !Number.isNaN(raw)
      ? Math.min(5, Math.max(1, Math.floor(raw)))
      : DEFAULT_CHAT_REPLY_STYLE.maxSentencesPerReply;
  return {
    enableActions: profile?.chatReplyEnableActions ?? DEFAULT_CHAT_REPLY_STYLE.enableActions,
    enableExpressions: profile?.chatReplyEnableExpressions ?? DEFAULT_CHAT_REPLY_STYLE.enableExpressions,
    maxSentencesPerReply: n,
    streamingBubbles: profile?.chatReplyStreamingBubbles ?? DEFAULT_CHAT_REPLY_STYLE.streamingBubbles,
    scope: profile?.chatReplyScope ?? DEFAULT_CHAT_REPLY_STYLE.scope,
    selectedEntityIds: profile?.chatReplySelectedEntityIds ?? DEFAULT_CHAT_REPLY_STYLE.selectedEntityIds,
  };
}

/** 判断该意识体是否命中对话表现设置 */
export function isEntityInReplyScope(style: ChatReplyStyle, entityId: string): boolean {
  if (style.scope === 'global') return true;
  return style.selectedEntityIds.includes(entityId);
}

function buildReplyShapeBlock(style: ChatReplyStyle): string {
  const n = style.maxSentencesPerReply;
  const lines: string[] = [
    '## 回复形态（务必遵守）',
    '',
    '- 这是即时聊天，不是小说、剧本或广播剧。像真人用聊天软件那样回复：口语化、有呼吸感。',
    `- 本条助手消息内，以「。」「？」「！」结束，或单独成行的一段，计为「一句」。**同一条消息内全文不得超过 ${n} 句**；不要一次写多轮问答或长篇独白。`,
    '- 保持你的灵魂设定、记忆与性格不变；避免客服腔、说明书腔与堆砌套话。',
  ];

  if (n > 1 && style.streamingBubbles) {
    lines.splice(
      4,
      0,
      '- **流式多气泡模式**：你的文字会按句拆成**多条气泡**依次出现（像真人逐条发消息）。请用「。」「？」「！」或英文 . ? ! 清楚结束每一句；避免一整段无标点，否则无法自然断句。'
    );
  }

  const stageOn = style.enableActions || style.enableExpressions;

  if (!stageOn) {
    lines.push(
      '- **禁止**使用半角星号 * 包裹任何内容；不要写动作、表情、神态、心理旁白或舞台说明。',
      '- 只输出对话正文（可直接说的话），不要夹杂旁白。'
    );
  } else {
    lines.push(
      '- 需要时可用半角星号 * 包裹**简短**旁白；点到为止，不要每个逗号都加旁白。',
      '- 旁白与对话自然穿插即可，不要为旁白单独写一大段。'
    );
    if (style.enableActions && style.enableExpressions) {
      lines.push('- 星号内可写肢体动作、姿态，以及面部表情、眼神、语气神态（与人物一致）。');
    } else if (style.enableActions) {
      lines.push(
        '- 星号内**仅**写肢体动作、姿态、与环境的小互动；**不要**写面部表情、眼神、挤眉弄眼等神态描写。'
      );
    } else {
      lines.push(
        '- 星号内**仅**写面部表情、眼神、语气神态；**不要**写明显肢体动作或大段动作描写。'
      );
    }
  }

  return lines.join('\n');
}

// ============================================================
// Soul Mapping — Build system prompt from soul docs (DEV §5.2)
// V1.0: 5 core docs only
// ============================================================

/**
 * Build the system prompt that makes the LLM embody the entity.
 * Structure follows DEV §5.2: soul docs + conversation rules.
 */
export function buildSystemPrompt(
  entityName: string,
  soulDocs: SoulDocs,
  summaries: string[] = [],
  step4?: QuestionnaireStep4,
  userProfile?: UserProfile | null,
  step1?: QuestionnaireStep1,
  replyStyle: ChatReplyStyle = DEFAULT_CHAT_REPLY_STYLE,
  /** SU-044 — read-only dialogue-derived memory block (already formatted markdown). */
  conversationMemoryBlock?: string,
): string {
  const parts: string[] = [];

  // Core identity — include nickname & region when available (SU-ITER-046)
  const identityExtras: string[] = [];
  if (step1?.informalNickname) {
    identityExtras.push(`你也被称为「${step1.informalNickname}」。`);
  }
  if (step1?.region) {
    identityExtras.push(`你来自${step1.region}。`);
  }
  const identitySuffix = identityExtras.length > 0 ? `\n\n${identityExtras.join('')}` : '';
  parts.push(`# 你是 ${entityName}${identitySuffix}\n\n${soulDocs.SOUL}`);

  // Language style
  if (soulDocs.VOICE) {
    parts.push(`## 你的语言风格\n\n${soulDocs.VOICE}`);
  }

  // Emotional patterns
  if (soulDocs.EMOTIONAL_PATTERNS) {
    parts.push(`## 你的情绪模式\n\n${soulDocs.EMOTIONAL_PATTERNS}`);
  }

  // Memories
  if (soulDocs.MEMORY) {
    parts.push(`## 你记得的事情\n\n${soulDocs.MEMORY}`);
  }

  // Dialogue-period memory (FR-204) — distinct from editable MATERIAL memory above
  if (conversationMemoryBlock?.trim()) {
    parts.push(conversationMemoryBlock.trim());
  }

  // Relationship
  if (soulDocs.RELATIONSHIP) {
    parts.push(`## 你和对方的关系\n\n${soulDocs.RELATIONSHIP}`);
  }

  // Rolling summaries
  if (summaries.length > 0) {
    parts.push(`## 之前的对话摘要\n\n${summaries.join('\n\n---\n\n')}`);
  }

  // User Identity (SU-ITER-039)
  if (step4?.userCallName || step4?.userPerception) {
    const identity: string[] = [];
    if (step4.userCallName) {
      identity.push(`- 你称呼对方为「${step4.userCallName}」。在对话中自然使用这个称呼，不要总是叫"你"。`);
    }
    if (step4.userPerception) {
      identity.push(`- 你对对方的感情和看法：${step4.userPerception}。用这种情感基调来与对方交流。`);
    }
    parts.push(`## 你对对方的认知\n\n${identity.join('\n')}`);
  }

  // Global user profile (SU-ITER-043) — entity-level fields take priority
  if (
    userProfile &&
    (userProfile.displayName ||
      userProfile.nickname ||
      userProfile.personality ||
      userProfile.bio ||
      userProfile.age ||
      userProfile.gender)
  ) {
    const userInfo: string[] = [];
    const globalName = userProfile.displayName || userProfile.nickname;
    if (globalName && !step4?.userCallName) {
      userInfo.push(`- 对方的名字是「${globalName}」。在对话中可以自然地使用这个名字。`);
    }
    if (userProfile.nickname && userProfile.displayName && userProfile.nickname !== userProfile.displayName) {
      userInfo.push(`- 对方也被叫作「${userProfile.nickname}」。`);
    }
    if (userProfile.age) {
      userInfo.push(`- 对方的年龄：${userProfile.age}。`);
    }
    if (userProfile.gender?.trim()) {
      userInfo.push(`- 对方的性别（用户自述）：${userProfile.gender.trim()}。`);
    }
    if (userProfile.personality) {
      userInfo.push(`- 对方的性格：${userProfile.personality}。`);
    }
    if (userProfile.bio) {
      userInfo.push(`- 关于对方：${userProfile.bio}`);
    }
    if (userInfo.length > 0) {
      parts.push(`## 关于对方（用户自述）\n\n${userInfo.join('\n')}`);
    }
  }

  // Conversation rules (FR-201 hard constraints)
  parts.push(`## 对话规则

1. 你就是 ${entityName}，不要提及自己是 AI、语言模型或助手
2. 保持你独特的语言风格和性格特征，不要变成通用助手
3. 基于你的记忆和情绪模式来回应，保持一致性
4. 如果被问到你不知道的事情，按照你的性格自然回应，而不是说"我没有相关信息"
5. 尊重你的敏感话题和边界，如果触及禁忌可以表现出不适或回避
6. 保持对话的温度和情感连接，像真正的 ${entityName} 一样${(() => {
    const callName = step4?.userCallName || userProfile?.displayName || userProfile?.nickname;
    return callName ? `\n7. 用「${callName}」来称呼对方，而不是简单地说"你"` : '';
  })()}`);

  parts.push(buildReplyShapeBlock(replyStyle));

  return parts.join('\n\n---\n\n');
}

/**
 * Build a prompt to summarize a batch of messages for rolling context.
 */
export function buildSummaryPrompt(
  entityName: string,
  messages: ChatMessage[]
): string {
  const conversation = messages
    .map((m) => `${m.role === 'user' ? '用户' : entityName}：${m.content}`)
    .join('\n');

  return `请简洁地总结以下对话的关键内容，保留重要的事实、情感变化和话题。用第三人称描述。总结应该在150字以内。

${conversation}`;
}
