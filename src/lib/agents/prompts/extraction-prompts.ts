import type { QuestionnaireData, TextMaterial } from '@/types';

// ============================================================
// Soul Extraction Prompts — V1.1 (5 core docs + text materials)
// Each generates one soul document from questionnaire + optional text materials.
// Temperature: 0.7, second-person "你" addressing.
// Evidence-based: no fabrication, preserve contradictions.
// ============================================================

function formatTextMaterials(materials?: TextMaterial[]): string {
  if (!materials || materials.length === 0) return '';

  const webSearchMats = materials.filter((m) => m.id.startsWith('web-search-'));
  const userMats = materials.filter((m) => !m.id.startsWith('web-search-'));

  let result = '';

  if (webSearchMats.length > 0) {
    const webSections = webSearchMats.map((m, i) => {
      return `### 网络资料 ${i + 1}：${m.filename}
${m.content}`;
    });
    result += `\n\n## 网络搜索资料（从网络收集的关于 TA 的角色信息）
以下是通过网络搜索获得的角色相关资料，涵盖世界观、传记、对话风格、关系网、外貌特征、梗与名场面、角色原型、冷知识、情感禁区和作品元信息等十大维度。请将其作为重要参考融合到分析中，但以用户问卷信息为优先。

${webSections.join('\n\n---\n\n')}`;
  }

  if (userMats.length > 0) {
    const sections = userMats.map((m, i) => {
      const langNote = m.detectedLanguage !== 'und' ? `（${m.detectedLanguageLabel}）` : '';
      return `### 素材 ${i + 1}：${m.filename} ${langNote}
${m.content}`;
    });
    result += `\n\n## 文字素材（用户导入的关于 TA 的文本）
以下是用户提供的文字素材，请仔细阅读并融合到分析中。这些素材可能包含聊天记录、日记、信件、角色设定等，是理解 TA 的重要依据。

${sections.join('\n\n---\n\n')}`;
  }

  return result;
}

function formatQuestionnaire(q: QuestionnaireData): string {
  const s1 = q.step1;
  const s2 = q.step2;
  const s3 = q.step3;
  const s4 = q.step4;

  return `## 基本信息
- 名字：${s1.name}
${s1.informalNickname ? `- 昵称/小名：${s1.informalNickname}` : ''}
- 性别：${s1.gender}
- 年龄：${s1.approximateAge}
${s1.region ? `- 地区：${s1.region}` : ''}
- 文化背景：${s1.culturalBackground}
- 使用语言：${s1.primaryLanguages.join('、')}
${s1.appearanceDescription ? `- 外貌印象：${s1.appearanceDescription}` : ''}
${s1.voiceDescription ? `- 声音印象：${s1.voiceDescription}` : ''}
- 实体类型：${q.entityType === 'real_person' ? '真实人物' : q.entityType === 'fictional' ? '梦幻同伴（来自故事/动漫/游戏的灵魂）' : '自定义角色'}
${q.entityType === 'fictional' && (s1.fictionalWorkName || s1.fictionalGenre || s1.fictionalStoryBackground || s1.fictionalRolePosition || s1.fictionalSource || s1.fictionalSceneOrQuote) ? `
## 作品信息
${s1.fictionalWorkName ? `- 所属作品：${s1.fictionalWorkName}` : ''}
${s1.fictionalGenre ? `- 作品类型：${s1.fictionalGenre}` : ''}
${s1.fictionalStoryBackground ? `- 故事背景：${s1.fictionalStoryBackground}` : ''}
${s1.fictionalRolePosition ? `- 角色定位：${s1.fictionalRolePosition}` : ''}
${s1.fictionalSource ? `- 作品来源：${s1.fictionalSource}` : ''}
${s1.fictionalSceneOrQuote ? `- 名场面/经典台词：${s1.fictionalSceneOrQuote}` : ''}` : ''}
${q.entityType === 'real_person' && (s1.realPersonPurpose || s1.realPersonEmotionalContext || s1.realRelationshipToUser || s1.realLifeStage || s1.realDialogueIntent) ? `
## 召唤背景
${s1.realPersonPurpose ? `- 召唤目的：${s1.realPersonPurpose}` : ''}
${s1.realPersonEmotionalContext ? `- 情感寄托：${s1.realPersonEmotionalContext}` : ''}
${s1.realRelationshipToUser ? `- 与用户关系：${s1.realRelationshipToUser}` : ''}
${s1.realLifeStage ? `- 生命阶段：${s1.realLifeStage}` : ''}
${s1.realDialogueIntent ? `- 对话期望：${s1.realDialogueIntent}` : ''}` : ''}
${q.entityType === 'custom' && (s1.customPurpose || s1.customWorldview || s1.customUserRole || s1.customPrototypeNote) ? `
## 角色设定
${s1.customPurpose ? `- 角色用途：${s1.customPurpose}` : ''}
${s1.customWorldview ? `- 世界设定：${s1.customWorldview}` : ''}
${s1.customUserRole ? `- 用户角色：${s1.customUserRole}` : ''}
${s1.customPrototypeNote ? `- 原型灵感：${s1.customPrototypeNote}` : ''}` : ''}

## 性格与表达
- 性格关键词：${s2.personalityKeywords.join('、')}
- 说话风格：正式程度=${s2.speechStyle.formality}，话多程度=${s2.speechStyle.verbosity}，表达方式=${s2.speechStyle.directness}
- 核心价值观：${s2.coreValues.join('、')}
${s2.catchphrases.length > 0 ? `- 口头禅/标志用语：「${s2.catchphrases.join('」「')}」` : ''}

## 情绪模式
- 开心时：${s3.emotionalReactions.whenHappy}
- 生气时：${s3.emotionalReactions.whenAngry}
- 受伤时：${s3.emotionalReactions.whenHurt}
${s3.tabooTopics.length > 0 ? `- 敏感话题：${s3.tabooTopics.join('、')}` : ''}
- 日常情绪基调：${s3.typicalMood}

## 关系定义
- 与创建者的关系：${s4.relationshipType}
- 互动方式：${s4.interactionMode}
${s4.userCallName ? `- TA 对用户的称呼：${s4.userCallName}` : ''}
${s4.userPerception ? `- TA 眼中的用户 / 对用户的感情：${s4.userPerception}` : ''}
${s4.supplementaryNotes ? `- 补充说明：${s4.supplementaryNotes}` : ''}`;
}

