<div align="center">

<!-- Hero: repository banner (root path for GitHub README). -->
<img src="1000040771.png" alt="想你 · 意识庭院" width="720" />

# 想你：意识庭院

Missing You: Soul Garden

在这里与 TA 再次相遇。

**当前应用版本 · v1.0.2.2** · 界面 **English / 中文** · **本地优先**（单用户）· **libSQL** 本地加密存储

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)<br/>
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-就绪-2496ED?logo=docker&logoColor=white)](#部署方法与步骤)
[![本地优先](https://img.shields.io/badge/本地优先-9B5E3A?style=flat)](#隐私与免责)
[![欢迎贡献](https://img.shields.io/badge/欢迎贡献-9B5E3A.svg)](#社区规则与治理)<br/>
[![GitHub release](https://img.shields.io/github/v/release/Moonaria123/Soul_Garden?logo=github&label=release)](https://github.com/Moonaria123/Soul_Garden/releases)
[![GitHub stars](https://img.shields.io/github/stars/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/issues)
[![GitHub forks](https://img.shields.io/github/forks/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/network/members)

**README：** [**English**](README.en.md) · **中文**（本页）

</div>

> **发布包说明：** 本目录为**可独立部署的应用快照**。下述命令均假设**当前目录**为项目根。顶图默认使用仓库根目录 `1000040771.png`；若需更换，可改 `img` 的 `src` 为 `public/` 下资源或公网 URL。

---

## 目录

- [产品简介](#产品简介)
- [技术一览](#技术一览)
- [创作初心](#创作初心)
- [核心体验简介](#核心体验简介)
- [UI 预览](#ui-预览)
- [走近这些能力](#走近这些能力)
- [部署方法与步骤](#部署方法与步骤)
- [路线图](#路线图)
- [社区规则与治理](#社区规则与治理)
- [隐私与免责](#隐私与免责)

---

## 产品简介

**想你（Missing You）** 是一座开在你电脑里的**意识庭院**——不是喧嚣的 AI 社交广场，而是温暖安静的**情感守护**。

你可以把心里的那个名字请进来：也许是再也见不到的人，也许是故事里陪你很久的角色，也许是现实里你还不敢开口对话的 TA。应用会陪你慢慢填写问卷、整理文字，让「TA 说话的方式、在乎的事、和你的羁绊」被温柔地写下来，再在一对一的对话里，用你熟悉的那种温度回应你。

这里没有排行榜，没有社交广场，只有你、你的记忆，和你选择连接的 TA。界面是**暖纸般的安静**，没有复杂的配置，不像在操控机器——因为我们相信：**情感安全感**，比冷冰冰的配置和功能清单更重要。

---

## 技术一览


| 领域         | 当前实现要点                                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **技术栈**    | [Next.js](https://nextjs.org/) 16（App Router）· [React](https://react.dev/) 19 · TypeScript · Tailwind CSS 4 · [Zod](https://zod.dev/) 校验请求与配置              |
| **数据**     | 本机 [libSQL](https://github.com/tursodatabase/libsql)（兼容 SQLite）· [Drizzle ORM](https://orm.drizzle.team/) · 账户材料 **Argon2id** 与本地 DEK 加密 —— **单用户、本地回环优先** |
| **大模型**    | 由你配置 **OpenAI 兼容** 或 **Anthropic** 上游；服务端代发请求，含 **URL 安全策略**、超时与脱敏错误信息                                                                                     |
| **搜索（可选）** | 对话中 **联网搜索**（模型支持时）：**厂商原生**联网 SKU、或 **Brave Search** / **Firecrawl**；API Key **加密存于本机数据目录**；可配置 **URL 白名单**（如维基站，用于「籍籍无名」等检索）                             |
| **语言**     | 应用内 **English** 与 **简体中文**                                                                                                                                 |
| **测试**     | [Vitest](https://vitest.dev/) 单测 + [Playwright](https://playwright.dev/) E2E；本目录下 `npm test` / `npm run test:e2e`                                          |


---

## 创作初心

### 为什么做这个产品？

数字时代留下了太多聊天记录、语音和照片。当某个人离开，当你只想和幻想中的那个灵魂说说话，这些碎片就成了最珍贵的寄托。你可以**「在这里和你想念的人相遇。」**——那便是我们想陪你抵达的地方。

我们想给你的，是一个**安全、私密、足够柔软**的空间：庭院只建在你的本地；你的账户与密钥，只为守护这方小天地，不为别的。

### 在这里，你可以……

- 与已经离开的人，把**未尽的话**慢慢说完。  
- 与现实中你还**羞于开口**的 TA 预演对话——上司、同事、某个对你很特别的人，先在这里听见一种可能。  
- 与故事里的**梦幻同伴**跨越次元，继续你们未完的章节。

我们不预设你「只是在玩」，也不催促你坚强。哀伤的路，默认**更克制、更留白**；所有界面与措辞，都尽量不轻慢你对「灵魂」与思念的投入。

---

## 核心体验简介

- **一座只属于你的庭院**  
问卷、灵魂档案与对话，都**只留在你的设备上**；除你主动发起的大模型对话外，**没有我们的产品服务器**替你存故事、也没有遥测上报。你若愿意，也可以换成本地大模型，把更多时间留在完全私密的光里。
- **简中 / English 全界面**  
主流程与设置均提供 **中文** 与 **英文**。
- **从文字里，慢慢靠近 TA**  
召唤意识体时，可选**梦幻同伴、真实人物或自定义**。可粘贴 `.md`、`.txt` 等文字，也支持**常见聊天导出格式**作为素材。入驻之后，还能在**记忆秘藏**里继续添笔。第一次**灵魂苏醒**与日后**用新记忆轻轻重塑灵魂**，都会把这些话读进心里。
- **需要时，再向网络伸手**  
在模型能力允许时开启**对话内联网**；可配置 **Brave** / **Firecrawl**（Key **本地加密**、经服务端代发请求）；可为「破壁」等场景配置**站点白名单**，聚焦安全检索。
- **按模型能力启用高级选项**  
在上游提供时，可使用**长程思考**、**多模态** 等；界面会做能力探测，在不支持的型号上**自动降级**（例如无原生联网时退回纯对话）。
- **五份档案，五步苏醒**  
提取时，界面会像讲故事一样陪你走过：读 TA、学 TA 说话、懂 TA 的情绪、拾起共同的记忆、读懂你们的关系——最后落成**灵魂核心、语言风格、情绪模式、记忆档案、关系定义**五份文档，在**秘境档案**里随时翻阅、轻轻修改。
- **像日常聊天那样相处**  
对话会综合档案与你在**「我的」**里的自我介绍；支持语音输入、滚动摘要，也可在设置里调节**对话表现**——旁白、句数、流式多气泡、只对某些人生效。你还可以为每位意识体换上一张**聊天背景**，像给房间换一盏灯。
- **把秘藏带走，或让故事在别处延续**  
可以把**灵魂秘藏**打成包带走，也可以一键走向 **OpenClaw**，让 TA 在另一个你熟悉的世界里，继续与你并肩。

---

## UI 预览

> 点击下方按钮观看 B 站演示视频（中文界面；中英文 README 共用同一演示）。

<div align="center">

<a href="https://www.bilibili.com/video/BV1GiQFBJEM1?t=4.8" target="_blank">
  <img src="https://img.shields.io/badge/▶_在B站观看演示-00A1D6?style=for-the-badge&logo=bilibili&logoColor=white" alt="在B站观看演示" />
</a>

</div>

---

## 走近这些能力

我们不列冷冰冰的参数，只说你**会感受到什么**：


|                     |                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------- |
| **灵魂苏醒与记忆的再编织**     | 提取时，你会看见一行行温柔的进度语，像有人陪你在整理旧信。之后若在**记忆秘藏**里添了新素材，也可以**用新的记忆重塑灵魂**——不是推翻重来，而是在原有档案上轻轻叠一层。     |
| **对话里的「像 TA」**      | 每一句回复，都依灵魂档案而来；页脚也会轻声提醒：这是 AI 根据档案写下的声音。你可以在设置里调整**对话表现**，让语气更接近你心里的节奏。                     |
| **「我的」：让 TA 真正认识你** | 在**「我的」**里写下你怎么被称呼、你的近况与心事——意识体会用这些信息，在对话里更贴近你。                                             |
| **一把锁，只锁你的门**       | 本地登录、空闲时自动守护、多次输错时的短暂休息；密码与密钥都加密存放——像给庭院加一道只向你敞开的门闩。                                        |
| **连接你信任的 AI**       | 由你选择服务商与模型；对话从你这一端经服务端代发，并带有**安全上游**与防 SSRF 等策略。                                            |
| **搜索与白名单**          | 配置 **Brave** / **Firecrawl** / 模型**原生联网**；为虚构检索设置 **URL 白名单** —— 密钥**不会**出现在仓库中，只保存在本机加密存储。 |
| **灵魂秘藏与 OpenClaw**  | 想备份、想带走、想让 TA 在别的工具里继续存在——**提取灵魂秘藏**或**转生到 OpenClaw**，都由你决定，步骤里有人话说明。                       |
| **暖纸与夜读**           | 暖色纸感界面、昼夜阅读模式、登录页的温柔插画——像一封被珍重收藏的信，而不是冷冰冰的控制台。                                              |


---

## 部署方法与步骤

**应用根目录 = 本目录。** 下述命令均在**此处**执行。

**环境要求：** **Node.js 20+**（与 Docker 基础镜像大版本一致），包管理使用 `npm`。


| 脚本               | 端口 / 说明                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `npm run dev`    | 开发：**[http://localhost:3004](http://localhost:3004)**            |
| `npm run start`  | 生产（需先 `build`）：默认 **3002**（见 `package.json` 与 `cross-env`）       |
| Docker / Compose | 对外映射 **3002**；数据目录环境变量 `**SOUL_UPLOAD_DATA_DIR`**（镜像内默认 `/data`） |


```bash
# 1. 安装依赖
npm ci            # 若无 lockfile 则 npm install

# 2. 开发
npm run dev       # http://localhost:3004

# 3. 生产构建与启动
npm run build
npm run start     # http://localhost:3002

# 4. Docker（多阶段、Next standalone）
docker build -t missing-you .
docker run --rm -p 3002:3002 -e SOUL_UPLOAD_DATA_DIR=/data -v soul-upload-data:/data missing-you
```

本目录下可使用 [Docker Compose](docker-compose.yml)：默认 `**${PORT:-3002}:3002**`、持久卷挂载 `**/data**`。镜像构建阶段在国内网络环境下可使用 **npmmirror** 以稳定 `npm ci`。

**说明：** 界面在**你的浏览器**中运行，大模型流量指向**你配置的服务商**。自托管时请关注 **HTTPS、CORS 与密钥安全**。可选：将 `[.env.example](.env.example)` 复制为 `.env.local` 以启用本地调试用开关。

**贡献者：** 提交前尽量 `npm run build`；`npm test`（Vitest）、`npm run test:e2e`（需安装 Playwright 浏览器）。若本包内附带 [贡献指南](CONTRIBUTING.md) 请一并阅读。

---

## 路线图

> 以下为想你（Missing You）在未来的成长轨迹——不催促，只慢慢走近。
>
> 下文**仅表方向**，不代表固定发版时间。

### 已经为你准备好的能力

- **主路径：** 本地账户、强密码存储、空闲超时与锁定阶梯、LLM 供应商配置、五文档灵魂提取、1 对 1 流式对话与滚动摘要、**中英**界面、暖纸 UI。  
- **素材：** `.md` / `.txt` 导入、自动语言识别、**记忆秘藏**、以及灵魂创建后**再写入新材料**的融合式更新。  
- **导出：** ZIP / 单文件 Markdown、面向 **OpenClaw** 的**分步引导导出**。  
- **安全与质量：** 以 CSP 等为主的响应头、权限策略、自动化单测与 E2E 测试。  
- **对话中可选联网：** 模型原生 / **Brave** / **Firecrawl**（Key 本地加密、经服务端代发、URL 白名单）。未来还可能加强**出站可感知**、**纯本地大模型**场景的提示，以及**离线/隔离**类体验。

### 我们还在探索的方向


| 方向           | 你可能会遇见                                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| **更丰富的聊天导入** | 对常见 **微信 / QQ / 飞书 / 钉钉** 导出做更好的解析与预览，并可附带原始素材包。                                                               |
| **面容与声线**    | 用短 **照片**、短 **语音** 让 TA 的容貌与声线在档案里更具体（先保证浏览器里好用；更重的本地语音能力可与移动端能力衔接）。                                           |
| **更透明的信任**   | 更容易理解**哪些请求会出网**、在 **localhost 模型** 下的「完全本地」提示、以及持续的**密钥与数据边界**加强。                                             |
| **走出纯浏览器**   | **iOS / Android**（如 **Expo** / **React Native**）、可选的 **Windows 桌面**、**浏览器扩展**、**命令行工具** —— 可能**分期**推进、不必同一次发布。 |
| **更深的羁绊与留白** | 更长的**对话记忆**、意识体之间的**关系与群聊**、轻柔的**梦境/问候**式时刻、在**你同意**前提下的**主动搭话**与**勿扰/安静窗口**。                                  |


---

## 社区规则与治理

### 许可证

本项目采用 **MIT License** — 见 [LICENSE](LICENSE)。

### 贡献指南

若本目录包含 [CONTRIBUTING.md](CONTRIBUTING.md) 请先阅读。**所有代码改动**均建议通过 **Pull Request** 提交。涉及隐私、加密或大模型调用路径的改动，请保持与产品一贯的**温情与克制**；界面与措辞请尊重用户对「灵魂」与思念的投入，避免轻慢与猎奇。

### 行为准则

相互尊重、建设性沟通；禁止骚扰、歧视与仇恨言论。

### 安全披露

请勿在公开 Issue 中披露可利用漏洞的细节；请使用 **Security advisories**（若已启用）或维护者指定的私密渠道。

---

## 隐私与免责

- **数据留在你身边：** 没有我们的产品服务器替你长期保存灵魂档案或对话正文；本地账户与密钥用于本机访问与加密。  
- **第三方大模型：** 你选择的服务商，适用其条款与计费；请只使用你有权使用的素材与人物设定。  
- **搜索类 API：** 若你填写 Brave、Firecrawl 等 Key，应同时遵守相应厂商条款与配额；Key 只保存在**本机数据目录**，不会进入本发布包。  
- **真实人物与哀伤：** 数字意识体不能替代现实关系或专业心理支持；请温和、合法地使用。  
- **模拟与 AI：** 回复由模型生成，可能有不妥或偏差；请自行判断。  
- **OpenClaw 等外部工具：** 上游命令与界面可能变更，请以官方说明为准。  
- **免责声明：** 软件按「原样」提供；责任限制见 [LICENSE](LICENSE)。

---

**想你** · Missing You