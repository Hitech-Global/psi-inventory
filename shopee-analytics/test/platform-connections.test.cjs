'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const webDir = path.join(root, 'web');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('the platform connections open over the page, not away from it', () => {
  const index = read('web/index.html');
  // Leaving the system to look at which platforms are connected, and
  // coming back afterwards, is a long way round for a glance.
  assert.ok(!index.includes('href="/connections" data-side-platform'),
    'the sidebar must not leave for another page');
  assert.ok(index.includes('type="button" data-side-platform="shopee"'),
    'the Shopee entry must open a window');
  assert.ok(index.includes('type="button" data-side-platform="tiktok"'),
    'the TikTok entry must open a window');
  assert.ok(index.includes('/platform-connections-ui-v1.js'), 'the panel must be loaded');
});

test('the window says what the platforms are connected to', () => {
  const panel = read('web/platform-connections-ui-v1.js');
  assert.ok(panel.includes("const API = '/api/shopee-analytics'"), 'the panel must know where to look');
  assert.ok(panel.includes('`${API}/shops`'), 'the shopee side must be read');
  assert.ok(panel.includes('`${API}/tiktok/status`'), 'the tiktok side must be read');
  assert.ok(panel.includes('`${API}/tiktok/oauth/start`'), 'the tiktok side must be connectable');
  // The page of its own stays for the one moment that needs one.
  assert.ok(fs.existsSync(path.join(webDir, 'connections.html')),
    'the page must stay for the return from the platform');
});

test('the styles the window needs are the ones the page has', () => {
  const styles = read('web/styles.css');
  for (const name of ['platform-card', 'platform-state', 'connect-grid', 'shop-list']) {
    assert.ok(styles.includes(`.${name}`), `${name} must be styled where the window can use it`);
  }
});
