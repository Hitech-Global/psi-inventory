'use strict';

const express = require('express');
const {
  STATE_COOKIE_NAME,
  parseCookies,
  serializeStateCookie,
  clearStateCookie,
  safeError,
  redactSensitive,
} = require('./oauth-security');

function createOAuthRouter({ oauthService, logger = console }) {
  if (!oauthService) throw new Error('oauthService is required');
  const router = express.Router();

  router.get('/oauth/shopee/start', async (req, res, next) => {
    try {
      const result = await oauthService.beginAuthorization();
      res.setHeader('Set-Cookie', serializeStateCookie(result.state, result.ttlSeconds));
      res.redirect(302, result.authorizationUrl);
    } catch (error) {
      next(error);
    }
  });

  router.get('/oauth/shopee/callback', async (req, res, next) => {
    try {
      const state = parseCookies(req.headers.cookie)[STATE_COOKIE_NAME];
      const result = await oauthService.completeAuthorization({
        state,
        code: typeof req.query.code === 'string' ? req.query.code : '',
        shopId: req.query.shop_id,
        providerError: req.query.error || null,
      });
      res.setHeader('Set-Cookie', clearStateCookie());
      res.status(200).json({ ok: true, appRole: result.appRole, shopId: result.shopId, expiresAt: result.expiresAt });
    } catch (error) {
      next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const safe = safeError(error, 'OAUTH_REQUEST_FAILED');
    logger.error('[Shopee OAuth]', redactSensitive(safe.message));
    res.status(safe.status || 500).json({ error: safe.code || 'OAUTH_REQUEST_FAILED' });
  });

  return router;
}

module.exports = { createOAuthRouter };
