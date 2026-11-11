import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('the skull GLB exports once into Y-up, anterior-positive meter coordinates', async () => {
  const bytes = await readFile(new URL('../public/models/skull.glb', import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
  const document = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));

  function bounds(name) {
    const node = document.nodes.find((candidate) => candidate.name === name);
    assert.ok(node, `expected a named mesh for ${name}`);
    const [primitive] = document.meshes[node.mesh].primitives;
    return document.accessors[primitive.attributes.POSITION];
  }

  assert.ok(bounds('Mandible').min[1] < -0.09, 'the jaw is below the origin');
  assert.ok(bounds('Frontal bone').max[1] > 0.09, 'the forehead rises above the origin');
  assert.ok(bounds('Nasal bone left').min[2] > 0.08, 'the nasal bones face positive Z');
});
