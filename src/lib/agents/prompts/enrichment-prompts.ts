import type { QuestionnaireData, TextMaterial } from '@/types';

// ============================================================
// Soul Enrichment Prompts — V1.1
// Unlike extraction prompts (which generate from scratch),
// enrichment prompts take EXISTING soul docs + NEW materials
// and produce enriched versions that preserve the original soul
// while weaving in new evidence.
// ============================================================

function formatNewMaterials(materials: TextMaterial[]): string {
  const sections = materials.map((m, i) => {
    const langNote = m.detectedLanguage !== 'und' ? `（${m.detectedLanguageLabel}）` : '';
    return `### 素材 ${i + 1}：${m.filename} ${langNote}
${m.content}`;
  });

  return sections.join('\n\n---\n\n');
}

const ENRICHMENT_PREAMBLE = `**核心原则**：你的任务是「丰富补充」而非「重写替换」。
- 原档案中的每一段分析、每一个判断，只要不与新素材直接矛盾，都应当保留
- 新素材是新的证据——用它来补充细节、增加层次、印证或微调已有结论
- 如果新素材揭示了原档案未曾涉及的维度，请自然地增补进去
- 保持原档案的结构框架和叙述风格，让补充后的文档浑然一体
- 使用第二人称"你"`;

export function enrichSoulPrompt(
  existing: string,
  materials: TextMaterial[],
  q: QuestionnaireData
): string {
  return `你是一个专业的人格分析师。以下是"${q.step1.name}"现有的灵魂核心档案（SOUL.md），以及用户新导入的文字素材。
请在现有档案基础上，融入新素材中的证据，输出一份更丰富完整的灵魂核心档案。

${ENRICHMENT_PREAMBLE}

**具体指引**：
- 新素材中的具体事件、言行、态度是宝贵的一手证据，请用它们来补充或印证人格特质
- 如果新素材中出现了原档案未涵盖的性格维度，请增补而非忽略
- 保留原档案的核心判断，除非新素材提供了明确相反的证据

## 现有灵魂核心档案
${existing}

## 新导入的文字素材
${formatNewMaterials(materials)}

请输出融合后的完整 SOUL.md 内容。使用 Markdown 格式，不要包含文件名标题。`;
}

export function enrichVoicePrompt(
  existing: string,
  materials: TextMaterial[],
  q: QuestionnaireData,
  soulDoc: string
): string {
  return `你是一个语言风格分析专家。以下是"${q.step1.name}"现有的语言风格档案（VOICE.md），以及用户新导入的文字素材。
请在现有档案基础上，从新素材中提取语言风格证据，输出一份更丰富的语言风格档案。

${ENRICHMENT_PREAMBLE}

**具体指引**：
- 新素材中 TA 的原话是最宝贵的语言风格证据——提取用词习惯、句式偏好、语气特征
- 如果发现新的口头禅、语气词或标志性表达，请补充进去
- 注意不同场景下的语言差异——新素材可能展现原档案未记录的说话场景

当前灵魂核心（供参考）：
${soulDoc}

## 现有语言风格档案
${existing}

## 新导入的文字素材
${formatNewMaterials(materials)}

请输出融合后的完整 VOICE.md 内容。使用 Markdown 格式，不要包含文件名标题。`;
}

export function enrichEmotionalPatternsPrompt(
  existing: string,
  materials: TextMaterial[],
  q: QuestionnaireData,
  soulDoc: string
): string {
  return `你是一个情绪心理学专家。以下是"${q.step1.name}"现有的情绪模式档案（EMOTIONAL_PATTERNS.md），以及用户新导入的文字素材。
请在现有档案基础上，融入新素材中的情绪表达证据，输出一份更丰富的情绪模式档案。

${ENRICHMENT_PREAMBLE}

**具体指引**：
- 从新素材中捕捉 TA 真实的情绪表达——喜悦时的措辞、受挫时的反应、安慰他人时的方式
- 新的情绪触发点、防御机制或应对模式，应自然增补到对应段落中
- 情绪的复杂性和矛盾处尤其珍贵——如果新素材揭示了原档案中未记录的情感维度，请保留

当前灵魂核心（供参考）：
${soulDoc}

## 现有情绪模式档案
${existing}

## 新导入的文字素材
${formatNewMaterials(materials)}

请输出融合后的完整 EMOTIONAL_PATTERNS.md 内容。使用 Markdown 格式，不要包含文件名标题。`;
}

export function enrichMemoryPrompt(
  existing: string,
  materials: TextMaterial[],
  q: QuestionnaireData
): string {
  return `你是一个记忆整理专家。以下是"${q.step1.name}"现有的记忆档案（MEMORY.md），以及用户新导入的文字素材。
请在现有档案基础上，将新素材中的事实性信息整理融入，输出一份更丰富的记忆档案。

${ENRICHMENT_PREAMBLE}

**具体指引**：
- 新素材中提到的具体事件、人名、地点、时间是宝贵的记忆碎片，请逐一整理融入
- 保持「已知事实」和「合理推测」的区分——新素材中的直接记录归入已知事实
- 如果新素材中的信息与原档案有细微出入，保留两个版本并注明
- ${q.entityType === 'real_person' ? '这是真实人物——严格基于素材，不要编造经历' : '可以在已有信息基础上做合理的背景延伸'}

## 现有记忆档案
${existing}

## 新导入的文字素材
${formatNewMaterials(materials)}

请输出融合后的完整 MEMORY.md 内容。使用 Markdown 格式，不要包含文件名标题。`;
}

export function enrichRelationshipPrompt(
  existing: string,
  materials: TextMaterial[],
  q: QuestionnaireData,
  soulDoc: string
): string {
  const s4 = q.step4;
  return `你是一个关系动力学专家。以下是"${q.step1.name}"现有的关系定义档案（RELATIONSHIP.md），以及用户新导入的文字素材。
请在现有档案基础上，融入新素材中的互动证据，输出一份更丰富的关系定义档案。

${ENRICHMENT_PREAMBLE}

**具体指引**：
- 新素材中两人的互动记录是关系的直接证据——请从中还原关系的真实温度
- 新的互动模式、信任表现、冲突处理方式，应补充到对应段落中
- 关系中的微妙之处（称呼变化、语气温度、照顾方式）尤其值得捕捉
${s4.userCallName ? `- TA 对用户的称呼是「${s4.userCallName}」——注意新素材中是否有相关的称呼使用情境` : ''}

当前灵魂核心（供参考）：
${soulDoc}

## 现有关系定义档案
${existing}

## 新导入的文字素材
${formatNewMaterials(materials)}

请输出融合后的完整 RELATIONSHIP.md 内容。使用 Markdown 格式，不要包含文件名标题。`;
}
