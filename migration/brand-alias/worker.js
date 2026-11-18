/*
 * ZENO branded workers.dev alias.
 *
 * Deploy ONLY to a NEW Cloudflare account so the original
 * zeno.rlaehdus2477.workers.dev remains active for installed Galaxy apps.
 * This Worker delegates all traffic (including /api/) to the original.
 * Do not change the existing Cloudflare account's workers.dev subdomain.
 */
const LEGACY_ORIGIN = 'https://zeno.rlaehdus2477.workers.dev';
const LEGACY_HOST = new URL(LEGACY_ORIGIN).hostname;

export default {
  async fetch(request) {
    const visibleUrl = new URL(request.url);
    const upstreamUrl = new URL(visibleUrl.pathname + visibleUrl.search, LEGACY_ORIGIN);

    // Keep method, headers, streaming upload body, and query string intact.
    // Host is assigned from upstreamUrl; browser-facing cookies remain host-only.
    const upstreamRequest = new Request(upstreamUrl.toString(), request);
    upstreamRequest.headers.delete('host');

    // Do not follow upstream redirects back to the legacy hostname.
    const upstreamResponse = await fetch(upstreamRequest, { redirect: 'manual' });
    const headers = new Headers(upstreamResponse.headers);

    const location = headers.get('location');
    if (location) {
      const redirected = new URL(location, upstreamUrl);
      if (redirected.protocol === 'https:' && redirected.hostname === LEGACY_HOST) {
        redirected.protocol = visibleUrl.protocol;
        redirected.host = visibleUrl.host;
        headers.set('location', redirected.toString());
      }
    }

    // No caching or storage: the existing Worker and D1 remain authoritative.
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  },
};
