'use strict';

(() => {
  function applyCopy() {
    const autoDetail = document.querySelector('#autoAdDetail');
    const autoItems = document.querySelector('#autoAdItems');
    if (autoDetail && /全店广告/.test(autoDetail.textContent || '')) {
      autoDetail.textContent = '全店推诊断会在进入页面后自动加载。';
    }
    if (autoItems && /全店广告/.test(autoItems.textContent || '')) {
      autoItems.textContent = '当前自动选品与商品表现会随全店推诊断自动加载。';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyCopy);
  else applyCopy();
})();
