<script setup lang="ts">
import { withBase } from 'vitepress'

/* Keep in sync with manifest.json on every release.
   Pinned by src/__tests__/versionConsistency.test.ts. */
const PLUGIN_VERSION = '3.8.1'
</script>

<template>
  <section class="lp-hero">
    <a
      href="https://obsidian.md/plugins?id=vault-operator"
      class="lp-badge"
      target="_blank"
      rel="noopener"
    >
      <span class="lp-badge-version">v{{ PLUGIN_VERSION }}</span>
      <span class="lp-badge-divider" aria-hidden="true">·</span>
      <span>Prompt caching, measured</span>
      <svg class="lp-badge-arrow" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M7 17 17 7" /><path d="M8 7h9v9" />
      </svg>
    </a>

    <h1 class="lp-title">Your Obsidian vault,<br>with a real AI agent.</h1>

    <p class="lp-sub">
      Block-level provenance from sense-making notes back to source paragraphs.
      Hybrid semantic search, persistent memory, MCP server, multi-agent workflows.
      Plus an inline AI chat panel that runs the full agent loop over your current selection.
      Local-first. Open source. Free to use.
    </p>

    <div class="lp-cta">
      <a :href="withBase('/tutorials/getting-started')" class="lp-btn lp-btn-primary">
        Get started
      </a>
      <a :href="withBase('/guides/capabilities')" class="lp-btn lp-btn-secondary">
        What Vault Operator can do
      </a>
    </div>
  </section>

</template>

<style scoped>
@keyframes lp-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .lp-hero { animation: none; }
}

.lp-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 4rem 1.5rem 0.5rem;
  /* Dual wash echoing the brand ramp: pink from the left, violet from the right. */
  background:
    radial-gradient(ellipse 55% 45% at 30% -12%, rgba(230, 84, 127, 0.14), transparent 60%),
    radial-gradient(ellipse 55% 45% at 70% -12%, rgba(123, 92, 240, 0.20), transparent 60%);
  animation: lp-fade-up 0.4s ease-out both;
}

.lp-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  padding: 0.3rem 0.95rem;
  font-size: 0.78rem;
  color: var(--vp-c-text-2);
  margin-bottom: 1.5rem;
  text-decoration: none;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}
.lp-badge:hover {
  background: var(--vp-c-bg-elv);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
  text-decoration: none;
}
.lp-badge-version {
  color: var(--vp-c-brand-1);
  font-weight: 700;
}
.lp-badge-divider {
  opacity: 0.45;
}
.lp-badge-arrow {
  opacity: 0.7;
  transition: transform 0.15s;
}
.lp-badge:hover .lp-badge-arrow {
  transform: translate(1px, -1px);
}

.lp-title {
  font-size: clamp(2.6rem, 6vw, 4.2rem);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.08;
  margin: 0 0 1.1rem;
  background: linear-gradient(135deg, var(--vp-c-text-1) 30%, #a24bd8 75%, #7b5cf0 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  max-width: 960px;
  text-wrap: balance;
  border: none;
  padding: 0;
}

.lp-sub {
  font-size: clamp(1.05rem, 1.8vw, 1.25rem);
  color: var(--vp-c-text-2);
  margin: 0 0 2rem;
  font-weight: 500;
  max-width: 640px;
  line-height: 1.5;
  text-wrap: balance;
}

.lp-cta {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-bottom: 0;
}

.lp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.75rem 1.7rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s, transform 0.1s, color 0.15s;
  border: 1px solid transparent;
}
.lp-btn:hover { transform: translateY(-1px); text-decoration: none; }

.lp-btn-primary {
  background: linear-gradient(145deg, #e6547f 0%, #a24bd8 55%, #7b5cf0 100%);
  color: #fff;
  border-color: transparent;
}
.lp-btn-primary:hover {
  filter: brightness(0.93);
  color: #fff;
}

.lp-btn-secondary {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-divider);
  background: transparent;
}
.lp-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

@media (max-width: 600px) {
  .lp-hero { padding: 2.75rem 1rem 0.25rem; }
  .lp-title br { display: none; }
}
</style>
