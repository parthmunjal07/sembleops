# Deployment

Start with a local-only installation. Move to a networked hub only when the benefit justifies the additional secret management, TLS, firewall, backup, and monitoring work.

SembleOps is single-operator software and SQLite expects one hub writer. Run exactly one hub instance. A remote coding worker is optional and opens no inbound port.

## Before any deployment

1. Copy `.env.example` to `.env` and set only the credentials you use.
2. Generate independent hub and worker secrets of at least 32 characters:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Set a provider-side budget and usage alerts for the account behind `OPENAI_API_KEY`.
4. Put only trusted repositories under the coding projects root and list each permitted direct child in `coding.allowed_projects`.
5. Encrypt the host disk and backups.
6. Read [the threat model](threat-model.md).

Never reuse the same value for `HUB_ACCESS_TOKEN` and `WORKER_TOKEN`. Never put either token in a URL.

## Local-only installation

The example local config binds the server to `127.0.0.1`. This is the recommended mode for a workstation.

```sh
npm ci
cp .env.example .env
cp config/sembleops.example.yaml config/sembleops.yaml
npm run migrate
npm run build
npm start
```

Edit `config/sembleops.yaml` before starting. `coding.allowed_projects` is an exact allowlist; an empty list disables coding-project access. The application rejects symlinks and junctions as project roots, but the coding CLI still runs with the permissions of the operating-system account. Use a low-privilege account or VM for additional isolation.

Do not change `server.host` to `0.0.0.0` merely to access the UI from another device. Prefer an authenticated private network or an SSH tunnel while retaining loopback binding:

```sh
ssh -L 4747:127.0.0.1:4747 user@trusted-host
```

## Container on a VPS

The included Dockerfile runs a cloud-style hub as a non-root container user. Its built-in configuration binds inside the container, requires access and worker tokens, stores data under `/app/data`, and queues coding work for a remote worker.

Prepare a host directory and an environment file readable only by the administrator and container runtime. The exact ownership model varies by host; ensure the container's non-root user can write the data directory.

```sh
docker build -t sembleops:local .
docker run -d --name sembleops --restart unless-stopped \
  -p 127.0.0.1:4747:4747 \
  -v /srv/sembleops/data:/app/data \
  --env-file /srv/sembleops/sembleops.env \
  sembleops:local
```

At minimum, the environment file for this topology contains unique values for:

```dotenv
OPENAI_API_KEY=your-own-key
HUB_ACCESS_TOKEN=at-least-32-random-characters
WORKER_TOKEN=a-different-32-character-or-longer-secret
```

Discord values are optional. Place Caddy, nginx, or another maintained reverse proxy in front of `127.0.0.1:4747`, terminate HTTPS there, and restrict access with a firewall, VPN, or identity-aware proxy. Configure request logs so they do not capture cookies, authentication headers, prompts, or request bodies.

Do not publish port 4747 directly. The in-app token is a bearer secret, not MFA or a complete account system.

## Fly.io example

[`fly.example.toml`](../fly.example.toml) is an unbound template. It deliberately contains no application name or personal region and is not a production deployment trigger.

Create a unique app and copy the template locally:

```sh
fly apps create <your-app-name>
cp fly.example.toml fly.toml
```

Add these installation-specific values to the top of the ignored `fly.toml`:

```toml
app = "<your-app-name>"
primary_region = "<your-region>"
```

Create the single persistent volume in the same region, set secrets, and deploy:

```sh
fly volumes create data --app <your-app-name> --region <your-region> --size 1
fly secrets set --app <your-app-name> \
  OPENAI_API_KEY=... \
  HUB_ACCESS_TOKEN=... \
  WORKER_TOKEN=...
fly deploy --app <your-app-name>
fly scale count 1 --app <your-app-name>
```

Add optional Discord secrets in the same way. Keep one Machine because the application uses SQLite. The example disables autostop so reminders continue to run; this incurs continuous hosting charges. Review current commands, pricing, and volume behavior in the [official Fly.io documentation](https://fly.io/docs/) before deploying.

No repository workflow deploys this application automatically. Each operator owns and approves production changes.

## Remote coding worker

Use a separate worker when the hub should remain always on but source repositories stay on a workstation or private build host. The worker polls the hub over outbound HTTPS.

On the worker machine:

1. Install Node.js 22 or newer and run `npm ci` from a matching SembleOps checkout.
2. Install and authenticate Codex or Claude Code for the low-privilege worker account.
3. Copy `.env.example` to `.env` and set:

   ```dotenv
   HUB_URL=https://your-private-hub.example
   WORKER_TOKEN=the-same-worker-secret-configured-on-the-hub
   WORKER_PROJECTS_ROOT=/absolute/path/to/trusted/projects
   WORKER_ALLOWED_PROJECTS=project-one,project-two
   ```

4. Start with `npm run worker`.

Allowlist entries are exact direct-child directory names, not paths or globs. Use separate repository backups or disposable worktrees and review diffs before merging. A worker compromise can affect every file the worker account can access, even when SembleOps validates the requested project path.

Run the worker under a service manager appropriate to the operating system. Protect its environment file and CLI session from other users. Do not place `OPENAI_API_KEY` on the worker unless a separately enabled worker feature requires it.

## Backups and upgrades

Back up the persistent `data/` directory and any separately configured artifact paths while the application is stopped, or use a SQLite-consistent backup method. Encrypt backups and test restoration periodically.

For an upgrade:

1. Read release and migration notes.
2. Stop the hub and worker.
3. Create and verify a backup.
4. Install locked dependencies and build the new version.
5. Run `npm run migrate` once against the target database.
6. Start one hub, inspect logs, then start the worker.
7. Confirm login, task history, runtime availability, and a non-destructive test delegation.

Do not run migrations concurrently from multiple instances.

## Operational checklist

- HTTPS and network restriction are active.
- Hub and worker tokens are unique, random, and stored outside Git.
- Provider MFA, budget alerts, and key restrictions are enabled where available.
- One hub instance owns the SQLite database.
- The data volume persists across container replacement.
- Logs exclude secrets and sensitive request bodies.
- Disk space, authentication failures, provider spend, delivery health, and backups are monitored.
- Credential rotation and restore procedures have been tested.
