# Data and privacy

SembleOps is self-hosted. The operator decides where it runs, which integrations are enabled, what data is entered, which providers receive prompts, and how long local data and backups are retained.

The project maintainers do not operate a SembleOps cloud service and do not receive self-hosted task data. The application code does not intentionally send project-owned analytics or telemetry to the maintainers. Infrastructure, package managers, model providers, CLI tools, Discord, reverse proxies, and hosting platforms may have their own logging and telemetry under their respective terms.

## Data inventory

Depending on enabled features, an installation may process or store:

| Data | Typical location | Notes |
|---|---|---|
| Tasks, due dates, status, and history | SQLite database | May reveal personal or business commitments |
| Prompts, routing records, and agent results | SQLite database | May include user input and model-generated content |
| Content ideas and review packets | SQLite database and configured artifact paths | Treat as private working material |
| Discord identifiers and message metadata | SQLite database and Discord | Discord retains its own copy under its policies |
| Delivery and cost metadata | SQLite database | May identify usage patterns and enabled providers |
| Voice input | Memory during transcription | Raw audio is not intentionally persisted by the application; providers may retain requests under their terms |
| Repository names, prompts, diffs, and coding results | Worker, SQLite, CLI/provider logs | May expose source or confidential context if delegated |
| Secrets | `.env`, host environment, or a secret manager | Never store in prompts, issues, screenshots, or Git |
| Logs and backups | Host-defined locations | Can duplicate any of the above |

Inspect the current database migrations and provider requests before using SembleOps in a regulated or unusually sensitive environment. This document describes intended project behavior, not a compliance certification.

## External processors

Data leaves the host only when an enabled feature requires it:

- OpenAI receives prompts or audio sent through the API-backed runtime or transcription path.
- Discord receives bot messages and content submitted through Discord.
- A locally installed AI CLI may contact its provider and retain local or remote logs according to its own configuration.
- A VPS, container platform, proxy, DNS provider, or monitoring service can observe operational metadata and may store application data if configured to do so.

Review provider terms, retention controls, training settings, data residency, and incident history before use. Use separate provider projects and least-privilege keys when available.

## Data minimization

- Enter only the context necessary for the task.
- Do not place credentials or authentication material in prompts.
- Avoid health, financial, legal, employment, customer, child, biometric, or similarly sensitive data unless you have evaluated the provider, retention, and legal implications.
- Keep coding prompts scoped; a coding worker can send repository-derived context to its configured runtime.
- Use synthetic data in screenshots, issues, tests, and demonstrations.
- Disable Discord, remote workers, voice, or API runtimes when they are not needed.
- Use a dedicated project root containing only repositories the coding worker may access.

## Retention and deletion

SembleOps does not impose a universal retention schedule. Operators should define one for database rows, artifacts, application logs, reverse-proxy logs, provider history, Discord messages, and backups.

Before destructive maintenance, make and verify an encrypted backup. To retire an installation:

1. Stop the hub and any workers.
2. Revoke provider, Discord, hub, and worker credentials.
3. Delete the SQLite database, configured artifact/transcript directories, logs, and unneeded backups.
4. Delete related Discord messages and provider-side history where the provider supports it.
5. Remove persistent volumes, VM images, snapshots, and secret-manager entries.

Deleting local data does not delete copies already sent to a provider, Discord, a backup service, a model CLI, or another operator-controlled system.

## Backups

- Encrypt backups at rest and in transit.
- Limit backup access separately from application access.
- Keep retention finite and documented.
- Test restoration on a schedule.
- Do not publish databases or backups as issue attachments.

## Multi-user and organizational use

The current application assumes a single trusted operator. A shared organizational deployment would need user identities, per-user authorization, tenant boundaries, audit access controls, retention administration, legal notices, export/deletion workflows, and abuse controls. A shared access token is not an adequate substitute.
