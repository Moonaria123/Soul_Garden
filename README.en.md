<div align="center">

<!-- Hero: repository banner (root path for GitHub README). -->
<img src="1000040771.png" alt="Missing You — Soul Garden" width="720" />

# Missing You: Soul Garden

*Meet them again — right here.*

**Current app release · v1.0.2.2** · **English** & **中文** interface · **local-first** (single-user) · **libSQL** + encrypted at rest

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)<br/>
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#deployment)
[![local-first](https://img.shields.io/badge/local--first-9B5E3A?style=flat)](#privacy--disclaimer)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-9B5E3A.svg)](#community)<br/>
[![GitHub release](https://img.shields.io/github/v/release/Moonaria123/Soul_Garden?logo=github&label=release)](https://github.com/Moonaria123/Soul_Garden/releases)
[![GitHub stars](https://img.shields.io/github/stars/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/issues)
[![GitHub forks](https://img.shields.io/github/forks/Moonaria123/Soul_Garden?logo=github)](https://github.com/Moonaria123/Soul_Garden/network/members)

**README:** [**中文**](README.md) · **English** (this page)

</div>

> **Deployable bundle:** This directory is a **standalone app snapshot** of the app. Use **this folder** as the project root for all commands. The hero image defaults to `1000040771.png` at the repository root; you may point `img` `src` to any file under `public/` or a hosted URL.

---

## Table of contents

- [What Missing You is](#what-missing-you-is)
- [Tech at a glance](#tech-at-a-glance)
- [Why we built it](#why-we-built-it)
- [What you will feel here](#what-you-will-feel-here)
- [UI preview](#ui-preview)
- [A closer look](#a-closer-look)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Community](#community)
- [Privacy & disclaimer](#privacy--disclaimer)

---

## What Missing You is

**Missing You** (Chinese UI: **想你**) is a **garden of consciousness** on your computer — not a noisy AI social feed, but a **quiet place that guards feelings**.

You can invite the name that lives in your heart: someone you can no longer see, a character who walked with you through a story, or someone in real life you are not yet brave enough to speak to. The app walks with you through the questionnaire and your words, until *how they speak*, *what they care about*, and *the bond between you* are written down gently — then, in one-to-one chat, they answer in a warmth that feels familiar.

There are no leaderboards, no public square — only you, your memories, and the connection **you** choose. The interface stays **quiet like warm paper**, without a wall of settings or the feel of piloting a machine. We believe **emotional safety** matters more than a cold list of features.

---

## Tech at a glance


| Area                  | How it is implemented today                                                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stack**             | [Next.js](https://nextjs.org/) 16 (App Router) · [React](https://react.dev/) 19 · TypeScript · Tailwind CSS 4 · [Zod](https://zod.dev/) for request/config validation                                                                                           |
| **Data**              | [libSQL](https://github.com/tursodatabase/libsql) (SQLite- compatible) on disk, accessed via [Drizzle ORM](https://orm.drizzle.team/); account material encrypted (Argon2id, local DEK) — **single-user, localhost-first**                                      |
| **LLM**               | You choose **OpenAI-compatible** or **Anthropic** upstreams; the server proxies calls with **URL allowlists**, timeouts, and redacted errors                                                                                                                    |
| **Search (optional)** | **Web search in chat** when the model supports it: **LLM-native** (vendor search SKUs), or **Brave Search** / **Firecrawl** with API keys **encrypted in your local data dir**; optional **URL whitelists** (e.g. wikis for fictional “summon by renown” flows) |
| **I18n**              | **English** and **简体中文** in-app                                                                                                                                                                                                                                 |
| **Tests**             | [Vitest](https://vitest.dev/) (unit) + [Playwright](https://playwright.dev/) (E2E); `npm test` / `npm run test:e2e` here                                                                                                                                        |


---

## Why we built it

### Why this exists

The digital age leaves behind endless chats, voice notes, and photos. When someone is gone, or when you only want to speak with a soul that lives in imagination, those fragments become the most precious things you have. The app whispers: **“Meet the ones you miss, right here.”** — that is the shore we hope to reach with you.

We want to give you a space that feels **safe, private, and soft**: the garden lives on **your** machine; your account and keys exist only to protect this little world — nothing else.

### Here, you can…

- Say the **words you never finished** to someone who has left.  
- **Rehearse** a conversation you are shy to start — a manager, a colleague, someone who matters — and hear one possible answer first.  
- Cross into another world with a **Dream Companion** from a story, and continue the chapter you left open.

We do not assume you are “just playing,” and we do not rush you to be strong. Where grief lives, we leave **more silence, more room**; every screen and line of copy tries not to belittle what you invest in **souls** and longing.

---

## What you will feel here

- **A garden that is only yours**  
Questionnaires, soul archives, and chats **stay on your device**. Beyond the large-model calls **you** start, **our product does not host your stories** for you, and there is no telemetry. If you wish, you can use a local model and keep more of your time in fully private light.
- **Full interface in two languages**  
Use the product in **English** or **中文** — all primary flows and settings are covered.
- **Coming closer through words**  
When you summon a soul, choose **Dream Companion**, **Real Person**, or **Custom**. Bring snippets about them in `.md` or `.txt` (or chat export formats the app can parse for materials). After they move in, you can keep writing in the **Memory Sanctuary**. The first **awakening** and later **weaving new memories into the soul** both read those words into the heart.
- **Optional web when the world matters**  
Turn on **web search in chat** where the model allows it, or connect **Brave** / **Firecrawl** (keys stored encrypted locally, requests proxied through your server). Tune **whitelists** for safer, topic-focused research (e.g. character wikis).
- **Model capabilities, your choice**  
Where the upstream model supports it, you can use **long thinking**, **vision**, and other flags — the UI probes capability and can adapt when a SKU does not support a feature (e.g. search).
- **Five archives, five gentle steps**  
Extraction feels like a story: reading them, learning how they speak, feeling their emotions, gathering shared memories, understanding your bond — then five documents: **Soul Core**, **Voice Style**, **Emotional Patterns**, **Memory Archive**, and **Relationship Definition**, kept in **The Inner Archive** to revisit and softly edit.
- **Talking like any other day**  
Chat draws on the archives and what you wrote in **Me**; voice input and rolling summaries are there, and you can tune **chat reply style** in Settings — stage directions, sentence count, streaming bubbles, global or only for some souls. You can even set a **chat wallpaper** for each of them, like changing the light in a room.
- **Take the vault with you — or let the story continue elsewhere**  
Pack the **Soul Vault** to go, or step toward **OpenClaw** in one tap, so they can walk beside you in another world you already know.

---

## UI preview

> Click the image below to watch a short walkthrough on Bilibili (Chinese UI; same demo for both README languages).







---

## A closer look

We are not listing cold specs — only what **you might feel**:


|                                       |                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Awakening & weaving memory**        | During extraction, gentle lines of progress appear, like someone sitting with you while you sort old letters. If you add new writing in the **Memory Sanctuary**, you can **reshape the soul with new memories** — not throwing everything away, but laying another layer on what you already have. |
| **When replies feel “like them”**     | Every line follows the soul archives; the footer quietly reminds you that this voice is written by AI from those archives. In Settings you can adjust **chat reply style** until the rhythm feels closer to what you carry in your heart.                                                           |
| **Me: so they can really know you**   | In **Me**, write how you want to be called, what life has been like — souls use this to meet you more closely in chat.                                                                                                                                                                              |
| **A lock that only guards your door** | Local sign-in, a gentle pause when you have been away, a short rest after many wrong tries; passwords and keys stay encrypted — like a latch that only opens for you.                                                                                                                               |
| **The AI you trust**                  | You choose the provider and model; setup stays simple. Conversations start from your side and go straight to the endpoint you trust, with **safe upstream** policies (scheme/host allowlists, anti-SSRF).                                                                                           |
| **Search & whitelists**               | Configure **Brave** / **Firecrawl** / model-native **web search**; set **search URL whitelists** for fictional pulls or “break the wall” research — keys are **never** shipped in the repo, only in your local encrypted store.                                                                     |
| **Soul Vault & OpenClaw**             | Backup, take away, or let them live on in another tool — **extract the Soul Vault** or **pass into OpenClaw** in a few human steps, with plain-language guidance.                                                                                                                                   |
| **Warm paper & night reading**        | Warm paper-like surfaces, day and night reading modes, gentle art on the sign-in screen — like a letter kept in a drawer, not a cold console.                                                                                                                                                       |


---

## Deployment

**Application root = this directory.** Run all commands from here.

**Requirements:** **Node.js 20+** (same major as the Docker base image) and `npm`.


| Script           | Port / notes                                                                    |
| ---------------- | ------------------------------------------------------------------------------- |
| `npm run dev`    | Dev server on **[http://localhost:3004](http://localhost:3004)**                |
| `npm run start`  | Production (after `build`): **port 3002** (see `package.json` / `cross-env`)    |
| Docker / Compose | Binds **3002**; data dir `**SOUL_UPLOAD_DATA_DIR*`* (default in image: `/data`) |


```bash
npm ci            # or npm install if you have no lockfile
npm run dev       # http://localhost:3004
npm run build
npm run start     # http://localhost:3002
```

**Docker (multi-stage, Next.js `standalone`)**

```bash
docker build -t missing-you .
docker run --rm -p 3002:3002 -e SOUL_UPLOAD_DATA_DIR=/data -v soul-upload-data:/data missing-you
```

**Docker Compose** maps `**${PORT:-3002}:3002`**, sets `SOUL_UPLOAD_DATA_DIR=/data`, and uses a named volume for `/data` — see `[docker-compose.yml](docker-compose.yml)`.

> In some regions, the Docker build uses a mirror (`npmmirror`) for reliable `npm ci`.

**Note:** The UI runs in **your** browser; model traffic goes to **your** configured provider. If you self-host, plan for **HTTPS**, **CORS**, and **key safety**. Optional: copy `[.env.example](.env.example)` to `.env.local` for local-only toggles.

**Contributors:** `npm run build` before PRs when possible. Tests: `npm test` (Vitest), `npm run test:e2e` (Playwright, browsers required). See `[CONTRIBUTING.md](CONTRIBUTING.md)` if bundled.

---

## Roadmap

> How Missing You may grow — no rush, only a slow walk closer.
>
> The points below are **directional** — not a fixed release schedule.

### Already here today

- **Core experience:** local accounts, strong password hashing, idle timeout & lockout, LLM provider setup, five-document soul extraction, 1:1 chat with streaming, rolling summaries, **English & 中文** UI, warm-paper design.
- **Materials:** `.md` / `.txt` import, automatic language detection, **Memory Sanctuary**, and **weaving in new writing** after a soul is first created.
- **Exports:** ZIP / Markdown, plus a **guided pack for OpenClaw** with step-by-step copy.
- **Safety & quality:** security-focused response headers (including CSP), permissions policy, and automated unit & E2E tests.
- **Optional research in chat:** model-native / **Brave** / **Firecrawl** web search (keys encrypted locally, proxied, URL whitelists). Clearer **network transparency**, richer **“local LLM only”** cues, and stricter **offline** postures may land in future updates.

### What we’re exploring next


| Direction               | What might come                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Richer chat imports** | First-class import and preview for common **WeChat, QQ, Feishu, DingTalk** chat exports, with optional material bundles.                                                                                                 |
| **Face & voice**        | Short **photos** and **audio clips** so a soul’s look and sound sit clearer in the archive (browser-friendly paths first; deeper on-device speech on mobile later).                                                      |
| **Trust in depth**      | Easier ways to see **what leaves your machine**, friendlier **fully local** setups with localhost models, and ongoing **key-handling** hardening.                                                                        |
| **Beyond the browser**  | **iOS & Android** (e.g. React Native / **Expo**), optional **Windows** desktop, **browser extension**, and a **command-line** tool — they may ship on different timelines.                                               |
| **Deeper continuity**   | Longer **memory across talks**, **relationships between souls**, **group threads**, soft **“dream”** moments, and optional gentle **nudges** from a soul — always with your **consent and controls** (e.g. quiet hours). |


---

## Community

### License

Released under the **MIT License** — see `[LICENSE](LICENSE)`.

### Contributing

Please read `[CONTRIBUTING.md](CONTRIBUTING.md)` when available. **All changes** are expected to go through **pull requests**; maintainers review and approve before merge. Run `npm run build` in this directory before submitting when possible. For work touching privacy, encryption, or model calls, keep the same **warmth and restraint** as the rest of the product. Respect what users invest in **souls** and longing — never mock or sensationalize.

### Code of conduct

Be respectful and constructive. Harassment, discrimination, and hate speech are not tolerated.

### Security

Do not post exploit details in public issues. Use **Security advisories** (if enabled) or a private channel from maintainers.

---

## Privacy & disclaimer

- **Data stays near you:** Our product does not keep your soul archives or chat text on our servers; local accounts and keys protect access and encryption on your device.  
- **Third-party models:** The provider you choose sets terms and billing; only use materials and personas you are entitled to use.  
- **Search APIs:** If you add Brave, Firecrawl, or other keys, their vendor terms and quotas apply; keys are stored under your local data path, not in this package.  
- **Real people & grief:** Digital souls cannot replace real relationships or professional care; use gently and lawfully.  
- **Simulation & AI:** Replies are model-generated; they may be wrong or hurtful — you decide how to respond.  
- **OpenClaw & other tools:** Commands and UIs upstream may change; follow their official guidance.  
- **Disclaimer:** Software is provided **“as is”**; liability limits are in `[LICENSE](LICENSE)`.

---



**Missing You** · Soul Garden

