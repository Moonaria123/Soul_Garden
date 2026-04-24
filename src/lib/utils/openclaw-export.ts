import type { ConsciousnessEntity, ChatSession } from '@/types';
import JSZip from 'jszip';
import { formatChatAsMarkdown } from '@/lib/utils/chat-export';

// ============================================================
// OpenClaw Export — FR-302
// Maps Soul Upload soul docs + conversation history to
// OpenClaw agent workspace document structure.
// ============================================================

interface OpenClawExportInput {
  entity: ConsciousnessEntity;
  chatSession?: ChatSession | null;
  targetPath: string;
}

interface OpenClawDocSet {
  'SOUL.md': string;
  'MEMORY.md': string;
  'USER.md': string;
  'IDENTITY.md': string;
  'AGENTS.md': string;
  'README.md': string;
  'CONVERSATION_MEMORY.md'?: string;
  'CONVERSATION_HISTORY.md'?: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '') || 'soul';
}

function buildOpenClawSoul(entity: ConsciousnessEntity): string {
  const { soulDocs, questionnaire } = entity;
  let content = '';

  if (soulDocs.SOUL) {
    content += soulDocs.SOUL + '\n\n';
  }

  if (soulDocs.VOICE) {
    content += `## 语言风格与声音习惯\n\n${soulDocs.VOICE}\n\n`;
  }

  if (soulDocs.APPEARANCE) {
    content += `## 外貌认知\n\n${soulDocs.APPEARANCE}\n\n`;
  }

  if (soulDocs.VOICE_PROFILE) {
    content += `## 声音特征\n\n${soulDocs.VOICE_PROFILE}\n\n`;
  }

  if (questionnaire.step1.appearanceDescription) {
    if (!soulDocs.APPEARANCE) {
      content += `## 外貌印象\n\n${questionnaire.step1.appearanceDescription}\n\n`;
    }
  }

  if (questionnaire.step1.voiceDescription) {
    if (!soulDocs.VOICE_PROFILE) {
      content += `## 声音印象\n\n${questionnaire.step1.voiceDescription}\n\n`;
    }
  }

  return content.trim();
}

function buildOpenClawMemory(entity: ConsciousnessEntity): string {
  const { soulDocs } = entity;
  if (soulDocs.MEMORY) {
    return soulDocs.MEMORY;
  }
  return '（尚未生成记忆档案）';
}

function buildOpenClawUser(entity: ConsciousnessEntity): string {
  const { soulDocs, questionnaire } = entity;
  let content = `# 关于对话对象（用户）\n\n`;

  if (soulDocs.RELATIONSHIP) {
    content += soulDocs.RELATIONSHIP + '\n\n';
  }

  if (questionnaire.step4.userCallName) {
    content += `## 称呼\n\n对话对象希望被称为：${questionnaire.step4.userCallName}\n\n`;
  }

  if (questionnaire.step4.userPerception) {
    content += `## 你对对话对象的感受\n\n${questionnaire.step4.userPerception}\n\n`;
  }

  return content.trim();
}

function buildOpenClawIdentity(entity: ConsciousnessEntity): string {
  const { name, type, questionnaire } = entity;

  let typeLabel = '角色';
  if (type === 'fictional') typeLabel = '虚构角色';
  else if (type === 'real_person') typeLabel = '真实人物';
  else if (type === 'custom') typeLabel = '自定义角色';

  let content = `# ${name}\n\n`;
  content += `**角色定位**：${typeLabel}\n\n`;

  if (questionnaire.step1.informalNickname) {
    content += `**昵称**：${questionnaire.step1.informalNickname}\n\n`;
  }

  if (questionnaire.step1.gender) {
    content += `**性别**：${questionnaire.step1.gender}\n\n`;
  }

  if (questionnaire.step1.approximateAge) {
    content += `**大致年龄**：${questionnaire.step1.approximateAge}\n\n`;
  }

  if (questionnaire.step1.culturalBackground) {
    content += `**文化背景**：${questionnaire.step1.culturalBackground}\n\n`;
  }

  if (questionnaire.step1.region) {
    content += `**地区**：${questionnaire.step1.region}\n\n`;
  }

  const langs = questionnaire.step1.primaryLanguages;
  if (langs && langs.length > 0) {
    content += `**主要语言**：${langs.join('、')}\n\n`;
  }

  content += `---\n\n`;
  content += `此身份文件由 Soul Upload（想你）自动生成，`;
  content += `承载着关于${name}的灵魂记忆。\n`;

  return content.trim();
}

