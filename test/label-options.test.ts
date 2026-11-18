import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LABEL_OPTIONS, decodeLabelOptions, labelsForFocus, type HeadLabelAnchor } from '../src/anatomy/label-options.ts';
import { VIEWS } from '../src/anatomy/views.ts';

test('defaults legacy settings to Overview and validates current label preferences', () => {
  assert.deepEqual(decodeLabelOptions(undefined), DEFAULT_LABEL_OPTIONS);
  assert.deepEqual(decodeLabelOptions({ focus: 'hands', headGroup: 'brain', handGroup: 'forearm' }), {
    focus: 'hands', headGroup: 'brain', handGroup: 'forearm',
  });
  assert.deepEqual(decodeLabelOptions({ focus: 'all', headGroup: 'outline', handGroup: 'unknown' }), DEFAULT_LABEL_OPTIONS);
  assert.equal(VIEWS.study.labelOptions.focus, 'overview');
  assert.equal(VIEWS.hands.labelOptions.focus, 'hands');
  assert.equal(VIEWS.hands.labelOptions.handGroup, 'fingers');
});

test('Overview favors representatives from multiple head layers and Head filters by layer', () => {
  const position = { x: 0.5, y: 0.5 };
  const skull: HeadLabelAnchor[] = ['Mandible', 'Frontal bone'].map((text) => ({ text, layer: 'skull', ...position }));
  const brain: HeadLabelAnchor[] = ['Brainstem', 'Cerebrum'].map((text) => ({ text, layer: 'brain', ...position }));
  const head = [...skull, ...brain];
  assert.deepEqual(labelsForFocus(head, [], DEFAULT_LABEL_OPTIONS).map(({ text }) => text), [
    'Frontal bone', 'Cerebrum', 'Mandible', 'Brainstem',
  ]);
  assert.deepEqual(labelsForFocus(head, [], { ...DEFAULT_LABEL_OPTIONS, focus: 'head', headGroup: 'brain' }), brain);
});
