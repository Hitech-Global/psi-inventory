'use strict';

(() => {
  const COUNTRY_CURRENCY = Object.freeze({
    ID: 'IDR', MY: 'MYR', TH: 'THB', SG: 'SGD', PH: 'PHP', VN: 'VND', TW: 'TWD',
  });
  const CURRENCY_META = Object.freeze({
    IDR: { symbol: 'Rp', digits: 0 },
    MYR: { symbol: 'RM', digits: 2 },
    THB: { symbol: '฿', digits: 2 },
    SGD: { symbol: 'S$', digits: 2 },
    PHP: { symbol: '₱', digits: 2 },
    VND: { symbol: '₫', digits: 0 },
    TWD: { symbol: 'NT$', digits: 0 },
  });

  function resolveCurrency(context = {}) {
    const explicit = String(context.currency || context.currencyCode || '').trim().toUpperCase();
    if (explicit) return explicit;
    const country = String(context.countryCode || context.country || context.marketplaceRegion || context.region || '').trim().toUpperCase();
    return COUNTRY_CURRENCY[country] || '';
  }

  function format(value, context = {}) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return '—';    const currency = resolveCurrency(context);
    if (!currency) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
    const meta = CURRENCY_META[currency] || { symbol: currency, digits: 2 };
    const abs = Math.abs(n);
    const number = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: meta.digits,
      maximumFractionDigits: meta.digits,
    }).format(abs);
    return `${n < 0 ? '-' : ''}${meta.symbol} ${number}`;
  }

  function hydrate(value, inherited = {}) {
    if (Array.isArray(value)) {
      value.forEach(item => hydrate(item, inherited));
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    const countryCode = value.countryCode || value.country_code || inherited.countryCode || '';
    const currency = resolveCurrency({
      currency: value.currency || value.currencyCode || value.currency_code || inherited.currency,
      countryCode,
    });
    if (!value.currency && currency && (countryCode || Object.prototype.hasOwnProperty.call(value, 'currency'))) value.currency = currency;
    Object.values(value).forEach(child => {
      if (child && typeof child === 'object') hydrate(child, { countryCode, currency });
    });
    return value;
  }

  window.ShopeeCurrency = Object.freeze({ resolveCurrency, format, hydrate });
})();