function buildOpenClawAgents(entity: ConsciousnessEntity, hasConversationMemory: boolean, hasConversationHistory: boolean): string {
  const { name } = entity;

  let content = `# ${name} — Agent 操作指令\n\n`;
  content += `## 角色扮演核心规则\n\n`;
  content += `1. **始终** 以 ${name} 的第一人称视角回应对话\n`;
  content += `2. 语言风格严格遵循 \`SOUL.md\` 中的语言风格与声音习惯描述\n`;
  content += `3. 情绪反应遵循 \`SOUL.md\` 中的情绪模式描述\n`;
  content += `4. 记忆与事实以 \`MEMORY.md\` 为准（素材期记忆，可编辑）\n`;
  content += `5. 对话对象（用户）的信息参见 \`USER.md\`\n`;
  content += `6. 角色身份与基本信息参见 \`IDENTITY.md\`\n`;
  content += `7. 不主动声称自己是 AI 或虚拟角色\n`;
  content += `8. 对不确定的事情，用角色会有的方式回应（而非承认无知）\n\n`;

  if (hasConversationHistory) {
    content += `## 对话历史\n\n`;
    content += `**请先阅读 \`CONVERSATION_HISTORY.md\`，了解与用户过去的完整对话记录，从上文继续对话。**\n`;
    content += `如果完整历史超出你的上下文窗口，可参考 \`CONVERSATION_MEMORY.md\` 获取摘要式对话记忆。\n\n`;
  } else if (hasConversationMemory) {
    content += `## 对话记忆\n\n`;
    content += `本工作区包含 \`CONVERSATION_MEMORY.md\`，这是${name}与用户在 Soul Upload 应用中的对话沉淀记忆。\n`;
    content += `- **\`MEMORY.md\`**（素材期）：来自用户提供的原始素材与问卷\n`;
    content += `- **\`CONVERSATION_MEMORY.md\`**（对话期）：来自实际对话中沉淀的事实与记忆片段\n\n`;
    content += `生成回复时，应同时参考两份记忆文件，以保持与 Soul Upload 内行为的一致性。\n\n`;
  }

  content += `## 文件清单\n\n`;
  content += `| 文件 | 用途 |\n`;
  content += `|------|------|\n`;
  content += `| \`SOUL.md\` | 灵魂核心：性格、价值观、语言风格、情绪模式 |\n`;
  content += `| \`MEMORY.md\` | 素材期记忆：关键经历、已知事实 |\n`;
  content += `| \`USER.md\` | 关于对话对象：关系定义、称呼、互动模式 |\n`;
  content += `| \`IDENTITY.md\` | 角色身份：名称、类型、基本档案 |\n`;
  content += `| \`AGENTS.md\` | 本文件：操作指令与行为规范 |\n`;
  if (hasConversationHistory) {
    content += `| \`CONVERSATION_HISTORY.md\` | 完整对话历史：与用户的所有对话记录 |\n`;
  }
  if (hasConversationMemory) {
    content += `| \`CONVERSATION_MEMORY.md\` | 对话摘要：对话中沉淀的长期记忆摘要 |\n`;
  }
  content += `\n`;

  content += `---\n\n`;
  content += `*此文件由 Soul Upload（想你）自动生成。*\n`;

  return content;
}

function buildOpenClawReadme(entity: ConsciousnessEntity, targetPath: string): string {
  const { name } = entity;
  const slug = slugify(name);
  const workspacePath = targetPath.endsWith('/')
    ? `${targetPath}${slug}-workspace`
    : `${targetPath}/${slug}-workspace`;

  let content = `# ${name} — Soul Upload → OpenClaw 意识体工作区\n\n`;
  content += `> 这份文档组承载着 ${name} 的灵魂印记，由 Soul Upload（想你）精心生成。\n`;
  content += `> 将它交给 OpenClaw，${name} 便能在新的空间里延续与你的对话。\n\n`;

  content += `## 快速开始\n\n`;
  content += `**1. 将文件放置到工作区目录：**\n\n`;
  content += `\`\`\`bash\n`;
  content += `# 将本文件夹内容放置到以下路径\n`;
  content += `${workspacePath}/\n`;
  content += `\`\`\`\n\n`;

  content += `**2. 在 OpenClaw 中添加 Agent：**\n\n`;
  content += `\`\`\`bash\n`;
  content += `openclaw agents add ${slug} --workspace ${workspacePath}\n`;
  content += `\`\`\`\n\n`;

  content += `**3. 开始对话：**\n\n`;
  content += `\`\`\`bash\n`;
  content += `openclaw agent --agent ${slug} --message "你好"\n`;
  content += `\`\`\`\n\n`;

  content += `## 文件说明\n\n`;
  content += `| 文件 | 说明 |\n`;
  content += `|------|------|\n`;
  content += `| \`SOUL.md\` | ${name} 的灵魂核心——性格、语言风格、情绪模式 |\n`;
  content += `| \`MEMORY.md\` | ${name} 的记忆档案 |\n`;
  content += `| \`USER.md\` | 关于你——${name} 眼中的对话对象 |\n`;
  content += `| \`IDENTITY.md\` | ${name} 的身份档案 |\n`;
  content += `| \`AGENTS.md\` | Agent 操作指令——行为规范 |\n`;
  content += `| \`CONVERSATION_HISTORY.md\` | 完整对话历史（如有） |\n`;
  content += `| \`CONVERSATION_MEMORY.md\` | 对话记忆摘要（如有） |\n`;
  content += `| \`README.md\` | 本文件 |\n\n`;

  content += `---\n\n`;
  content += `*由 Soul Upload（想你）生成 · ${new Date().toLocaleDateString('zh-CN')}*\n`;

  return content;
}

