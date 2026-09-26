'use strict';

const { randomUUID } = require('crypto');

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'BLOCKED']);

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    batchId: row.batch_id,
    operation: row.operation,
    status: row.status,
    fingerprint: row.fingerprint,
    filename: row.filename,
    filePath: row.file_path,
    fileSize: Number(row.file_size || 0),
    sha256: row.sha256,
    targetShopId: row.target_shop_id == null ? null : Number(row.target_shop_id),
    sourceShopId: row.source_shop_id == null ? null : Number(row.source_shop_id),
    periodStart: row.period_start ? String(row.period_start).slice(0, 10) : null,
    periodEnd: row.period_end ? String(row.period_end).slice(0, 10) : null,
    granularity: row.granularity,
    request: row.request_json || {},
    result: row.result_json || null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    attemptCount: Number(row.attempt_count || 0),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    updatedAt: row.updated_at,
  };
}

class ShopeeAdGroupImportJobRepository {
  constructor({ pool }) {
    if (!pool || typeof pool.query !== 'function') throw new Error('pg pool/query adapter is required');
    this.pool = pool;
  }

  async enqueue({ operation, batchId = null, filename, filePath, fileSize, sha256, targetShopId = null, request = {} }) {
    if (!['PREVIEW', 'IMPORT'].includes(operation)) throw new Error('operation must be PREVIEW or IMPORT');
    const fingerprint = `${sha256}:${operation}:${targetShopId || 0}`;
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    const release = client !== this.pool && typeof client.release === 'function';
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [fingerprint]);
      const existing = await client.query(
        `SELECT * FROM shopee_ad_group_import_jobs
         WHERE fingerprint=$1 AND status IN ('QUEUED','RUNNING')
         ORDER BY created_at DESC LIMIT 1`,
        [fingerprint],
      );
      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { job: mapRow(existing.rows[0]), reused: true };
      }
      const id = randomUUID();
      const result = await client.query(
        `INSERT INTO shopee_ad_group_import_jobs
         (id,batch_id,operation,status,fingerprint,filename,file_path,file_size,sha256,target_shop_id,request_json,created_at,updated_at)
         VALUES ($1,$2,$3,'QUEUED',$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())
         RETURNING *`,
        [id,batchId,operation,fingerprint,filename,filePath,fileSize,sha256,targetShopId,JSON.stringify(request || {})],
      );
      await client.query('COMMIT');
      return { job: mapRow(result.rows[0]), reused: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (release) client.release();
    }
  }

  async get(id) {
    const result = await this.pool.query('SELECT * FROM shopee_ad_group_import_jobs WHERE id=$1', [id]);
    return mapRow(result.rows[0]);
  }

  async listByBatch(batchId) {
    const result = await this.pool.query(
      'SELECT * FROM shopee_ad_group_import_jobs WHERE batch_id=$1 ORDER BY created_at,id',
      [batchId],
    );
    return result.rows.map(mapRow);
  }

  async findReusablePreview({ sha256, targetShopId, maxAgeHours = 24 }) {
    const result = await this.pool.query(
      `SELECT * FROM shopee_ad_group_import_jobs
       WHERE operation='PREVIEW'
         AND status='SUCCEEDED'
         AND sha256=$1
         AND target_shop_id=$2
         AND finished_at >= now()-($3::text || ' hours')::interval
       ORDER BY finished_at DESC,id DESC
       LIMIT 1`,
      [sha256, targetShopId, String(maxAgeHours)],
    );
    return mapRow(result.rows[0]);
  }

  async claimNext({ workerId, leaseSeconds = 1800 }) {
    const client = typeof this.pool.connect === 'function' ? await this.pool.connect() : this.pool;
    const release = client !== this.pool && typeof client.release === 'function';
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE shopee_ad_group_import_jobs
         SET status='QUEUED',lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
         WHERE status='RUNNING' AND lease_expires_at < now()`,
      );
      const candidate = await client.query(
        `SELECT id FROM shopee_ad_group_import_jobs
         WHERE status='QUEUED'
         ORDER BY created_at,id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!candidate.rows[0]) {
        await client.query('COMMIT');
        return null;
      }
      let result;
      try {
        result = await client.query(
          `UPDATE shopee_ad_group_import_jobs
           SET status='RUNNING',attempt_count=attempt_count+1,lease_owner=$2,
               lease_expires_at=now()+($3::text || ' seconds')::interval,
               started_at=COALESCE(started_at,now()),updated_at=now(),error_code=NULL,error_message=NULL
           WHERE id=$1 RETURNING *`,
          [candidate.rows[0].id, workerId, String(leaseSeconds)],
        );
      } catch (error) {
        if (error && error.code === '23505') {
          await client.query('ROLLBACK');
          return null;
        }
        throw error;
      }
      await client.query('COMMIT');
      return mapRow(result.rows[0]);
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch {}
      throw error;
    } finally {
      if (release) client.release();
    }
  }

  async heartbeat({ id, workerId, leaseSeconds = 1800 }) {
    const result = await this.pool.query(
      `UPDATE shopee_ad_group_import_jobs
       SET lease_expires_at=now()+($3::text || ' seconds')::interval,updated_at=now()
       WHERE id=$1 AND status='RUNNING' AND lease_owner=$2 RETURNING id`,
      [id, workerId, String(leaseSeconds)],
    );
    return Boolean(result.rows[0]);
  }

  async succeed(id, { result, sourceShopId = null, periodStart = null, periodEnd = null, granularity = null } = {}) {
    const updated = await this.pool.query(
      `UPDATE shopee_ad_group_import_jobs
       SET status='SUCCEEDED',result_json=$2::jsonb,source_shop_id=$3,period_start=$4,period_end=$5,granularity=$6,
           error_code=NULL,error_message=NULL,lease_owner=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, JSON.stringify(result || {}), sourceShopId, periodStart, periodEnd, granularity],
    );
    return mapRow(updated.rows[0]);
  }

  async fail(id, { code = 'IMPORT_JOB_FAILED', message, httpStatus = 500, blocked = false } = {}) {
    const updated = await this.pool.query(
      `UPDATE shopee_ad_group_import_jobs
       SET status=$2,result_json=$3::jsonb,error_code=$4,error_message=$5,
           lease_owner=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, blocked ? 'BLOCKED' : 'FAILED', JSON.stringify({ httpStatus }), code, String(message || code).slice(0, 2000)],
    );
    return mapRow(updated.rows[0]);
  }

  async activeFilePaths() {
    const result = await this.pool.query(
      `SELECT DISTINCT file_path FROM shopee_ad_group_import_jobs
       WHERE status IN ('QUEUED','RUNNING')`,
    );
    return new Set(result.rows.map(row => row.file_path).filter(Boolean));
  }
}

module.exports = { TERMINAL, mapRow, ShopeeAdGroupImportJobRepository };
