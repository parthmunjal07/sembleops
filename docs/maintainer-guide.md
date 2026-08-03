# Maintainer guide

This checklist covers repository publication and maintenance controls that cannot be enforced by source files alone.

## Before making a repository public

- Confirm that the repository owner has the right to license every code, documentation, prompt, fixture, font, image, and other asset in the repository.
- Review employment, client, school, grant, and contributor agreements that could affect ownership or disclosure. Obtain qualified legal advice when ownership is unclear.
- Run a full-history secret scanner and inspect old workflow logs, releases, issue attachments, caches, and package artifacts.
- Rotate provider, Discord, deployment, hub, and worker credentials even if scanning finds no plaintext value.
- Search the full tree and history for names, email addresses, usernames, profile photos, employer/customer references, internal links, machine paths, hostnames, account IDs, and private planning notes.
- Verify third-party licenses and required notices. Replace material with unclear provenance.
- Consider publishing a fresh repository snapshot when old commit metadata, deleted files, workflow history, or forks should not become public. Keep any private archive access-controlled.
- Review the repository host's visibility-change behavior. Public forks and cached copies may remain available after visibility changes.

Making source public is not the same as operating a public service. Do not advertise a shared hosted instance without a new multi-user architecture, legal terms, privacy notice, abuse controls, and operational capacity.

## GitHub repository settings

Enable and verify:

- private vulnerability reporting;
- Dependabot alerts and security updates;
- secret scanning, including validity checks when available;
- push protection for contributors and custom patterns for project-specific secrets;
- CodeQL default setup or the repository's pinned CodeQL workflow;
- branch protection or rulesets for the default branch;
- required pull requests, required CI and CodeQL checks, and dismissal of stale approvals;
- signed commits or vigilant mode if the maintainer policy requires them;
- restricted creation of releases, tags, and deployment environments;
- minimal GitHub Actions token permissions at the organization/repository level;
- only required Actions and reusable workflows.

Do not add production credentials to workflows that run on pull requests. Use protected environments with manual approval for any future deployment automation. The repository intentionally contains no automatic production deployment.

## Release checklist

- Review the diff for secret, identity, private-data, and asset-provenance regressions.
- Run `npm ci`, typecheck, tests, build, and production dependency audit from a clean checkout.
- Review dependency and CodeQL alerts.
- Test a new installation using only tracked examples.
- Test upgrade and database restore from the previous supported release.
- Document migrations, breaking changes, security impact, and new provider costs or data flows.
- Tag and publish from a protected branch after checks pass.

## Ongoing maintenance

- Triage vulnerability reports privately and publish advisories when fixes are available.
- Keep workflow actions pinned to reviewed commit SHAs; let Dependabot propose updates.
- Review dependency licenses and runtime requirements during upgrades.
- Remove stale integrations, tokens, collaborators, environments, packages, and artifacts.
- Revisit [the threat model](threat-model.md) for every new connector or autonomous action.
- Keep support expectations accurate; absence of maintainer capacity should never be hidden behind an implied SLA.
