'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');

assert.match(source, /t\('att\.preview','预览'\)/, 'CI attachment area must expose an explicit preview action');
assert.match(source, /openAttachmentPreview\(\[a\]/, 'CI preview action must open the in-app attachment modal');
assert.match(source, /function _attBuildExcelPreviewContent\(att\)/, 'generic preview must render Excel workbook contents');
assert.match(source, /XLSX\.read\(base64,\{type:'base64',cellDates:true\}\)/, 'Excel preview must parse the original uploaded workbook');
assert.match(source, /function _attExcelSwitch\(index\)/, 'preview must support switching workbook sheets');
assert.match(source, /\.att-excel-grid th\{position:sticky;top:0/, 'preview table header must remain visible while scrolling');
assert.match(source, /var maxRows=2000/, 'large worksheets must be capped to protect page responsiveness');
assert.match(source, /html\+=rowIndex===0\?'<th>'\+esc\(value\)/, 'workbook cell content must be HTML escaped');

console.log('CI attachment online Excel preview: PASS');
