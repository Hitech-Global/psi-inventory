'use strict';

(() => {
  function applyCopy() {
    const autoDetail = document.querySelector('#autoAdDetail');
    const autoItems = document.querySelector('#autoAdItems');
    if (autoDetail && /全店广告/.test(autoDetail.textContent || '')) {
      autoDetail.textContent = '点击一个全店推 Campaign 查看诊断。';
    }
    if (autoItems && /全店广告/.test(autoItems.textContent || '')) {
      autoItems.textContent = '点击一个全店推 Campaign 查看当前自动选品范围。';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyCopy);
  else applyCopy();
})();
