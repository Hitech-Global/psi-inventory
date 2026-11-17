'use strict';

// Restrict storage to business information; never persist buyer PII returned by Shopee.
// Item names, model names, amounts, counts and order identifiers are deliberately retained.
const SENSITIVE_KEYS = new Set([
  'user', 'buyer', 'buyer_info', 'buyer_detail', 'buyer_address',
  'recipient_address', 'receiver_address', 'shipping_address',
  'return_address', 'return_pickup_address', 'pickup_address',
  'customer_info', 'customer_address', 'contact_info',
  'buyer_username', 'buyer_name', 'buyer_email', 'buyer_phone', 'buyer_mobile',
  'buyer_user_id', 'buyer_id', 'buyer_id_number',
  'recipient_name', 'recipient_phone', 'recipient_email',
  'receiver_name', 'receiver_phone', 'receiver_email',
  'customer_name', 'customer_phone', 'customer_email',
  'username', 'email', 'phone', 'phone_number', 'mobile', 'mobile_phone',
  'full_name', 'first_name', 'last_name', 'full_address', 'street_address',
  'address', 'address_line', 'address_line1', 'address_line2', 'zipcode',
  'postal_code', 'identity_number', 'id_card', 'passport_number',
  'whatsapp', 'portrait', 'virtual_contact_number', 'contact'
]);

function normalizeKey(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function sanitizeBuyerPii(value) {
  if (Array.isArray(value)) return value.map(sanitizeBuyerPii);
  if (value === null || typeof value !== 'object') return value;
  const safe = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizeKey(key);
    if (SENSITIVE_KEYS.has(normalized) || /^buyer_(?:.*_)?(?:name|phone|email|address|user_id)$/.test(normalized)) continue;
    safe[key] = sanitizeBuyerPii(child);
  }
  return safe;
}


const ORDER_FIELDS = new Set([
  'order_sn','order_status','create_time','update_time','currency','total_amount',
  'payment_method','pay_time','ship_by_date','days_to_ship','item_list',
  'actual_shipping_fee','estimated_shipping_fee',
  'cancel_reason','cancel_by','fulfillment_flag','cod','order_chargeable_weight'
]);
const RETURN_FIELDS = new Set([
  'return_sn','order_sn','status','reason','reassessed_request_reason',
  'refund_amount','currency','create_time','update_time','item','logistics_status',
  'return_refund_type','return_refund_request_type','return_solution',
  'is_partial_quantity_return','is_refund_amount_adjusted',
  'amount_before_discount','reverse_logistics_status'
]);
const ITEM_FIELDS = new Set([
  'item_id','item_name','item_sku','model_id','model_name','model_sku',
  'model_quantity_purchased','quantity','amount','name','variation_sku',
  'model_original_price','model_discounted_price','item_price','refund_amount',
  'promotion_type','promotion_id','unit_price'
]);

function allowFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (key === 'item_list' || key === 'item') {
      if (Array.isArray(child)) output[key] = child.map(row => allowFields(row, ITEM_FIELDS));
    } else if (child === null || typeof child !== 'object') {
      output[key] = child;
    }
  }
  return output;
}

function sanitizeOrderRaw(value) { return allowFields(value, ORDER_FIELDS); }
function sanitizeReturnRaw(value) { return allowFields(value, RETURN_FIELDS); }
function sanitizeItemRaw(value) { return allowFields(value, ITEM_FIELDS); }

function sanitizeShopOrderReturnSnapshot(endpointKey, payload) {
  if (!['orders','orderDetail','returns','returnDetail'].includes(endpointKey)) {
    return sanitizeBuyerPii(payload);
  }
  const response = payload && typeof payload === 'object' && payload.response
    ? payload.response : payload;
  const isOrder = endpointKey === 'orders' || endpointKey === 'orderDetail';
  const result = {};
  for (const key of ['error', 'request_id']) {
    if (payload && typeof payload[key] === 'string') result[key] = payload[key];
  }
  const safeResponse = {};
  for (const key of ['more', 'total_count', 'total']) {
    if (response && typeof response[key] !== 'object' && response[key] !== undefined) {
      safeResponse[key] = response[key];
    }
  }
  if (isOrder) {
    if (Array.isArray(response?.order_list)) {
      safeResponse.order_list = response.order_list.map(sanitizeOrderRaw);
    }
  } else if (endpointKey === 'returns') {
    if (Array.isArray(response?.return)) {
      safeResponse.return = response.return.map(sanitizeReturnRaw);
    }
  } else {
    Object.assign(safeResponse, sanitizeReturnRaw(response));
  }
  result.response = safeResponse;
  return result;
}

module.exports = {
  sanitizeBuyerPii, normalizeKey,
  sanitizeOrderRaw, sanitizeReturnRaw, sanitizeItemRaw,
  sanitizeShopOrderReturnSnapshot
};

