'use strict';

/**
 * The timezone a shop's days are counted in.
 *
 * Every daily figure in this system belongs to a day in the shop's own
 * time, not in the server's. A shop whose timezone is not on file cannot
 * be given a day at all, and that used to stop the whole batch rather
 * than just that shop — one shop without a timezone meant no shop's
 * figures were fetched.
 *
 * The country a shop trades in determines its timezone in every market
 * Shopee serves, so the country is enough to carry on. A shop that has a
 * timezone of its own keeps it.
 */

const COUNTRY_TIMEZONES = Object.freeze({
  BR: 'America/Sao_Paulo',
  ID: 'Asia/Jakarta',
  MX: 'America/Mexico_City',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  SG: 'Asia/Singapore',
  TH: 'Asia/Bangkok',
  TW: 'Asia/Taipei',
  VN: 'Asia/Ho_Chi_Minh',
});

/**
 * The timezone to count a shop's days in, or null when it cannot be known.
 */
function resolveShopTimezone(shop) {
  if (!shop) return null;
  const explicit = String(shop.timezone || '').trim();
  if (explicit) return explicit;
  const country = String(shop.countryCode || shop.country_code || '').trim().toUpperCase();
  return COUNTRY_TIMEZONES[country] || null;
}

module.exports = { COUNTRY_TIMEZONES, resolveShopTimezone };
