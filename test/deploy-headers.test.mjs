import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import viteConfig from '../vite.config.mjs';

test('Cloudflare Pages carries the preview connection policy on HTML and Worker paths', async () => {
  const headers = await readFile(new URL('../public/_headers', import.meta.url), 'utf8');
  const [path, header] = headers.trimEnd().split(/\r?\n/);
  const policy = viteConfig.preview.headers['Content-Security-Policy'];

  assert.equal(path, '/*');
  assert.match(header, /^[ \t]+Content-Security-Policy:/);
  assert.equal(header.trim(), `Content-Security-Policy: ${policy}`);
});
