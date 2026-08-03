# Threat model

This document states the security boundary for the current self-hosted, single-operator design. Update it when adding a connector, autonomous action, data category, network path, or execution capability.

## Security objectives

SembleOps aims to:

- prevent unauthorized access to the hub and remote-worker protocol;
- keep provider keys, access tokens, databases, artifacts, and repository contents confidential;
- constrain coding work to operator-approved project directories;
- preserve task and audit integrity across failures;
- make networked and destructive actions explicit and reviewable;
- avoid coupling self-hosters to a maintainer-operated account or paid service.

## Trust assumptions

- One operator controls the installation and is trusted to view all application data.
- The host operating system, Node.js runtime, package manager, and administrator account are maintained securely.
- Repositories placed under the configured coding root are trusted enough to be opened by the worker.
- The operator reviews high-impact model output and code changes before use or publication.
- HTTPS termination, DNS, backups, and host firewalls are configured outside the application.
- Provider and Discord accounts are protected independently.

If these assumptions do not hold, the current architecture is not an adequate security boundary.

## Assets

- `OPENAI_API_KEY`, Discord credentials, hub and worker bearer tokens, and CLI sessions;
- task text, prompts, transcripts, artifacts, generated output, and usage metadata;
- SQLite data and backups;
- source repositories available to the coding worker;
- integrity and availability of reminders and task history;
- operator identity and integration metadata.

## Threat actors and failure sources

- an unauthenticated network client reaching a misconfigured hub;
- malware or another local user on the host;
- malicious content embedded in a prompt, message, webpage, document, or repository;
- a compromised model, package, CLI, GitHub Action, hosting, Discord, or API-provider account;
- leaked tokens in Git history, logs, screenshots, shell history, or model context;
- an accidental operator action, model hallucination, path mistake, or unsafe generated command;
- resource exhaustion or runaway provider usage.

## Boundaries and mitigations

| Boundary | Main risks | Required controls |
|---|---|---|
| Browser to hub | Unauthorized access, stolen cookie/token, request forgery | Loopback by default; unique hub token for networked use; HTTPS; restricted network; short-lived sessions where supported |
| Discord to hub | Spoofed input, leaked bot token, hostile message content | Owner allowlist; private bot; minimal Discord permissions; rotate leaked token; treat content as untrusted |
| Hub to model API | Secret disclosure, prompt leakage, cost abuse, unsafe output | Operator-owned key; provider budgets; minimal prompts; output review; never put secrets in prompts |
| Hub to remote worker | Worker impersonation, replay, job tampering, result leakage | Separate worker token; HTTPS; outbound polling; token rotation; private network or identity-aware proxy when practical |
| Worker to repositories | Arbitrary file modification, symlink/path escape, malicious repo instructions | Explicit trusted root; canonical path containment; low-privilege account or VM; repository backups; review diffs before merge |
| Process to SQLite/data | Local disclosure, corruption, ransomware | Restrictive filesystem permissions; disk encryption; single writer; encrypted tested backups |
| Dependencies and CI | Supply-chain compromise, untrusted pull-request code, secret theft | Lockfile installs; pinned workflow actions; minimal workflow permissions; dependency review and updates; no production secrets in pull-request CI |

## Prompt injection and generated code

Every message, document, web result, repository file, and model response can contain adversarial instructions. Persona boundaries and prompts improve behavior but are not security controls.

- Do not give a read/research agent write credentials it does not need.
- Do not place secrets in model context.
- Keep untrusted source text visibly separate from trusted instructions.
- Require human review before publishing, sending, purchasing, deleting, deploying, or merging.
- Treat a repository as potentially executable content: package scripts, hooks, tests, and generated commands can run code.
- Prefer disposable worktrees, VMs, containers, and low-privilege accounts for coding agents.

## Network deployment requirements

When `server.host` is not loopback:

- set a strong `HUB_ACCESS_TOKEN` and fail deployment if it is absent;
- terminate TLS before traffic reaches the application;
- restrict source networks with a firewall, VPN, or identity-aware proxy;
- do not expose the worker protocol without a distinct `WORKER_TOKEN`;
- avoid logging headers, cookies, request bodies, and query strings containing sensitive data;
- monitor failed authentication, provider usage, disk space, and backup health.

The token gate is suitable for a trusted operator on a restricted network. It is not an account system and does not provide per-user authorization, revocation, MFA, tenant isolation, or abuse controls.

## Availability and integrity limits

- SQLite requires a single hub writer; horizontal replicas can corrupt assumptions.
- A provider, Discord, network, or worker outage can delay delivery or agent work.
- Cost counters may lag or differ from provider billing.
- Backups protect only data captured before the backup and only if restoration works.
- Generated facts and code can be wrong even when execution reports success.

## Out of scope

The current project does not claim to defend against:

- a compromised administrator account or host kernel;
- mutually untrusted users or public signup;
- a malicious provider with access to submitted data;
- safe execution of arbitrary hostile repositories;
- legal, medical, financial, safety-critical, or regulatory decision making;
- guaranteed delivery, uptime, data recovery, or spend caps.

## Security review checklist for changes

- Does the change add a secret, network listener, connector, or external recipient?
- Does it expand which files, projects, messages, or database rows an agent can read or write?
- Can untrusted input influence a command, filesystem path, URL, SQL statement, or privileged prompt?
- Does it create a new stored data type or retention copy?
- Can it cause provider charges or an irreversible external action?
- Are authentication, authorization, failure behavior, tests, and documentation updated?