/**
 * SOUL.md — Core personality, values, thinking patterns
 */
export function soulPrompt(q: QuestionnaireData, materials?: TextMaterial[]): string {
  const hasMaterials = materials && materials.length > 0;
  return `你是一个专业的人格分析师。请根据以下${hasMaterials ? '问卷信息和文字素材' : '问卷信息'}，为"${q.step1.name}"生成一份灵魂核心档案（SOUL.md）。

要求：
1. 使用第二人称"你"来描述这个人
2. 基于${hasMaterials ? '问卷和文字素材中的' : '问卷'}信息进行有据推理，不要凭空编造
3. 如果信息中有矛盾之处，如实保留并分析
4. 涵盖：核心人格特质、深层价值观、思维方式、内在驱动力、世界观
5. 使用温暖而有洞察力的语言，像是一个深爱这个人的人在描述他们
6. ${q.entityType === 'real_person' ? '这是一个真实人物——基于提供的信息进行分析，但明确标注哪些是推断' : '这是一个来自故事或想象的角色——可以在问卷信息基础上做合理的性格延伸'}
${hasMaterials ? '7. 文字素材中的具体表达、用词习惯和事件是珍贵的一手证据，请优先参考' : ''}

以下是关于 TA 的信息：

${formatQuestionnaire(q)}${formatTextMaterials(materials)}

请用 Markdown 格式输出 SOUL.md 的内容。不要包含文件名标题，直接从内容开始。`;
}

/**
 * VOICE.md — Language style, vocabulary, sentence patterns
 */
export function voicePrompt(q: QuestionnaireData, soulDoc: string, materials?: TextMaterial[]): string {
  const hasMaterials = materials && materials.length > 0;
  return `你是一个语言风格分析专家。请根据以下${hasMaterials ? '问卷信息、文字素材' : '问卷信息'}和已生成的灵魂核心档案，为"${q.step1.name}"生成一份语言风格档案（VOICE.md）。

已生成的灵魂核心：
${soulDoc}

要求：
1. 使用第二人称"你"
2. 具体描述：说话的节奏、常用句式、语气词、标点习惯
3. 区分：正式场合 vs 私下交流的语言差异
4. 包含：典型的开场白方式、回应方式、表达情感的方式
5. 如果有口头禅，分析它们在什么场景下出现
6. 基于${hasMaterials ? '问卷和素材中的实际' : '问卷'}信息推理，不凭空编造
${hasMaterials ? '7. 文字素材中 TA 的原话是最宝贵的语言风格证据——请从中提取真实的用词习惯、句式偏好、语气特征' : ''}

以下是关于 TA 的问卷信息：

${formatQuestionnaire(q)}${formatTextMaterials(materials)}

请用 Markdown 格式输出 VOICE.md 的内容。不要包含文件名标题。`;
}

/**
 * EMOTIONAL_PATTERNS.md — Fears, desires, triggers, defenses
 */
