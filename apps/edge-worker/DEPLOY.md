# Edge Worker — Deploy Runbook

Reproducible deploy steps for the Yannis EOSE edge worker.

Two envs are configured in [`wrangler.toml`](./wrangler.toml):

| Env flag | Worker name | Form hostname | API target | Cloudflare account |
|---|---|---|---|---|
| `--env gcp-dev` | `yannis-edge-worker-gcp-dev` | `dev-form.hqyannis.com` | `dev-api-office.hqyannis.com` | hqyannis.com |
| `--env production` | `yannis-edge-worker-prod` | `form.hqyannis.com` | `api-office.hqyannis.com` | hqyannis.com |

> The bare `wrangler deploy` (no `--env`) targets the legacy AWS dev worker on `roguedevtech.com`. **Don't** deploy that one unless you're working on the AWS adapter; it lives in a different Cloudflare account.

---

## Prerequisites (one-time per machine)

```bash
pnpm install
pnpm --filter @yannis/edge-worker exec wrangler login
# browser opens — sign in as the hqyannis.com Cloudflare account owner
pnpm --filter @yannis/edge-worker exec wrangler whoami
# confirm the email + account list shows the hqyannis.com account
```

---

## Per-env deploy (do once per environment)

Replace `<ENV>` with `gcp-dev` or `production`. Replace `<ENV_LABEL>` with `gcp-dev` or `prod` to match the placeholder names in `wrangler.toml`.

### 1. Get the Cloudflare account ID

```bash
pnpm --filter @yannis/edge-worker exec wrangler whoami
# copy the "Account ID" column for the hqyannis.com account
```

Paste into `wrangler.toml` under `[env.<ENV>] account_id = "..."`.

### 2. Create the 4 KV namespaces in the target account

```bash
cd apps/edge-worker
pnpm exec wrangler kv namespace create DEDUP_CACHE      --env <ENV>
pnpm exec wrangler kv namespace create RATE_LIMIT_CACHE --env <ENV>
pnpm exec wrangler kv namespace create INVENTORY_CACHE  --env <ENV>
pnpm exec wrangler kv namespace create CAMPAIGN_CACHE   --env <ENV>
```

Each command prints an `id = "..."` line. Paste those four IDs into the matching `[[env.<ENV>.kv_namespaces]]` blocks in `wrangler.toml`.

### 3. Create a Turnstile site

Done in the Cloudflare dashboard (no wrangler command yet):

1. Cloudflare dashboard → **Turnstile** → **Add site**.
2. Name: `yannis-form-<ENV_LABEL>` (e.g. `yannis-form-gcp-dev`).
3. Domain: `dev-form.hqyannis.com` (or `form.hqyannis.com` for prod).
4. Widget mode: **Managed**.
5. Save → copy the **Site Key** into `wrangler.toml` → `[env.<ENV>.vars] TURNSTILE_SITE_KEY`.
6. Store the **Secret Key** as a Worker secret (the edge worker — not the API — verifies tokens):

```bash
cd apps/edge-worker
printf '%s' '<paste-secret-key>' | pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --env <ENV>
```

Worker secrets are stored encrypted by Cloudflare and don't appear in `wrangler.toml` or git.

### 4. Add the DNS record so the Worker route can attach

Cloudflare dashboard → **DNS** → **Records** → **Add record**:

| Field | Value |
|---|---|
| Type | `A` |
| Name | `dev-form` (or `form` for prod) |
| IPv4 | `192.0.2.1` (RFC 5737 dummy — Workers intercepts before origin) |
| Proxy status | **Proxied** (orange cloud — required for Workers routes) |
| TTL | Auto |

The IP doesn't matter because the Worker intercepts every request at the edge. Proxy MUST be on; DNS-only records don't trigger Worker routes.

### 5. Deploy

```bash
cd apps/edge-worker
pnpm exec wrangler deploy --env <ENV>
```

### 6. Smoke test

```bash
curl -I https://dev-form.hqyannis.com/    # or form.hqyannis.com for prod
# Expect: 200/302 from the Worker (not a Cloudflare error page)
```

Tail live logs while testing:

```bash
pnpm exec wrangler tail --env <ENV>
```

---

## When wrangler.toml drifts from real Cloudflare state

If you suspect KV IDs / account ID / Turnstile keys don't match what's actually in the account, the audit commands are:

```bash
# List KV namespaces in the currently-authed account
pnpm exec wrangler kv namespace list

# List deployed workers
pnpm exec wrangler deployments list --name yannis-edge-worker-gcp-dev

# Show the live wrangler.toml that's running
pnpm exec wrangler deployments view --name yannis-edge-worker-gcp-dev
```

---

## Rollback

Wrangler keeps the last 10 deployments per worker:

```bash
pnpm exec wrangler deployments list --name yannis-edge-worker-gcp-dev
pnpm exec wrangler rollback --name yannis-edge-worker-gcp-dev --message "rollback to <id>"
```
