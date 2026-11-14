# ZENO: safe free workers.dev brand-alias staging

**Status:** staging only. None of these files changes the production Worker. Do NOT merge or publish a new address before Cloudflare account setup and real traffic testing.

## Why a direct subdomain rename is unsafe

The existing production deployment is `https://zeno.rlaehdus2477.workers.dev`, and the Android APK `android/owner/src/kr/zeno/owner/OwnerActivity.java` hardcodes `HOST = "zeno.rlaehdus2477.workers.dev"`. Cloudflare's account-wide `workers.dev` subdomain rename changes the address for every Worker on that account. It cannot preserve old installed APK access by itself.

The same old hostname is hardcoded in the production GitHub Actions smoke test (`.github/workflows/deploy-cloudflare.yml`). The production Worker is bound to an existing Cloudflare D1 database; do not move or clone it without an independently verified migration.

**Never change the old account's subdomain or remove the old Worker while existing APKs remain in use.**

## No-downtime free approach (two separate Cloudflare accounts)

1. Retain the current Cloudflare account, its `zeno` Worker and its D1 database. Retain the existing GitHub production workflow.
2. In Cloudflare dashboard, create an **additional Free account** if eligible. Claim an available brand-based account subdomain (example: `zenocare`, not guaranteed available). Do **not** select **Change** for the existing account.
3. In the new account, deploy the files in this directory as a Worker named `zeno` (e.g. `npx wrangler deploy --config migration/brand-alias/wrangler.toml` with credentials scoped to the new account). This yields a new URL of the form `https://zeno.<brand>.workers.dev`.
4. The new Worker forwards the entire path and query to the old Worker, including `/owner`, `/hospital` and `/api/*`. It has no D1 binding of its own. The `global_fetch_strictly_public` compatibility flag is needed for public Worker-to-Worker HTTP fetching; test for Cloudflare error 1042.
5. Run read-only check: `node migration/brand-alias/smoke.mjs https://zeno.<brand>.workers.dev`. Then manually verify login, new booking -> clinic confirmation -> guardian status, status refresh, file upload, PWA installation, and Android behavior.
6. Only after tests succeed, share the new URL to **new** users. Existing installed Galaxy APKs continue using the original URL.

## Data, sessions and Android caveats

- A different origin means browser `localStorage`, service-worker installation and any host-only session storage **do not automatically migrate**. Before any install/uninstall, back up or export locally stored information and use application backup/recovery methods where supported.
- Existing APK v1.2 is **hardcoded** to the old host. This is deliberate: it remains operational if the original account stays live. Do not switch the old account's subdomain.
- Existing test APK build generates a *temporary signing key each run*. A newly compiled APK may not update an existing installation in place. Establish persistent signing and a safe upgrade path before shipping another APK.
- An alias Worker adds a network hop and its own Free-tier limits. The alias must be tested against Cloudflare Worker-to-Worker restrictions and the actual ZENO app before publishing. This repository file is **not proof** that the alias is live.
- Rolling back the alias simply means disabling the new Worker. The legacy URL remains unchanged.
- Longer term, for a production medical services platform, a real branded custom domain is preferable if the user chooses to purchase one.

## Current blockers

- Brand subdomain choice and availability not confirmed.
- Additional Cloudflare account and credentials not available in this chat.
- No live branded Worker deployed, so its end-to-end behavior cannot yet be verified.

Reference: https://developers.cloudflare.com/workers/configuration/routing/workers-dev/
