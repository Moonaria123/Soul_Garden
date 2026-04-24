# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| Latest release on [Releases](https://github.com/Moonaria123/MissingYou/releases) | Yes |
| Older tags | Best-effort, case by case |

## Reporting a vulnerability

**Please do not** open a public issue for security vulnerabilities.

1. Use **GitHub [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)** for this repository if it is enabled, **or**
2. Open a **draft security advisory** with minimal reproduction details so maintainers can coordinate a fix.

Include: affected version/commit, impact, and steps to reproduce when safe to share.

## Scope notes

- User content and LLM **API keys** are intended to stay **on the user’s device** (local-first design). Reports about “API keys in browser storage” are often expected behavior; still report mistakes if **secrets** appear in **logs**, **telemetry**, or **server responses** unintentionally.

## Disclosure

We will work toward a coordinated disclosure after a fix or mitigation is available. Thank you for helping keep users safe.
