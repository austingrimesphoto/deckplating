import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import * as ts from 'typescript';

const source = await fs.readFile(new URL('../netlify/functions/lib/cursor-pagination.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const { collectCursorPages } = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
);

test('keyset pagination returns more than 1,000 rows exactly once', async () => {
  const sourceRows = Array.from({ length: 1_207 }, (_, index) => ({
    id: String(index).padStart(6, '0'),
    value: index,
  }));
  const calls = [];
  const rows = await collectCursorPages(async (afterId, limit) => {
    calls.push({ afterId, limit });
    const start = afterId === null ? 0 : sourceRows.findIndex((row) => row.id === afterId) + 1;
    return { data: sourceRows.slice(start, start + limit), error: null };
  });

  assert.equal(rows.length, 1_207);
  assert.equal(new Set(rows.map((row) => row.id)).size, 1_207);
  assert.deepEqual(rows, sourceRows);
  assert.equal(calls.length, 3);
});

test('keyset pagination rejects duplicate or out-of-order page boundaries', async () => {
  await assert.rejects(
    collectCursorPages(async (afterId) => ({
      data: afterId === null ? [{ id: 'b' }, { id: 'c' }] : [{ id: 'c' }],
      error: null,
    }), 2),
    /strictly increasing|duplicate/,
  );
});
