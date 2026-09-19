// Run locally with: node tests/local/mechanisms.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import console from 'node:console';
import { createServer } from 'vite';
const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const failures = [];
const check = (name, fn) => {
  try {
    fn();
  } catch (error) {
    failures.push(name + ': ' + error.message);
  }
};
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
  const { createTreeLayout } = await server.ssrLoadModule(
    '/src/visualization/treeLayout.ts',
  );
  const { treeNodeSchema } = await server.ssrLoadModule(
    '/src/protocol/traceSchemas.ts',
  );
  const catalog = JSON.parse(
    await fs.readFile('src/data/catalog/algorithms.json', 'utf8'),
  );
  const run = async (entry, code = entry.code) => {
    const instrumented = instrumentSource(code, entry.structure);
    assert.ok(instrumented, entry.id + ': recognized');
    const result = await runValidatedFrameCode(
      instrumented,
      code,
      entry.structure,
    );
    assert.ok(result.ok, entry.id + ': ' + JSON.stringify(result.error));
    const built = buildFrameTimeline(result.trace);
    assert.ok(built.ok, entry.id + ': timeline');
    const scene = (n) => getFrameScene(built.timeline, n);
    return {
      trace: result.trace,
      scene,
      final: scene(built.timeline.operationCount),
    };
  };
  for (const entry of catalog) {
    const { trace, scene, final } = await run(entry);
    const snapshots = trace.frames.map((_, i) => scene(i + 1));
    for (let i = trace.frames.length; i > 0; i--)
      assert.deepEqual(scene(i), snapshots[i - 1], entry.id + ': reverse seek');
    if (entry.id === 'sliding-window')
      check(entry.id, () => {
        assert.deepEqual(final.focus, {
          index: null,
          pointers: {},
          range: [2, 5],
        });
        assert.deepEqual(final.markers.best, [2, 3, 4]);
      });
    if (entry.id === 'maximum-subarray')
      check(entry.id, () => {
        assert.deepEqual(final.focus, {
          index: null,
          pointers: {},
          range: [3, 7],
        });
        assert.deepEqual(final.markers.best, [3, 4, 5, 6]);
      });
    if (entry.id === 'lowest-common-ancestor')
      check(entry.id, () => {
        assert.deepEqual(Object.values(final.markers).flat(), ['node-1']);
      });
    if (entry.id === 'longest-common-subsequence')
      check(entry.id, () => {
        assert.deepEqual(final.markers.cur, [{ row: 7, column: 6 }]);
      });
    if (entry.id === 'n-queens')
      check(entry.id, () => {
        const queens = final.values.flatMap((row, r) =>
          row.flatMap((value, c) =>
            value === 1 ? [{ row: r, column: c }] : [],
          ),
        );
        assert.deepEqual(final.markers.cur, queens);
      });
    if (entry.id === 'boyer-moore-majority-vote')
      check(entry.id, () => {
        assert.deepEqual(final.focus.pointers, {});
        assert.deepEqual(final.markers.cand, [0, 1, 5, 6]);
      });
    if (['merge-sort', 'quick-sort'].includes(entry.id)) {
      check(entry.id + ': completion', () => {
        assert.deepEqual(final.focus, {
          index: null,
          pointers: {},
          range: null,
        });
        assert.deepEqual(final.workingValues, {});
      });
      if (entry.id === 'quick-sort')
        for (const snapshot of snapshots)
          check('pivot follows its value', () => {
            for (const index of snapshot.markers.pivot ?? [])
              assert.equal(
                snapshot.values[index],
                snapshot.workingValues.pivot,
              );
          });
      for (let i = 0; i < trace.frames.length; i++) {
        const frame = trace.frames[i];
        if (frame.operation.type === 'call')
          check(entry.id + ': callee locals', () =>
            assert.deepEqual(scene(i + 1).workingValues, {}),
          );
        if (
          frame.operation.type === 'assign' &&
          /^[a-z]+$/i.test(frame.operation.target)
        )
          check(entry.id + ': active locals', () =>
            assert.deepEqual(
              scene(i + 1).workingValues[frame.operation.target],
              frame.operation.value,
            ),
          );
        if (
          frame.operation.type === 'return' &&
          scene(i + 1).scopeStack.length > 0
        ) {
          const callId = frame.commands.find(
            (c) => c.type === 'scope.leave',
          ).id;
          check(entry.id + ': restore caller', () =>
            assert.deepEqual(
              scene(i + 1).workingValues,
              scene(callId - 1).workingValues ?? {},
            ),
          );
        }
      }
    }
  }
  const variants = [
    [
      'sliding-window',
      '[2, 1, 5, 1, 3, 2]',
      '[9, 8, 7, 1, 0, -1]',
      (final) => assert.deepEqual(final.markers.best, [0, 1, 2]),
    ],
    [
      'sliding-window',
      '[2, 1, 5, 1, 3, 2]',
      '[1, 1, 1, 1, 1, 1]',
      (final) => assert.deepEqual(final.markers.best, [0, 1, 2]),
    ],
    [
      'sliding-window',
      'const size = 3;',
      'const size = 1;',
      (final) => assert.deepEqual(final.markers.best, [2]),
    ],
    [
      'sliding-window',
      'const size = 3;',
      'const size = 6;',
      (final) => assert.deepEqual(final.markers.best, [0, 1, 2, 3, 4, 5]),
    ],
    [
      'maximum-subarray',
      '[-2, 1, -3, 4, -1, 2, 1, -5, 4]',
      '[-3, -1, -2]',
      (final) => assert.deepEqual(final.markers.best, [1]),
    ],
    [
      'boyer-moore-majority-vote',
      '[2, 2, 1, 1, 1, 2, 2]',
      '[1, 2, 3]',
      (final) => assert.deepEqual(final.markers.cand, []),
    ],
    [
      'boyer-moore-majority-vote',
      '[2, 2, 1, 1, 1, 2, 2]',
      '[]',
      (final) => assert.deepEqual(final.markers.cand, []),
    ],
    [
      'longest-common-subsequence',
      "'ABCBDAB'",
      "''",
      (final) => assert.deepEqual(final.markers.cur, [{ row: 0, column: 6 }]),
    ],
  ];
  for (const [id, from, to, verify] of variants) {
    const entry = catalog.find((e) => e.id === id);
    assert.ok(entry.code.includes(from), id + ': variant input');
    const { final } = await run(entry, entry.code.replace(from, to));
    check(id + ': edge case', () => verify(final));
  }
  for (const id of ['quick-sort', 'merge-sort']) {
    const entry = catalog.find((e) => e.id === id);
    for (const values of ['[]', '[1]', '[4, 3, 2, 1]', '[2, 2, 2]']) {
      const { final } = await run(
        entry,
        entry.code.replace('[4, 2, 4, 1, 3]', values),
      );
      check(id + ': edge case', () => {
        assert.deepEqual(
          final.values,
          JSON.parse(values).sort((a, b) => a - b),
        );
        assert.deepEqual(final.focus, {
          index: null,
          pointers: {},
          range: null,
        });
        assert.deepEqual(final.workingValues, {});
      });
    }
  }
  for (const name of ['value', '__trace_majority_0']) {
    const entry = catalog.find((e) => e.id === 'boyer-moore-majority-vote');
    const { final } = await run(
      entry,
      entry.code.replace(/\bcandidate\b/g, name),
    );
    check('renamed majority candidate: ' + name, () =>
      assert.deepEqual(final.markers.cand, [0, 1, 5, 6]),
    );
  }
  const inorder = catalog.find((entry) => entry.id === 'binary-tree-traversal');
  const treeStart = inorder.code.indexOf('const T = ');
  const treeEnd = inorder.code.indexOf(';', treeStart);
  for (const side of ['left', 'right']) {
    const node = { value: 1, left: null, right: null };
    node[side] = { value: 2, left: null, right: null };
    const code =
      inorder.code.slice(0, treeStart) +
      'const T = ' +
      JSON.stringify(node) +
      inorder.code.slice(treeEnd);
    const { final, trace } = await run(inorder, code);
    check('single ' + side + ' child', () => {
      assert.deepEqual(
        trace.frames.at(-1).operation.value,
        side === 'left' ? [2, 1] : [1, 2],
      );
      const layout = createTreeLayout(final);
      assert.equal(layout.nodes.length, 2);
      assert.equal(layout.links.length, 1);
      const parent = layout.nodes.find((n) => n.node.value === 1),
        child = layout.nodes.find((n) => n.node.value === 2);
      assert.ok(side === 'left' ? child.x < parent.x : child.x > parent.x);
    });
  }
  check('invalid binary side metadata', () =>
    assert.equal(
      treeNodeSchema.safeParse({ id: 'a', children: [], childSide: 'left' })
        .success,
      false,
    ),
  );
  assert.equal(failures.length, 0, failures.join('\n'));

  console.log(
    'PASS: all 20 timelines seek correctly; result markers, recursive locals and one-child trees.',
  );
} finally {
  await server.close();
}
