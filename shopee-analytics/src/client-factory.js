'use strict';

const { ShopeeClient } = require('./shopee-client');
const { loadAppCredential } = require('./config');

function createRoleClient(role, options = {}) {
  const credential = options.credential || loadAppCredential(role);
  const client = new ShopeeClient({
    partnerId: credential.partnerId,
    partnerKey: credential.partnerKey,
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });
  return {
    role,
    client,
    accessToken: credential.accessToken,
  };
}

function createRoleClients(roles, optionsByRole = {}) {
  const out = {};
  for (const role of roles) out[role] = createRoleClient(role, optionsByRole[role] || {});
  return out;
}

module.exports = { createRoleClient, createRoleClients };
