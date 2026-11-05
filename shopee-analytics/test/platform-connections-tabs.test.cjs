'use strict';

/**
 * The two platforms are on two pages of one window.
 *
 * They each have their own applications and their own credentials. Side
 * by side, each is squeezed into half the width while the reader is
 * working on one of them at a time — so they are put behind tabs.
 *
 * The window has to keep working: the reader comes back to the page they
 * were last on, and the refresh button reads that page rather than the
 * one they are not looking at.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const source = read('web/platform-connections-ui-v1.js');
const styles = read('web/styles.css');

const test = () => {
  // ── 两个页签 ──────────────────────────────────────────────────
  assert(source.includes('data-platform-tab="shopee"'), 'the Shopee tab is missing');
  assert(source.includes('data-platform-tab="tiktok"'), 'the TikTok tab is missing');
  assert(source.includes('role="tablist"'), 'the tabs are not marked as a list of tabs');

  // ── 两个面板，各放一个平台 ────────────────────────────────────
  assert(source.includes('data-platform-panel="shopee"'), 'the Shopee panel is missing');
  assert(source.includes('data-platform-panel="tiktok"'), 'the TikTok panel is missing');
  // The Shopee panel holds the Shopee card and the other applications,
  // which are all Shopee applications.
  const shopeePanel = source.slice(
    source.indexOf('data-platform-panel="shopee"'),
    source.indexOf('data-platform-panel="tiktok"'),
  );
  assert(shopeePanel.includes('data-platform="shopee"'), 'the Shopee panel holds no Shopee card');
  assert(shopeePanel.includes('platformShopeeApps'), 'the other applications are not in the Shopee panel');
  const tiktokPanel = source.slice(source.indexOf('data-platform-panel="tiktok"'));
  assert(tiktokPanel.includes('data-platform="tiktok"'), 'the TikTok panel holds no TikTok card');

  // ── 切换 ──────────────────────────────────────────────────────
  assert(source.includes('function showTab('), 'there is no way to change page');
  assert(source.includes('function currentTab('), 'the page being read is not known');
  assert(source.includes('function loadCurrentTab('), 'the page being read is not read on its own');
  assert(source.includes("closest('[data-platform-tab]')"), 'clicking a tab does nothing');

  // ── 回到上次看的那一页 ────────────────────────────────────────
  assert(source.includes('platformConnectionsTab'), 'the page last read is not remembered');

  // ── 刷新只读眼前这一页 ────────────────────────────────────────
  const refreshHandler = source.slice(
    source.indexOf('platformConnectionsRefresh, #platformShopeeRefresh'),
    source.indexOf('platformConnectionsRefresh, #platformShopeeRefresh') + 300,
  );
  assert(refreshHandler.includes('loadCurrentTab'), 'the refresh reads both pages, not the one in front');

  // ── 样式 ──────────────────────────────────────────────────────
  assert(styles.includes('.platform-tabs{'), 'the tabs have no style');
  assert(styles.includes('.platform-tab.is-active{'), 'the tab being read is not shown');
  assert(styles.includes('.platform-panel.hidden{'), 'the panel not being read is not hidden');

  console.log('Platform connections tabs tests: ok');
};

test();
