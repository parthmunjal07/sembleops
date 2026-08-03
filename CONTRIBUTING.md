# Contributing to SembleOps

Thanks for helping improve SembleOps. Contributions are welcome for bug fixes, security hardening, documentation, tests, accessibility, adapters, and focused product improvements.

## Before starting

- Search existing issues and pull requests first.
- Open an issue before a large architectural change so maintainers and contributors can align on scope.
- Keep the single-operator, self-hosted trust model explicit. A change that turns SembleOps into a multi-user service needs a separate design and threat-model review.
- Never include real API keys, user data, private prompts, database files, personal profile assets, machine-specific paths, or employer/customer information in an issue, fixture, screenshot, commit, or pull request.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Development setup

SembleOps requires Node.js 22 or newer.

```sh
npm ci
cp .env.example .env
cp config/sembleops.example.yaml config/sembleops.yaml
npm run migrate
npm run dev
```

Use fake values and temporary data for development. The web interface can run without Discord credentials. AI-backed behavior requires your own API key or an authenticated supported CLI.

Before submitting a change, run:

```sh
npm run typecheck
npm run test --if-present
npm run build
npm audit --omit=dev --audit-level=high
```

Add or update tests for behavior changes. Update the example configuration and public documentation when introducing a setting, credential, provider, network route, stored field, or trust-boundary change.

## Pull requests

Keep each pull request focused. In its description, include:

- the problem and intended outcome;
- the security, privacy, migration, and cost impact;
- how the change was tested;
- screenshots for visible interface changes, using synthetic data only;
- any follow-up work or known limitations.

Maintainers may ask for changes to preserve backward compatibility, keep provider costs operator-controlled, or reduce access to secrets and local files.

## Developer Certificate of Origin

This project uses the [Developer Certificate of Origin 1.1](https://developercertificate.org/) instead of a contributor license agreement. Every commit must include a `Signed-off-by` line certifying that you have the right to submit the contribution under this project's license.

```sh
git commit -s -m "Describe the change"
```

The sign-off uses the name and email configured for Git commits:

```text
Signed-off-by: Contributor Name <contributor@example.com>
```

By signing off, you certify the DCO. This is not a cryptographic signature. If you did not create all of the submitted material, confirm that each dependency, snippet, fixture, and asset can legally be contributed under its applicable license and record required attribution.

## Contribution license

Unless you explicitly mark a communication as "Not a Contribution," intentionally submitted contributions are licensed under Apache-2.0 as described in section 5 of [LICENSE](LICENSE).

## Conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
