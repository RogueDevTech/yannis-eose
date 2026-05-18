# Ansible — Yannis EOSE VM post-create config

Ansible owns the reverse proxy + TLS layer on top of the bare VM that Terraform creates. Clean split:

| Layer | Tool | Responsibility |
|---|---|---|
| Infrastructure | [Terraform](../terraform/gcp/) | VM, firewall, public IP, Docker install (startup script) |
| Reverse proxy + TLS | **Ansible** (this dir) | nginx, certbot, server blocks, Let's Encrypt cert |
| App containers | [GitHub Actions](../../.github/workflows/) | Docker build, push, SSH-pull on VM |
| Edge form | [wrangler](../../apps/edge-worker/) | Cloudflare Workers (separate from VM entirely) |

The playbook is **idempotent** — safe to re-run anytime. nginx config is marker-guarded (`/var/lib/yannis-eose/nginx-bootstrapped`) so it doesn't clobber certbot's in-place SSL edits on subsequent runs.

---

## One-time prerequisites

```bash
# Install Ansible on your Mac
brew install ansible

# Confirm the SSH key listed in your group_vars / inventory can reach the VM
ssh evercoresystemsltd@<vm-public-ip>
```

If your SSH user differs from the Terraform `vm_admin_user`, override on the CLI with `-u <user>` or edit `inventory.yml`.

---

## Run against dev

```bash
cd infrastructure/ansible
ansible-playbook playbook.yml --limit dev
```

Tail of expected output on a clean VM:

```
PLAY RECAP *********************
dev-yannis-eose-vm : ok=11   changed=10   unreachable=0   failed=0   skipped=2
```

On the dev VM you've already bootstrapped manually, every nginx-config task is **skipped** (marker is present) — only the package-install + service-enabled tasks run, all idempotent no-ops.

### Re-render nginx config after a hostname change

```bash
ansible dev -m file -a 'path=/var/lib/yannis-eose/nginx-bootstrapped state=absent' --become
ansible-playbook playbook.yml --limit dev
```

> Warning: re-rendering wipes certbot's SSL edits. You'll need to set `provision_tls_certificate: true` so certbot re-issues + re-edits.

---

## Run against prod

**1. Create the prod VM first via Terraform** (separate state file):

```bash
cd ../terraform/gcp
terraform apply -state=prod.tfstate -var-file=terraform.tfvars.prod
# Note the vm_public_ip output.
```

**2. Update inventory** — replace `REPLACE-WITH-PROD-VM-IP` in [inventory.yml](./inventory.yml) with the IP from step 1.

**3. Point Cloudflare DNS** at the prod VM IP (`office`, `api-office` records, DNS-only for cert issuance).

**4. First Ansible pass — HTTP only.** [group_vars/prod.yml](./group_vars/prod.yml) has `provision_tls_certificate: false` by default. This gives you a working HTTP proxy without the TLS chicken-and-egg.

```bash
cd ../../ansible
ansible-playbook playbook.yml --limit prod
```

**5. Verify HTTP works** from your laptop:

```bash
curl -I http://office.hqyannis.com
curl -I http://api-office.hqyannis.com
```

**6. Flip TLS on** — set `provision_tls_certificate: true` in `group_vars/prod.yml`, then reset the marker and re-run:

```bash
ansible prod -m file -a 'path=/var/lib/yannis-eose/nginx-bootstrapped state=absent' --become
ansible-playbook playbook.yml --limit prod
```

Certbot fires this time, issues the cert, edits both server blocks in place to add `listen 443 ssl` + HTTP→HTTPS redirect, and `certbot.timer` is enabled for auto-renewal.

**7. Verify HTTPS**:

```bash
curl -I https://office.hqyannis.com
curl -I https://api-office.hqyannis.com
```

---

## Useful ad-hoc commands

```bash
# Reachability ping
ansible all -m ping

# Tail nginx error log on the dev VM
ansible dev -m shell -a 'tail -n 50 /var/log/nginx/error.log' --become

# Show certbot's next renewal time
ansible dev -m shell -a 'systemctl list-timers certbot.timer --no-pager' --become

# Force cert renewal (dry run first)
ansible dev -m shell -a 'certbot renew --dry-run' --become
```

---

## Why marker-guarded, not fully declarative?

Certbot's `--nginx` plugin rewrites the server blocks in place to add the `listen 443 ssl` directives and the redirect. If we re-rendered the templates on every run, we'd wipe those edits and the playbook would race against certbot forever.

The clean-but-heavier alternative is webroot-based ACME + a full SSL-aware Jinja template, where Ansible owns the whole config and certbot only writes cert files. We picked the marker approach because:

1. The dev/prod config rarely changes (hostnames + upstream ports are stable).
2. Re-rendering is a deliberate, well-documented operation (the marker-reset above).
3. Less Jinja, easier to reason about on a 3am incident call.

If reverse proxy config starts changing weekly, revisit and switch to webroot.
