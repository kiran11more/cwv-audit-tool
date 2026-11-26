// functions/api/audit.ts
// Cloudflare Pages Function for POST /api/audit
// Queries Google PageSpeed Insights v5 API and returns a normalized Core Web Vitals + Lighthouse summary.

interface Env {
  PAGESPEED_API_KEY?: string;
}

interface PagesContext {
  request: Request;
  env?: Env;
}

interface AuditRequestBody {
  url?: string;
  strategy?: 'mobile' | 'desktop';
}

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const REQUEST_TIMEOUT_MS = 35_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

function isPrivateOrDisallowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }

  // Block private IPv4 ranges and loopback
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    ) {
      return true;
    }
  }

  return !host.includes('.');
}

function normalizeTargetUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (isPrivateOrDisallowedHost(parsed.hostname)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1').replace(/\s+/g, ' ').trim();
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  let body: AuditRequestBody;
  try {
    body = (await context.request.json()) as AuditRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON request body.' }, 400);
  }

  const targetUrl = normalizeTargetUrl(body.url ?? '');
  if (!targetUrl) {
    return jsonResponse(
      { error: 'Please enter a valid public http:// or https:// website URL.' },
      400,
    );
  }

  const strategy: 'mobile' | 'desktop' = body.strategy === 'desktop' ? 'desktop' : 'mobile';

  const psiUrl = new URL(PSI_ENDPOINT);
  psiUrl.searchParams.set('url', targetUrl.toString());
  psiUrl.searchParams.set('strategy', strategy);
  psiUrl.searchParams.append('category', 'performance');
  psiUrl.searchParams.append('category', 'accessibility');
  psiUrl.searchParams.append('category', 'best-practices');
  psiUrl.searchParams.append('category', 'seo');

  const apiKey = context.env?.PAGESPEED_API_KEY?.trim();
  if (apiKey) {
    psiUrl.searchParams.set('key', apiKey);
  }

  try {
    const response = await fetch(psiUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      let detail = `Google PageSpeed Insights returned HTTP ${response.status}.`;
      try {
        const errJson = (await response.json()) as { error?: { message?: string } };
        if (errJson?.error?.message) {
          detail = errJson.error.message;
        }
      } catch {
        // Ignore JSON parse failure
      }

      if (response.status === 429) {
        return jsonResponse(
          {
            error:
              'Google PageSpeed Insights rate limit reached. Add a free PAGESPEED_API_KEY in .env or try again shortly.',
          },
          429,
        );
      }

      return jsonResponse({ error: detail }, response.status >= 400 ? 502 : 500);
    }

    const psi = (await response.json()) as Record<string, any>;
    const lhr = psi.lighthouseResult ?? {};
    const categories = lhr.categories ?? {};
    const audits = lhr.audits ?? {};
    const loadingExp = psi.loadingExperience ?? {};
    const fieldMetrics = loadingExp.metrics ?? {};

    const toScore = (cat?: { score?: number | null }) =>
      typeof cat?.score === 'number' ? Math.round(cat.score * 100) : null;

    const extractLabMetric = (id: string) => {
      const a = audits[id];
      if (!a) return null;
      return {
        id,
        title: a.title ?? id,
        displayValue: a.displayValue ?? '—',
        numericValue: typeof a.numericValue === 'number' ? a.numericValue : null,
        score: typeof a.score === 'number' ? a.score : null,
      };
    };

    const extractFieldMetric = (key: string, unit: 'ms' | 'cls') => {
      const m = fieldMetrics[key];
      if (!m || typeof m.percentile !== 'number') return null;
      const percentile = m.percentile;
      const displayValue =
        unit === 'cls'
          ? (percentile / 100).toFixed(2)
          : percentile >= 1000
            ? `${(percentile / 1000).toFixed(2)} s`
            : `${percentile} ms`;

      return {
        percentile,
        displayValue,
        category: (m.category as string) ?? 'NONE',
        distributions: Array.isArray(m.distributions) ? m.distributions : [],
      };
    };

    // Collect top actionable opportunities & failed diagnostics
    const opportunities: Array<{
      id: string;
      title: string;
      description: string;
      displayValue: string;
      savingsMs: number;
      savingsBytes: number;
      score: number;
    }> = [];

    for (const [id, audit] of Object.entries<any>(audits)) {
      if (!audit || typeof audit.score !== 'number' || audit.score >= 0.9) continue;
      const details = audit.details;
      const isOpportunity =
        details?.type === 'opportunity' ||
        (typeof details?.overallSavingsMs === 'number' && details.overallSavingsMs > 0) ||
        (typeof details?.overallSavingsBytes === 'number' && details.overallSavingsBytes > 0) ||
        [
          'render-blocking-resources',
          'unused-javascript',
          'unused-css-rules',
          'uses-optimized-images',
          'modern-image-formats',
          'uses-responsive-images',
          'offscreen-images',
          'unminified-javascript',
          'unminified-css',
          'server-response-time',
          'dom-size',
          'total-byte-weight',
          'bootup-time',
          'mainthread-work-breakdown',
          'third-party-summary',
        ].includes(id);

      if (!isOpportunity) continue;

      opportunities.push({
        id,
        title: audit.title ?? id,
        description: stripMarkdownLinks(audit.description ?? ''),
        displayValue: audit.displayValue ?? '',
        savingsMs: Math.round(details?.overallSavingsMs ?? 0),
        savingsBytes: Math.round(details?.overallSavingsBytes ?? 0),
        score: audit.score,
      });
    }

    opportunities.sort((a, b) => {
      if (b.savingsMs !== a.savingsMs) return b.savingsMs - a.savingsMs;
      if (b.savingsBytes !== a.savingsBytes) return b.savingsBytes - a.savingsBytes;
      return a.score - b.score;
    });

    return jsonResponse({
      auditedUrl: psi.id ?? targetUrl.toString(),
      finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? targetUrl.toString(),
      strategy,
      fetchTime: lhr.fetchTime ?? new Date().toISOString(),
      scores: {
        performance: toScore(categories.performance),
        accessibility: toScore(categories.accessibility),
        bestPractices: toScore(categories['best-practices']),
        seo: toScore(categories.seo),
      },
      fieldData: {
        overallCategory: loadingExp.overall_category ?? null,
        hasData: Object.keys(fieldMetrics).length > 0,
        lcp: extractFieldMetric('LARGEST_CONTENTFUL_PAINT_MS', 'ms'),
        inp: extractFieldMetric('INTERACTION_TO_NEXT_PAINT', 'ms'),
        cls: extractFieldMetric('CUMULATIVE_LAYOUT_SHIFT_SCORE', 'cls'),
        fcp: extractFieldMetric('FIRST_CONTENTFUL_PAINT_MS', 'ms'),
        ttfb: extractFieldMetric('EXPERIMENTAL_TIME_TO_FIRST_BYTE', 'ms'),
      },
      labData: {
        lcp: extractLabMetric('largest-contentful-paint'),
        tbt: extractLabMetric('total-blocking-time'),
        cls: extractLabMetric('cumulative-layout-shift'),
        fcp: extractLabMetric('first-contentful-paint'),
        si: extractLabMetric('speed-index'),
        ttfb: extractLabMetric('server-response-time'),
      },
      opportunities: opportunities.slice(0, 8),
    });
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    return jsonResponse(
      {
        error: isTimeout
          ? 'The target website took too long to respond to Lighthouse (>35s). Please try again.'
          : 'Failed to reach Google PageSpeed Insights API. Please try again.',
      },
      504,
    );
  }
}
