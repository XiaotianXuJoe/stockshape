// Proxy-aware fetch wrapper for Node.js 20+
// Uses undici's built-in ProxyAgent (no extra deps needed in Node 20+)

let proxyAgent: any = null;

function getProxyAgent() {
  if (proxyAgent) return proxyAgent;
  const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || "";
  if (!proxyUrl) return null;
  try {
    // Dynamic import undici's ProxyAgent to avoid bundling issues
    const undici = require("undici");
    if (undici.ProxyAgent) {
      proxyAgent = new undici.ProxyAgent(proxyUrl);
      console.log(`[Proxy] Using proxy: ${proxyUrl}`);
      return proxyAgent;
    }
  } catch {
    // undici.ProxyAgent not available, fallback to direct
  }
  return null;
}

/**
 * Fetch with optional HTTP proxy support.
 * If HTTP_PROXY/HTTPS_PROXY env var is set, routes requests through the proxy.
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const agent = getProxyAgent();
  if (agent) {
    return fetch(url, { ...init, dispatcher: agent } as any);
  }
  return fetch(url, init);
}
