# Security policy

## Supported versions

Security fixes are made on a best-effort basis for the latest release and the current default branch. Early releases may include breaking configuration or migration changes.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Default branch | Yes |
| Older releases | No |

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability or include secrets, exploit details, personal data, prompts, repository contents, or database records in a public discussion.

Use GitHub's **Report a vulnerability** option on the repository Security page. Include:

- affected version or commit;
- deployment mode and relevant configuration with secrets redacted;
- impact and prerequisites;
- minimal reproduction steps or a proof of concept;
- suggested mitigation, if known.

If private vulnerability reporting is temporarily unavailable, open a public issue containing only a request for a private maintainer contact. Do not disclose technical details until a private channel is established.

Maintainers will acknowledge reports and coordinate next steps when capacity permits. This community project provides no guaranteed response or remediation time. Please allow a reasonable remediation window before public disclosure.

## Operator responsibilities

SembleOps is self-hosted, single-operator software. Operators are responsible for:

- keeping the host, Node.js, containers, CLIs, and dependencies patched;
- using unique, randomly generated `HUB_ACCESS_TOKEN` and `WORKER_TOKEN` values;
- terminating TLS at a trusted reverse proxy before any non-loopback deployment;
- restricting network access with a firewall, VPN, or identity-aware proxy;
- storing `.env`, databases, artifacts, transcripts, and backups securely;
- limiting the worker to trusted repositories and a low-privilege operating-system account;
- configuring budgets and protecting provider accounts with MFA;
- rotating a credential immediately if it may have been exposed.

This project does not provide tenant isolation or safe execution for mutually untrusted users. Bearer tokens are shared secrets, not a full identity or authorization system.

See [docs/threat-model.md](docs/threat-model.md) and [docs/deployment.md](docs/deployment.md) for the complete boundary.

## Secret exposure response

Removing a secret from the current tree is not sufficient. If a key or token appears in a commit, log, screenshot, build artifact, issue, or model prompt:

1. Revoke or rotate it at the provider.
2. Stop affected services if active abuse is possible.
3. Review provider usage and access logs.
4. Remove the value from distributed artifacts and, when appropriate, rewrite repository history.
5. Notify affected users or providers when required.

Assume any secret committed to a public repository has been compromised.

## Scope notes

Useful reports include authentication bypasses, path-containment failures, command injection, unsafe file access, cross-site request attacks, secret disclosure, malicious migration behavior, and dependency or workflow compromise.

Model hallucination, prompt injection, and unsafe generated code remain important product risks. They are security vulnerabilities when they cross an enforced trust boundary or permit unauthorized actions; otherwise, report them as hardening issues without sensitive data.
