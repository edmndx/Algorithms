import type { TraceCommand } from '../protocol/traceTypes';
import type { FrameTrace } from '../protocol/frameTrace';
import { reduceArray } from './reducers/array';
import { reduceGraph } from './reducers/graph';
import { reduceLinkedList } from './reducers/linkedList';
import { reduceMatrix } from './reducers/matrix';
import { reduceTree } from './reducers/tree';
import { assertNever, SceneReducerError } from './sceneReducerError';
import { createInitializedScene, type SceneState } from './sceneState';

export {
  SceneReducerError,
  type SceneReducerErrorCode,
} from './sceneReducerError';

export function reduceTraceCommand(
  scene: SceneState,
  command: TraceCommand,
): SceneState {
  switch (command.type) {
    case 'scene.init':
      return reduceSceneInit(scene, command);

    case 'scope.enter':
      if (scene.structure === null || scene.scopeStack.length === 0)
        throw new SceneReducerError(
          'INVALID_COMMAND',
          'Cannot enter a closed scope.',
        );
      return {
        ...scene,
        ...(scene.structure === 'array' ? { workingValues: {} } : {}),
        scopeStack: [
          ...scene.scopeStack,
          {
            id: command.id,
            target: command.target,
            ...(scene.structure === 'array'
              ? {
                  callerFocus: scene.focus,
                  callerWorkingValues: scene.workingValues ?? {},
                }
              : {}),
          },
        ],
      };

    case 'scope.leave': {
      const current = scene.scopeStack.at(-1);
      if (current?.id !== command.id)
        throw new SceneReducerError(
          'INVALID_COMMAND',
          'Scope leave is out of order.',
        );
      const scopeStack = scene.scopeStack.slice(0, -1);
      return scene.structure === 'array' && current.callerFocus !== undefined
        ? {
            ...scene,
            scopeStack,
            focus: current.callerFocus,
            workingValues: current.callerWorkingValues ?? {},
          }
        : { ...scene, scopeStack };
    }

    case 'array.create':
    case 'array.compare':
    case 'array.swap':
    case 'array.set':
    case 'array.mark':
    case 'array.focus':
    case 'array.compareValue':
      return reduceArray(scene, command);

    case 'matrix.create':
    case 'matrix.compare':
    case 'matrix.set':
    case 'matrix.mark':
    case 'matrix.visit':
      return reduceMatrix(scene, command);

    case 'linked-list.create':
    case 'linked-list.mark':
    case 'linked-list.pointer':
    case 'linked-list.compareIdentity':
      return reduceLinkedList(scene, command);

    case 'tree.create':
    case 'tree.compare':
    case 'tree.visit':
    case 'tree.mark':
      return reduceTree(scene, command);

    case 'graph.create':
    case 'graph.visitNode':
    case 'graph.discoverNode':
    case 'graph.predecessor':
    case 'graph.visitEdge':
    case 'graph.markNodes':
    case 'graph.markEdges':
    case 'graph.distance':
    case 'graph.nodeMetric':
    case 'graph.frontier':
      return reduceGraph(scene, command);

    default:
      return assertNever(command);
  }
}

export function reduceTraceFrame(
  previous: SceneState,
  frame: FrameTrace['frames'][number],
): SceneState {
  let scene = clearFrameEmphasis(previous);
  for (const command of frame.commands)
    scene = reduceTraceCommand(scene, command);
  if (
    scene.structure === 'array' &&
    scene.scopeStack.length > 0 &&
    frame.operation.type === 'assign'
  ) {
    const { target, value } = frame.operation;
    const values = scene.workingValues ?? {};
    const indexed =
      /^([\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*)\[(\d+)\]$/u.exec(
        target,
      );
    if (indexed && Array.isArray(values[indexed[1]!])) {
      const items = [...(values[indexed[1]!] as readonly unknown[])];
      const index = Number(indexed[2]);
      if (index < items.length) {
        items[index] = value;
        scene = {
          ...scene,
          workingValues: { ...values, [indexed[1]!]: items },
        };
      }
    } else if (
      /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u.test(target) &&
      (value === null || typeof value !== 'object' || Array.isArray(value))
    ) {
      scene = { ...scene, workingValues: { ...values, [target]: value } };
    }
  }
  if (
    scene.structure === 'array' &&
    scene.scopeStack.length === 0 &&
    frame.operation.type === 'return' &&
    Array.isArray(frame.operation.value)
  ) {
    scene = { ...scene, workingValues: {} };
  }
  return scene;
}

function clearFrameEmphasis(scene: SceneState): SceneState {
  switch (scene.structure) {
    case 'array':
      return {
        ...scene,
        comparedIndices: null,
        valueComparison: null,
        focus: { ...scene.focus, index: null },
      };
    case 'matrix':
      return {
        ...scene,
        comparedPositions: null,
        markers: {},
      };
    case 'graph':
      return {
        ...scene,
        currentNodeId: null,
        currentEdgeId: null,
        nodeMarkers: { ...scene.nodeMarkers, candidate: [], current: [] },
        edgeMarkers: { ...scene.edgeMarkers, current: [] },
      };
    case 'tree':
      return { ...scene, comparedNodeIds: null, currentNodeId: null };
    case 'linked-list':
      return { ...scene, comparison: null };
    default:
      return scene;
  }
}

function reduceSceneInit(
  scene: SceneState,
  command: Extract<TraceCommand, { readonly type: 'scene.init' }>,
): SceneState {
  if (scene.structure !== null) {
    throw new SceneReducerError(
      'DUPLICATE_SCENE_INIT',
      'scene.init can only be applied to an empty scene.',
    );
  }

  return createInitializedScene(command.structure);
}
