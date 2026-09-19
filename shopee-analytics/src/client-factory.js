'use strict';

const { ShopeeClient } = require('./shopee-client');
const { loadAppCredential } = require('./config');

function createRoleClient(role, options = {}) {
  const credential = options.credential || loadAppCredential(role, { requireToken: !options.tokenManager });
  const client = new ShopeeClient({
    partnerId: credential.partnerId,
    partnerKey: credential.partnerKey,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });
  return {
    role,
    client,
    accessToken: credential.accessToken || '',
    tokenManager: options.tokenManager || null,
    async getAccessToken(shopId) {
      if (this.tokenManager) return this.tokenManager.getAccessToken({ appRole: role, shopId });
      if (!this.accessToken) throw new Error(`No access token configured for ${role}`);
      return this.accessToken;
    },
  };
}

function createRoleClients(roles, optionsByRole = {}) {
  const out = {};
  for (const role of roles) out[role] = createRoleClient(role, optionsByRole[role] || {});
  return out;
}

module.exports = { createRoleClient, createRoleClients };
