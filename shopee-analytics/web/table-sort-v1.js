(() => {
  const $all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function valueOf(cell) {
    const raw = String(cell?.dataset.sortValue ?? cell?.textContent ?? '').trim();
    if (!raw || raw === '—' || raw === '-') return { empty: true, value: '' };
    const date = /^\d{4}[-/]\d{2}[-/]\d{2}/.test(raw) ? Date.parse(raw.replaceAll('/', '-')) : NaN;
    if (Number.isFinite(date)) return { empty: false, value: date, numeric: true };
    const compact = raw.replace(/,/g, '').replace(/%$/, '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(compact)) return { empty: false, value: Number(compact), numeric: true };
    return { empty: false, value: raw, numeric: false };
  }

  function rowBlocks(tbody) {
    const rows = Array.from(tbody.children).filter(node => node.tagName === 'TR');
    const blocks = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (row.dataset.sortDetail === '1') continue;
      const block = [row];
      const key = row.dataset.sortGroup;
      while (key && rows[i + 1]?.dataset.sortDetail === '1' && rows[i + 1]?.dataset.sortGroup === key) block.push(rows[++i]);
      blocks.push(block);
    }
    return blocks;
  }

  function sortTable(button) {
    const th = button.closest('th');
    const table = th?.closest('table');
    const tbody = table?.tBodies?.[0];
    if (!th || !tbody) return;
    const index = Array.from(th.parentElement.children).indexOf(th);
    const dir = button.dataset.sortDir === 'desc' ? -1 : 1;
    const blocks = rowBlocks(tbody).map((rows, order) => ({ rows, order, parsed: valueOf(rows[0].children[index]) }));
    blocks.sort((a, b) => {
      if (a.parsed.empty !== b.parsed.empty) return a.parsed.empty ? 1 : -1;
      if (a.parsed.empty) return a.order - b.order;
      const compared = a.parsed.numeric && b.parsed.numeric
        ? a.parsed.value - b.parsed.value
        : collator.compare(String(a.parsed.value), String(b.parsed.value));
      return compared === 0 ? a.order - b.order : compared * dir;
    });
    tbody.replaceChildren(...blocks.flatMap(block => block.rows));
    $all('thead th', table).forEach(header => header.removeAttribute('data-sort-active'));
    th.setAttribute('data-sort-active', button.dataset.sortDir);
  }

  function enhance(root = document) {
    $all('table thead th:not([data-no-sort])', root).forEach(th => {
      if (th.querySelector('.shopee-sort-controls')) return;
      th.classList.add('shopee-sortable');
      const controls = document.createElement('span');
      controls.className = 'shopee-sort-controls';
      controls.innerHTML = '<button type="button" class="shopee-sort-arrow" data-sort-dir="asc" aria-label="升序">▲</button><button type="button" class="shopee-sort-arrow" data-sort-dir="desc" aria-label="降序">▼</button>';
      th.appendChild(controls);
    });
  }

  const style = document.createElement('style');
  style.textContent = '.shopee-sortable{white-space:nowrap}.shopee-sort-controls{display:inline-flex;flex-direction:column;margin-left:5px;vertical-align:-3px;gap:0}.shopee-sort-arrow{border:0;background:transparent;color:#b0b0b5;font-size:7px;line-height:7px;padding:0 2px;cursor:pointer}.shopee-sort-arrow:hover,.shopee-sortable[data-sort-active="asc"] .shopee-sort-arrow[data-sort-dir="asc"],.shopee-sortable[data-sort-active="desc"] .shopee-sort-arrow[data-sort-dir="desc"]{color:#1d1d1f}';
  document.head.appendChild(style);

  document.addEventListener('click', event => {
    const button = event.target.closest('.shopee-sort-arrow');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    sortTable(button);
  });
  const observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => {
    if (node.nodeType !== 1) return;
    if (node.matches?.('table') || node.querySelector?.('table')) enhance(node.matches?.('table') ? node.parentElement : node);
  })));
  const start = () => { enhance(); observer.observe(document.body, { childList: true, subtree: true }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
