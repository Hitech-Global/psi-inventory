'use strict';

const { randomUUID } = require('crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const LANGUAGES = new Set(['zh-CN', 'en-US']);

function normalizeReportLanguage(value, fallback = 'zh-CN') {
  const raw = String(value || fallback).trim();
  if (raw === 'zh' || raw === 'zh-CN') return 'zh-CN';
  if (raw === 'en' || raw === 'en-US') return 'en-US';
  throw new Error('language must be zh-CN or en-US');
}

function clampProgress(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

class SkillJobManager {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.jobs = new Map();
  }

  prune() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, job] of this.jobs.entries()) {
      if (job.updatedAt < cutoff) this.jobs.delete(id);
    }
  }

  publicJob(job) {
    if (!job) return null;
    return {
      id: job.id,
      shopId: job.shopId,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      message: job.message,
      language: job.language,
      errorMessage: job.errorMessage || null,
      result: job.status === 'SUCCEEDED' ? job.result : null,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
    };
  }

  update(id, patch = {}) {
    const job = this.jobs.get(id);
    if (!job) return null;
    const next = { ...patch };
    if (next.progress !== undefined) {
      next.progress = Math.max(job.progress, clampProgress(next.progress));
      if (job.status !== 'SUCCEEDED') next.progress = Math.min(next.progress, 99);
    }
    Object.assign(job, next, { updatedAt: this.now() });
    return this.publicJob(job);
  }

  create({ shopId, language, task }) {
    if (typeof task !== 'function') throw new Error('Skill job task is required');
    this.prune();
    const now = this.now();
    const job = {
      id: randomUUID(), shopId: Number(shopId), language: normalizeReportLanguage(language),
      status: 'QUEUED', progress: 3, stage: 'QUEUED', message: 'Queued',
      errorMessage: null, result: null, createdAt: now, updatedAt: now,
    };
    this.jobs.set(job.id, job);
    Promise.resolve().then(async () => {
      this.update(job.id, { status: 'RUNNING', progress: 5, stage: 'PREPARING', message: 'Preparing analysis' });
      try {
        const result = await task((progress, stage, message) => this.update(job.id, { progress, stage, message }));
        const current = this.jobs.get(job.id);
        if (!current) return;
        Object.assign(current, {
          status: 'SUCCEEDED', progress: 100, stage: 'COMPLETED', message: 'Completed',
          result, errorMessage: null, updatedAt: this.now(),
        });
      } catch (error) {
        const current = this.jobs.get(job.id);
        if (!current) return;
        Object.assign(current, {
          status: 'FAILED', progress: Math.max(current.progress, 5), stage: 'FAILED',
          message: 'Generation failed', errorMessage: String(error && error.message || error), updatedAt: this.now(),
        });
      }
    });
    return this.publicJob(job);
  }

  get(id, { shopId = null } = {}) {
    this.prune();
    const job = this.jobs.get(String(id));
    if (!job) return null;
    if (shopId !== null && Number(shopId) !== job.shopId) return null;
    return this.publicJob(job);
  }
}

module.exports = { DEFAULT_TTL_MS, LANGUAGES, normalizeReportLanguage, SkillJobManager };