import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { brainRegionForMesh } from '../src/anatomy/brain-regions.ts';

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

  const mandible = bounds('Mandible');
  assert.ok(mandible.min[1] < -0.09, 'the jaw is below the origin');
  const leftMaxilla = bounds('Maxilla left');
  const rightMaxilla = bounds('Maxilla right');
  assert.ok(leftMaxilla.max[1] > mandible.max[1] && rightMaxilla.max[1] > mandible.max[1], 'the paired maxillae are above the mandible');
  assert.ok(leftMaxilla.max[0] > 0.03 && rightMaxilla.min[0] < -0.03, 'the upper jaw includes both sides');
  assert.ok(bounds('Frontal bone').max[1] > 0.09, 'the forehead rises above the origin');
  assert.ok(bounds('Nasal bone left').min[2] > 0.08, 'the nasal bones face positive Z');
});

test('all shipped anatomy meshes require Draco compression', async () => {
  const extension = 'KHR_draco_mesh_compression';
  for (const layer of ['skull', 'brain', 'muscles', 'eyes']) {
    const bytes = await readFile(new URL(`../public/models/${layer}.glb`, import.meta.url));
    const document = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
    assert.ok(document.extensionsRequired.includes(extension), layer);
    for (const { primitives } of document.meshes) {
      for (const { extensions } of primitives) assert.ok(extensions?.[extension], layer);
    }
  }
});

test('brain lesson can select both sides of the cortex, cerebellum, and brainstem', async () => {
  const bytes = await readFile(new URL('../public/models/brain.glb', import.meta.url));
  const { nodes } = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  const meshes = new Set(nodes.filter(({ mesh }) => mesh !== undefined).map(({ name }) => name));

  const expectedRegions = {
    Cerebrum: ['FJ1833', 'FJ1834', 'FJ1758', 'FJ1806'],
    Cerebellum: ['FJ1781', 'FJ1830'],
    Brainstem: ['FJ1770', 'FJ1817', 'FJ1775', 'FJ1822', 'FJ1769', 'FJ1831'],
  };
  for (const [region, ids] of Object.entries(expectedRegions)) {
    for (const id of ids) {
      const name = `Brain ${id}`;
      assert.ok(meshes.has(name), name);
      assert.equal(brainRegionForMesh(name), region, name);
    }
  }
  assert.equal(brainRegionForMesh('Brain FJ1743'), undefined, 'a diencephalon mesh is outside the lesson regions');
});
