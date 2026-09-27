'use strict';

(() => {
  function applyCopy() {
    const autoPanel = document.querySelector('#adsAutoPanel');
    const autoTitle = autoPanel && autoPanel.querySelector('.panel-head h2');
    const autoDescription = autoPanel && autoPanel.querySelector('.panel-head p');
    const autoDetail = document.querySelector('#autoAdDetail');
    const autoItems = document.querySelector('#autoAdItems');
    if (autoTitle) autoTitle.textContent = '全店推';
    if (autoDescription) autoDescription.textContent = 'Product Card · auto。先看整体订单量与 ROAS，再看真实自动选品范围。';
    if (autoDetail && /全店广告/.test(autoDetail.textContent || '')) autoDetail.textContent = '点击一个全店推 Campaign 查看诊断。';
    if (autoItems && /全店广告/.test(autoItems.textContent || '')) autoItems.textContent = '点击一个全店推 Campaign 查看当前自动选品范围。';

    const groupDescription = document.querySelector('#adsGroupImportPanel .panel-head p');
    if (groupDescription) groupDescription.textContent = 'Product Card · 广告组。先看广告组整体，再点击下钻组内商品。';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyCopy);
  else applyCopy();
})();