export function emotionalPatternsPrompt(q: QuestionnaireData, soulDoc: string, materials?: TextMaterial[]): string {
  const hasMaterials = materials && materials.length > 0;
  return `你是一个情绪心理学专家。请根据以下${hasMaterials ? '问卷信息、文字素材' : '问卷信息'}和灵魂核心档案，为"${q.step1.name}"生成一份情绪模式档案（EMOTIONAL_PATTERNS.md）。

已生成的灵魂核心：
${soulDoc}

要求：
1. 使用第二人称"你"
2. 深入分析：情绪触发机制、防御方式、安全感来源
3. 描述：快乐/愤怒/悲伤/恐惧的深层模式
4. 分析：情绪表达方式与内在感受之间的关系
5. 如有敏感话题，分析可能的原因和应对方式
6. 保持温暖和尊重的语气
${hasMaterials ? '7. 从文字素材中捕捉 TA 真实的情绪表达——喜悦时的措辞、受挫时的反应、安慰他人的方式' : ''}

以下是关于 TA 的问卷信息：

${formatQuestionnaire(q)}${formatTextMaterials(materials)}

请用 Markdown 格式输出 EMOTIONAL_PATTERNS.md 的内容。不要包含文件名标题。`;
}

/**
 * MEMORY.md — Key experiences, known facts
 */
export function memoryPrompt(q: QuestionnaireData, materials?: TextMaterial[]): string {
  const hasMaterials = materials && materials.length > 0;
  return `你是一个记忆整理专家。请根据以下${hasMaterials ? '问卷信息和文字素材' : '问卷信息'}，为"${q.step1.name}"生成一份记忆档案（MEMORY.md）。

要求：
1. 使用第二人称"你"
2. 整理${hasMaterials ? '问卷和文字素材' : '问卷'}中提到的所有事实性信息
3. 组织为：基本信息、已知经历、重要关系、文化背景
4. 明确区分"已知事实"和"合理推测"
5. ${q.entityType === 'real_person' ? '对于真实人物，严格基于提供的信息，不要编造经历' : '对于来自故事或想象的角色，可以在问卷基础上做合理的背景延伸'}
6. 保持温暖的叙述语气
${hasMaterials ? '7. 文字素材中提到的具体事件、人名、地点、时间等是宝贵的记忆素材，请逐一整理融入' : ''}

以下是关于 TA 的问卷信息：

${formatQuestionnaire(q)}${formatTextMaterials(materials)}

请用 Markdown 格式输出 MEMORY.md 的内容。不要包含文件名标题。`;
}

/**
 * RELATIONSHIP.md — Relationship nature, interaction patterns
 */
export function relationshipPrompt(q: QuestionnaireData, soulDoc: string, materials?: TextMaterial[]): string {
  const s4 = q.step4;
  const hasMaterials = materials && materials.length > 0;
  const userIdentityBlock = (s4.userCallName || s4.userPerception)
    ? `\n\n**重要——用户身份信息（User Identity）**：
${s4.userCallName ? `- 你平时对用户的称呼是「${s4.userCallName}」。在对话中，你必须自然地使用这个称呼来称呼对方。` : ''}
${s4.userPerception ? `- 你对用户的感情和看法：${s4.userPerception}。在对话中，你应当以这种情感倾向来与对方互动。` : ''}`
    : '';

  return `你是一个关系动力学专家。请根据以下${hasMaterials ? '问卷信息、文字素材' : '问卷信息'}和灵魂核心档案，为"${q.step1.name}"生成一份关系定义档案（RELATIONSHIP.md）。

已生成的灵魂核心：
${soulDoc}

要求：
1. 使用第二人称"你"
2. 描述与创建者之间的关系本质和互动模式
3. 分析：信任程度、依赖模式、冲突处理方式
4. 定义：在对话中应有的态度、温度、边界
5. 描述：如何称呼对方、如何回应对方的不同情绪
6. 保持关系的真实感，避免过度理想化
${s4.userCallName ? `7. **务必在档案中明确写入**：你称呼对方为「${s4.userCallName}」，并分析这个称呼背后的亲密度与关系定位` : ''}
${s4.userPerception ? `8. **在档案中具体描述**你对对方的情感：${s4.userPerception}` : ''}
${hasMaterials ? '9. 文字素材中两人的互动记录是关系的直接证据——请从中还原关系的真实温度' : ''}${userIdentityBlock}

以下是关于 TA 的问卷信息：

${formatQuestionnaire(q)}${formatTextMaterials(materials)}

请用 Markdown 格式输出 RELATIONSHIP.md 的内容。不要包含文件名标题。`;
}
