'use strict';

const crypto = require('crypto');

function fingerprintRequest(request) {
  return crypto.createHash('sha256').update(JSON.stringify(request || {})).digest('hex');
}

async function recordSnapshot({
  repository,
  appRole,
  endpointKey,
  shopId,
  requestJson,
  responseJson,
  eventDateFrom = null,
  eventDateTo = null,
}) {
  if (!repository || typeof repository.insertRawSnapshot !== 'function') return;
  await repository.insertRawSnapshot({
    appRole,
    endpointKey,
    shopId,
    eventDateFrom,
    eventDateTo,
    requestFingerprint: fingerprintRequest(requestJson),
    requestJson,
    responseJson,
  });
}

async function recordPages({ repository, appRole, endpointKey, shopId, pages }) {
  for (const page of pages || []) {
    const requestJson = page.query || page.requestBody || {};
    await recordSnapshot({
      repository,
      appRole,
      endpointKey,
      shopId,
      requestJson,
      responseJson: page.payload || {},
    });
  }
}

module.exports = { fingerprintRequest, recordSnapshot, recordPages };
