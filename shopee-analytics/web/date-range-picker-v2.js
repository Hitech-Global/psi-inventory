'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const field = $('#dateRangeField');
  const start = $('#startDate');
  const end = $('#endDate');
  if (!field || !start || !end || field.dataset.calendarV2 === '1') return;
  field.dataset.calendarV2 = '1';

  const toIso = date => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const parseIso = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const monthStart = (date, delta = 0) => new Date(date.getFullYear(), date.getMonth() + delta, 1, 12);
  const monthTitle = date => `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;

  function presetRange(name) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const s = new Date(today);
    const e = new Date(today);
    if (name === 'today') return [toIso(s), toIso(e)];
    if (name === 'yesterday') { s.setDate(s.getDate() - 1); e.setDate(e.getDate() - 1); }
    else if (name === 'month') s.setDate(1);
    else if (name === 'last-month') { s.setMonth(s.getMonth() - 1, 1); e.setDate(0); }
    else if (name === '7d') s.setDate(s.getDate() - 6);
    else if (name === '30d') s.setDate(s.getDate() - 29);
    else if (name === '6m') s.setMonth(s.getMonth() - 6);
    return [toIso(s), toIso(e)];
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? `${match[1]}/${match[2]}/${match[3]}` : '选择日期';
  }

  if (!$('#dateRangePickerV2Styles')) {
    const style = document.createElement('style');
    style.id = 'dateRangePickerV2Styles';
    style.textContent = `
      .multi-filter{grid-template-columns:minmax(130px,.75fr) minmax(130px,.75fr) minmax(220px,1.15fr) minmax(250px,1.35fr) auto!important}
      #dateRangeField .date-range-tools{display:block!important;white-space:normal!important}
      #dateRangeField .date-range-button{width:100%;min-width:250px}
      #dateRangeField .date-range-popover{left:auto!important;right:0!important;width:740px!important;padding:0!important;border-radius:14px!important;overflow:hidden!important}
      .date-picker-shell{display:grid;grid-template-columns:124px 1fr;min-height:338px}
      .date-picker-presets{padding:10px 8px;border-right:1px solid #ececf0;display:flex;flex-direction:column;gap:2px;background:#fbfbfc}
      .date-picker-presets .date-preset{height:36px;border:0!important;border-radius:7px!important;background:transparent!important;text-align:left;padding:0 12px!important;font-size:12px!important}
      .date-picker-presets .date-preset:hover{background:#f1f3f7!important}
      .date-picker-presets .date-preset.active{background:#eef5ff!important;color:#0066cc!important}
      .date-picker-main{padding:12px 16px 10px;min-width:0}
      .date-calendar-grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
      .date-calendar-header{height:34px;display:grid;grid-template-columns:32px 1fr 32px;align-items:center}
      .date-calendar-title{text-align:center;font-size:14px;font-weight:700;color:#1d1d1f}
      .date-month-nav{width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:#6e6e73;font-size:20px;cursor:pointer}
      .date-month-nav:hover{background:#f3f4f6;color:#1d1d1f}
      .date-weekdays,.date-days{display:grid;grid-template-columns:repeat(7,1fr)}
      .date-weekdays span{height:28px;display:flex;align-items:center;justify-content:center;color:#8a8a8e;font-size:11px}
      .date-day{position:relative;height:34px;border:0;background:transparent;color:#1d1d1f;font-size:12px;cursor:pointer;padding:0}
      .date-day.blank{cursor:default}.date-day::before{content:"";position:absolute;left:0;right:0;top:3px;bottom:3px;background:transparent}
      .date-day.in-range::before{background:#eef5ff}.date-day.range-start::before{left:50%;background:#eef5ff}.date-day.range-end::before{right:50%;background:#eef5ff}
      .date-day span{position:relative;z-index:1;width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center}
      .date-day:hover span{background:#f1f3f5}.date-day.range-start span,.date-day.range-end span{background:#0071e3;color:#fff;font-weight:700}
      .date-day.today span{box-shadow:inset 0 0 0 1px #0071e3}
      .date-picker-footer{margin-top:10px;padding-top:10px;border-top:1px solid #ececf0;display:flex;align-items:center;justify-content:space-between;gap:12px}
      .date-picker-selection{font-size:11px;color:#6e6e73}.date-picker-selection strong{color:#1d1d1f}
      @media(max-width:900px){#dateRangeField .date-range-popover{width:min(740px,calc(100vw - 40px))!important}.date-picker-shell{grid-template-columns:112px 1fr}.date-calendar-grid{gap:10px}}
      @media(max-width:640px){.date-picker-shell{grid-template-columns:1fr}.date-picker-presets{border-right:0;border-bottom:1px solid #ececf0;display:grid;grid-template-columns:repeat(3,1fr)}.date-calendar-grid{grid-template-columns:1fr}.date-calendar:nth-child(2){display:none}}
    `;
    document.head.appendChild(style);
  }

  field.innerHTML = `
    <span class="date-range-label">日期</span>
    <div class="date-range-tools">
      <button id="dateRangeButton" class="date-range-button" type="button" aria-haspopup="dialog" aria-expanded="false">
        <span id="dateRangeText"></span><span class="date-range-icon">▣</span>
      </button>
    </div>
    <div id="dateRangePopover" class="date-range-popover hidden" role="dialog" aria-label="日期范围">
      <div class="date-picker-shell">
        <div class="date-picker-presets">
          <button class="date-preset" type="button" data-date-preset="month">本月</button>
          <button class="date-preset" type="button" data-date-preset="last-month">上月</button>
          <button class="date-preset" type="button" data-date-preset="today">今天</button>
          <button class="date-preset" type="button" data-date-preset="yesterday">昨天</button>
          <button class="date-preset" type="button" data-date-preset="7d">近7天</button>
          <button class="date-preset" type="button" data-date-preset="30d">近30天</button>
          <button class="date-preset" type="button" data-date-preset="6m">近半年</button>
        </div>
        <div class="date-picker-main">
          <div class="date-calendar-grid"><div id="dateCalendarLeft" class="date-calendar"></div><div id="dateCalendarRight" class="date-calendar"></div></div>
          <div class="date-picker-footer"><div id="dateRangeSelection" class="date-picker-selection"></div><button id="dateRangeApply" class="date-range-apply" type="button">应用</button></div>
        </div>
      </div>
    </div>`;

  const button = $('#dateRangeButton');
  const popover = $('#dateRangePopover');
  const left = $('#dateCalendarLeft');
  const right = $('#dateCalendarRight');
  const selection = $('#dateRangeSelection');
  let draftStart = start.value;
  let draftEnd = end.value;
  let anchorMonth = monthStart(parseIso(draftEnd) || new Date(), -1);

  function chooseAnchor() {
    const s = parseIso(start.value);
    const e = parseIso(end.value);
    if (!s && !e) return monthStart(new Date());
    if (!s || !e) return monthStart(s || e);
    if (s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth()) return monthStart(s);
    return monthStart(e, -1);
  }

  function refreshCommitted() {
    $('#dateRangeText').textContent = `${formatDate(start.value)} – ${formatDate(end.value)}`;
    document.querySelectorAll('#dateRangeField [data-date-preset]').forEach(preset => {
      const [presetStart, presetEnd] = presetRange(preset.dataset.datePreset);
      preset.classList.toggle('active', start.value === presetStart && end.value === presetEnd);
    });
  }

  function dayButton(iso, day, todayIso) {
    const classes = ['date-day'];
    if (draftStart && draftEnd && iso > draftStart && iso < draftEnd) classes.push('in-range');
    if (iso === draftStart) classes.push('range-start');
    if (iso === draftEnd) classes.push('range-end');
    if (iso === todayIso) classes.push('today');
    return `<button type="button" class="${classes.join(' ')}" data-range-day="${iso}"><span>${day}</span></button>`;
  }

  function renderCalendar(target, month, side) {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1, 12).getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12).getDate();
    const todayIso = toIso(new Date());
    const blanks = Array.from({ length: firstWeekday }, () => '<span class="date-day blank"></span>').join('');
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return dayButton(toIso(new Date(month.getFullYear(), month.getMonth(), day, 12)), day, todayIso);
    }).join('');
    target.innerHTML = `
      <div class="date-calendar-header">
        ${side === 'left' ? '<button type="button" class="date-month-nav" data-month-nav="-1" aria-label="上一个月">‹</button>' : '<span></span>'}
        <div class="date-calendar-title">${monthTitle(month)}</div>
        ${side === 'right' ? '<button type="button" class="date-month-nav" data-month-nav="1" aria-label="下一个月">›</button>' : '<span></span>'}
      </div>
      <div class="date-weekdays"><span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span></div>
      <div class="date-days">${blanks}${days}</div>`;
  }

  function renderCalendars() {
    renderCalendar(left, anchorMonth, 'left');
    renderCalendar(right, monthStart(anchorMonth, 1), 'right');
    selection.innerHTML = draftStart && draftEnd
      ? `<strong>${formatDate(draftStart)} – ${formatDate(draftEnd)}</strong>`
      : draftStart ? `<strong>${formatDate(draftStart)}</strong> · 请选择结束日期` : '请选择开始日期';
  }

  function openPopover() {
    draftStart = start.value;
    draftEnd = end.value;
    anchorMonth = chooseAnchor();
    renderCalendars();
    popover.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
  }
  function closePopover() {
    popover.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
  }
  function commitRange(nextStart, nextEnd) {
    if (!nextStart || !nextEnd || nextStart > nextEnd) return false;
    start.value = nextStart;
    end.value = nextEnd;
    draftStart = nextStart;
    draftEnd = nextEnd;
    refreshCommitted();
    window.dispatchEvent(new CustomEvent('shopee-date-range-changed', {
      detail: { startDate: nextStart, endDate: nextEnd },
    }));
    return true;
  }

  function syncFromInputs() {
    draftStart = start.value;
    draftEnd = end.value;
    anchorMonth = chooseAnchor();
    refreshCommitted();
    if (!popover.classList.contains('hidden')) renderCalendars();
  }

  button.addEventListener('click', event => {
    event.preventDefault();
    if (popover.classList.contains('hidden')) openPopover();
    else closePopover();
  });

  field.addEventListener('click', event => {
    const preset = event.target.closest('[data-date-preset]');
    if (preset) {
      event.preventDefault();
      const [nextStart, nextEnd] = presetRange(preset.dataset.datePreset);
      commitRange(nextStart, nextEnd);
      closePopover();
      return;
    }
    const nav = event.target.closest('[data-month-nav]');
    if (nav) {
      event.preventDefault();
      anchorMonth = monthStart(anchorMonth, Number(nav.dataset.monthNav));
      renderCalendars();
      return;
    }
    const day = event.target.closest('[data-range-day]');
    if (!day) return;
    event.preventDefault();
    const value = day.dataset.rangeDay;
    if (!draftStart || draftEnd) { draftStart = value; draftEnd = ''; }
    else if (value < draftStart) { draftEnd = draftStart; draftStart = value; }
    else draftEnd = value;
    renderCalendars();
  });

  $('#dateRangeApply').addEventListener('click', event => {
    event.preventDefault();
    if (!draftStart || !draftEnd) return;
    if (commitRange(draftStart, draftEnd)) closePopover();
  });
  document.addEventListener('click', event => {
    if (!field.contains(event.target)) closePopover();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePopover();
  });
  window.addEventListener('shopee-date-range-sync', syncFromInputs);

  refreshCommitted();
})();
