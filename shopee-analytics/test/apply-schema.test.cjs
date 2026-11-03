'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'apply-schema.cjs'), 'utf8');

test('a mistake in the schema says which file and line it was in', () => {
  // The database reports where in the text it gave up as a character
  // count. On its own that is no use to a reader; the file and the line
  // are what is needed.
  assert.ok(source.includes('locate(text, error.position)'), 'the error must be placed in the file');
  assert.ok(source.includes('${name}:${where.line}'), 'the error must name the file and the line');
  assert.ok(source.includes('ROLLBACK'), 'a failed file must not be left half applied');
});

test('each file is applied on its own', () => {
  // Applied together, the whole thing fails on the first wrong word and
  // says nothing about where it was.
  assert.ok(source.includes('for (const name of SCHEMA_FILES)'), 'each file must be applied separately');
  assert.ok(!source.includes(".join('\\n\\n')"), 'the files must not be applied as one text');
});

test('the schema has no function called in the wrong way', () => {
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  // `TIMESTAMPTZ NOW()` is not a thing: the function is now() and it takes
  // brackets. The database refuses the whole schema over it, which is a
  // long way round to learn that.
  assert.ok(!/TIMESTAMPTZ\s+NOW\s*\(\s*\)/i.test(schema), 'a timestamp default must be now()');
  assert.ok(!/\bDEFAULT\s+NOW\s*\(\s*\)/i.test(schema), 'a default must be now()');
});
