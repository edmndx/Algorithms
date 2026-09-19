// Run locally with: node tests/local/catalog.mjs
import console from 'node:console';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import prettier from 'prettier';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const { instrumentSource } = await server.ssrLoadModule(
    '/src/instrumentation/instrumentSource.ts',
  );
  const { runValidatedFrameCode } = await server.ssrLoadModule(
    '/src/runner/runner.ts',
  );
  const { buildFrameTimeline, getFrameScene } = await server.ssrLoadModule(
    '/src/playback/frameTimeline.ts',
  );
  const { createFrameNarrationEntries } = await server.ssrLoadModule(
    '/src/features/frameNarration.ts',
  );
  const catalog = JSON.parse(
    await fs.readFile('src/data/catalog/algorithms.json', 'utf8'),
  );
  const expected = [
    4,
    ['A', 'B', 'C', 'D'],
    ['A', 'B', 'D', 'C'],
    [1, 2, 3, 4, 5, 6, 7],
    9,
    [
      [2, 2, 0],
      [2, 0, 0],
      [2, 2, 2],
    ],
    6,
    ['A', 'E', 'B', 'C', 'D'],
    null,
    null,
    null,
    4,
    4,
    [1, 2, 3, 4, 8, 12, 11, 10, 9, 5, 6, 7],
    [
      [7, 4, 1],
      [8, 5, 2],
      [9, 6, 3],
    ],
    [1, 2],
    true,
    [1, 2, 3, 4, 4],
    [1, 2, 3, 4, 4],
    2,
  ];
  for (const [index, entry] of catalog.entries()) {
    assert.match(
      entry.code,
      /const answer = /,
      entry.id + ': consistent invocation',
    );
    assert.equal(
      entry.code,
      (
        await prettier.format(entry.code, {
          parser: 'babel',
          singleQuote: true,
          trailingComma: 'all',
        })
      ).trimEnd(),
      entry.id + ': formatting',
    );
    const instrumented = instrumentSource(entry.code, entry.structure);
    assert.ok(instrumented, entry.id + ': recognized');
    const result = await runValidatedFrameCode(
      instrumented,
      entry.code,
      entry.structure,
    );
    assert.ok(result.ok, entry.id + ': ' + JSON.stringify(result.error));
    const built = buildFrameTimeline(result.trace);
    assert.ok(built.ok, entry.id + ': timeline');
    if (expected[index] !== null)
      assert.deepEqual(
        result.trace.frames.at(-1).operation.value,
        expected[index],
        entry.id + ': result',
      );
    if (entry.structure === 'graph') {
      assert.deepEqual(createFrameNarrationEntries(result.trace, 0), []);
      for (const [frameIndex, frame] of result.trace.frames.entries()) {
        const entries = createFrameNarrationEntries(
          result.trace,
          frameIndex + 1,
        );
        assert.equal(entries[0].sequence, frameIndex + 1);
        assert.equal(entries.length, frameIndex + 1);
        for (const command of frame.commands) {
          if (command.type === 'graph.distance')
            assert.ok(
              entries[0].text.includes(
                command.nodeId + ': distance = ' + (command.distance ?? '∞'),
              ),
              entry.id + ': distance belongs in console',
            );
          if (command.type === 'graph.nodeMetric')
            assert.ok(
              entries[0].text.includes(
                command.nodeId + ': ' + command.name + ' = ' + command.value,
              ),
              entry.id + ': named metric belongs in console',
            );
        }
      }
    }
    const timeline = built.timeline;
    const final = getFrameScene(timeline, timeline.operationCount);
    assert.deepEqual(
      getFrameScene(timeline, timeline.operationCount),
      final,
      entry.id + ': repeat seek',
    );
    if (entry.id === 'longest-increasing-subsequence') {
      assert.deepEqual(final.workingValues.lengths, [1, 1, 1, 2, 2, 3, 4, 4]);
      assert.equal(final.workingValues.best, 4);
      assert.equal(getFrameScene(timeline, 0).workingValues, undefined);
      const step =
        result.trace.frames.findIndex(
          (f) =>
            f.operation.type === 'assign' && f.operation.target === 'lengths',
        ) + 1;
      assert.deepEqual(
        getFrameScene(timeline, step).workingValues.lengths,
        Array(8).fill(1),
      );
    }
  }
  for (const name of ['$lengths', 'μlengths']) {
    const entry = catalog.find(
      (item) => item.id === 'longest-increasing-subsequence',
    );
    const code = entry.code.replace(/\blengths\b/g, name);
    const result = await runValidatedFrameCode(
      instrumentSource(code, 'array'),
      code,
      'array',
    );
    assert.ok(result.ok, name);
    const built = buildFrameTimeline(result.trace);
    assert.ok(built.ok, name);
    assert.deepEqual(
      getFrameScene(built.timeline, built.timeline.operationCount)
        .workingValues[name],
      [1, 1, 1, 2, 2, 3, 4, 4],
      name,
    );
  }
  const lcs = catalog.find(
    (entry) => entry.id === 'longest-common-subsequence',
  );
  const legacy = lcs.code.replace(
    '  for (let row = 1;',
    '  for (let row = 0; row <= a.length; row++) { table[row][0] = 0; }\n  for (let column = 0; column <= b.length; column++) { table[0][column] = 0; }\n  for (let row = 1;',
  );
  for (const [code, expected] of [
    [legacy, 4],
    [lcs.code.replace("'ABCBDAB'", "''"), 0],
  ]) {
    const instrumented = instrumentSource(code, 'matrix');
    assert.ok(instrumented, 'LCS legacy or empty input');
    const result = await runValidatedFrameCode(instrumented, code, 'matrix');
    assert.ok(result.ok);
    assert.ok(buildFrameTimeline(result.trace).ok);
    assert.equal(result.trace.frames.at(-1).operation.value, expected);
  }
  console.log(
    'PASS: all 20 starters, expected results, formatting, tracing and working-state seek.',
  );
} finally {
  await server.close();
}
