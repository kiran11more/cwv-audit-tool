# Core Web Vitals (CWV) Audit Tool

A fast, standalone **Core Web Vitals & PageSpeed Insights Audit Tool** built with **Astro**, **Tailwind CSS**, and **Cloudflare Pages Functions**.

Powered by Google's official [PageSpeed Insights v5 API](https://developers.google.com/speed/docs/insights/v5/get-started), it combines **28-day real-user Chrome UX Report (CrUX) field data** with **Lighthouse lab diagnostics** in a clean, tactile developer interface.

---

## Features

- **Mobile & Desktop Audits:** Switch between mobile and desktop strategies.
- **4 Lighthouse Category Scores:** Performance, Accessibility, Best Practices, and SEO.
- **Real-User CrUX Field Data + Lab Fallback:** Displays `LCP`, `INP`, `CLS`, `FCP`, and `TTFB` field distributions alongside Lighthouse lab metrics (`LCP`, `TBT`, `CLS`, `FCP`, `Speed Index`).
- **Prioritized Bottlenecks & Savings:** Surfaces top optimization opportunities sorted by estimated millisecond/byte savings.
- **One-Click Report Export:** Copy a formatted Markdown audit summary or download the full JSON payload.
- **SSRF-Protected Serverless Proxy:** Blocks `localhost`, private IPs, and non-HTTP(S) schemes before calling Google PSI.
- **Light & Dark Mode:** Tactile neo-brutalist UI with persistent theme toggle.

---

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:4321` in your browser.

> **Note:** Google's PageSpeed Insights API works without an API key for low-volume local testing. For production or higher limits (25,000 queries/day free), create a Google Cloud API key with the **PageSpeed Insights API** enabled and set `PAGESPEED_API_KEY` in `.env` (or in Cloudflare Pages environment variables).

---

## Deploy to Cloudflare Pages

1. Push this repository to GitHub.
2. Connect the repository in **Cloudflare Pages**:
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Add `PAGESPEED_API_KEY` under **Settings → Environment variables** (Production & Preview).
4. Cloudflare automatically deploys `functions/api/audit.ts` at `/api/audit`.

---

Built by [Kiran M.](https://kiranm.in)