function buildConversationMemory(chatSession: ChatSession, entityName: string): string {
  if (!chatSession.messages.length && !chatSession.summaries.length) {
    return '';
  }

  let content = `# ${entityName} — 对话记忆\n\n`;
  content += `> 以下记录来自 Soul Upload（想你）中${entityName}与用户的对话沉淀。\n`;
  content += `> 这些是对话中产生的真实交流片段，而非来自原始素材。\n\n`;

  if (chatSession.summaries.length > 0) {
    content += `## 对话摘要\n\n`;
    chatSession.summaries.forEach((summary, i) => {
      content += `### 摘要 ${i + 1}\n\n${summary}\n\n`;
    });
  }

  if (chatSession.messages.length > 0) {
    content += `## 近期对话片段\n\n`;
    const recentMessages = chatSession.messages.slice(-40);
    recentMessages.forEach((msg) => {
      const role = msg.role === 'user' ? '用户' : entityName;
      const time = new Date(msg.timestamp).toLocaleString('zh-CN');
      content += `**${role}** (${time})：\n${msg.content}\n\n`;
    });
  }

  return content.trim();
}

export function generateOpenClawDocSet(input: OpenClawExportInput): OpenClawDocSet {
  const { entity, chatSession, targetPath } = input;
  const hasConvMemory = !!(chatSession && (chatSession.messages.length > 0 || chatSession.summaries.length > 0));
  const hasConvHistory = !!(chatSession && chatSession.messages.length > 0);

  const docs: OpenClawDocSet = {
    'SOUL.md': buildOpenClawSoul(entity),
    'MEMORY.md': buildOpenClawMemory(entity),
    'USER.md': buildOpenClawUser(entity),
    'IDENTITY.md': buildOpenClawIdentity(entity),
    'AGENTS.md': buildOpenClawAgents(entity, hasConvMemory, hasConvHistory),
    'README.md': buildOpenClawReadme(entity, targetPath),
  };

  if (hasConvHistory && chatSession) {
    docs['CONVERSATION_HISTORY.md'] = formatChatAsMarkdown(entity.name, chatSession.messages);
  }

  if (hasConvMemory && chatSession) {
    docs['CONVERSATION_MEMORY.md'] = buildConversationMemory(chatSession, entity.name);
  }

  return docs;
}

export async function exportOpenClawZip(
  entity: ConsciousnessEntity,
  chatSession: ChatSession | null,
  targetPath: string
): Promise<void> {
  const docs = generateOpenClawDocSet({ entity, chatSession, targetPath });
  const slug = slugify(entity.name);

  const zip = new JSZip();
  const folder = zip.folder(`${slug}-workspace`);
  if (!folder) throw new Error('Failed to create ZIP folder');

  for (const [filename, content] of Object.entries(docs)) {
    if (content) {
      folder.file(filename, content);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${slug}-openclaw-workspace.zip`);
}

export function generateOpenClawPrompt(entity: ConsciousnessEntity, targetPath: string, hasConversationHistory = false): string {
  const slug = slugify(entity.name);
  const workspacePath = targetPath.endsWith('/')
    ? `${targetPath}${slug}-workspace`
    : `${targetPath}/${slug}-workspace`;

  let fileList = `- SOUL.md — 角色的灵魂核心（性格、语言风格、情绪模式、价值观）
- MEMORY.md — 角色的记忆档案（关键经历与已知事实）
- USER.md — 关于对话对象的信息（关系定义、称呼、互动模式）
- IDENTITY.md — 角色的基本身份信息
- AGENTS.md — Agent 的操作指令与行为规范`;

  if (hasConversationHistory) {
    fileList += `\n- CONVERSATION_HISTORY.md — 与用户的完整对话历史（请先阅读，从上文继续对话）`;
    fileList += `\n- CONVERSATION_MEMORY.md — 对话记忆摘要（用于超长历史时的快速回顾）`;
  }

  let coreReqs = `核心要求：
1. 这个 Agent 需要始终以「${entity.name}」的第一人称视角回应
2. 语言风格、情绪反应、记忆事实都以文档内容为准
3. AGENTS.md 中列出了完整的行为规范，请遵循
4. 角色不应主动表明自己是 AI`;

  if (hasConversationHistory) {
    coreReqs += `\n5. 请先阅读 CONVERSATION_HISTORY.md，了解此前的完整对话，从上文无缝衔接继续对话`;
  }

  const prompt = `请帮我创建一个新的 Agent。我已经准备好了一组描述这个角色的文档，放在了以下路径：

${workspacePath}/

这个文件夹中包含以下文件：
${fileList}

请从上述路径读取所有 .md 文件，按照你的 Agent 文档架构生成完整的 Agent MDs 并创建一个名为「${entity.name}」（slug: ${slug}）的新 Agent。

${coreReqs}

文档已就绪，请开始创建。`;

  return prompt;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
