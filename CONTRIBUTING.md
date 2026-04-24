# Contributing to Missing You

Thank you for your interest in **Missing You: Soul Garden** (`想你：意识庭院`).

## Repository policy (GitHub)

- **`main` is protected:** direct pushes are not allowed; changes land via **Pull Request** only. At least **one approving review** is required before merge (fork PRs and branches from trusted collaborators go through the same review).
- **You cannot turn off forking** on a public repository — anyone may fork to propose changes, but they **cannot** merge to `main` without maintainer action. **Dependabot** and similar bots should be **Allowlisted** in Settings or reviewed like any other PR.
- To tighten inbound changes further: enable **required reviewers**, **dismiss stale reviews** on new pushes, and (optionally) **CODEOWNERS** and **signed commits** under *Settings → Rules* / branch protection (see the live repo for the exact state).

## Workflow

1. **Open an issue** first for larger changes (architecture, privacy, encryption, or LLM integration) so maintainers can align early.
2. **Fork** the repository and create a **feature branch** from `main`.
3. **Open a Pull Request** into `main`. Community contributions require **at least one approving review** from a maintainer before merge (see branch protection on `main`).
4. At the app root, run **`npm ci`** (or `npm install`) and **`npm run build`** before submitting. Fix any TypeScript or build errors.

**Solo maintainer note:** Pull request authors cannot approve their own PRs on GitHub. If you are the only administrator, use GitHub’s **administrator merge** / merge when checks allow (as your org or plan permits), or add a trusted co-maintainer for reviews—so external contributors are still gated by a real approval.

## Values

- Respect what users invest in **souls** and longing — do not mock, sensationalize, or treat grief as a gimmick.
- Changes touching **privacy**, **encryption**, or **model calls** should stay consistent with the product’s warmth and restraint.
- Prefer small, reviewable PRs with a short description of **what** changed and **why**.

## Security

Do **not** post exploit details in public issues or PRs. Use [GitHub Security advisories](https://docs.github.com/en/code-security/security-advisories) or contact maintainers through a private channel if offered in `SECURITY.md`.

## Language

User-facing copy is **bilingual (zh / en)** where the app already supports it; keep tone aligned with existing Warm Paper style.
