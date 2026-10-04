import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Baota reverse proxy keeps the public host and streams AI responses', () => {
  const config = read('deploy/nginx-location.conf.example');
  assert.match(config, /proxy_pass\s+http:\/\/127\.0\.0\.1:3001;/);
  assert.match(config, /proxy_set_header\s+Host\s+\$host;/);
  assert.match(config, /proxy_buffering\s+off;/);
  assert.match(config, /proxy_read_timeout\s+\d+s;/);
  assert.match(config, /client_max_body_size\s+0;/);
});

test('systemd example runs the production application from its project root', () => {
  const service = read('deploy/act-ii.service.example');
  assert.match(service, /WorkingDirectory=\/srv\/act-ii/);
  assert.match(service, /Environment=NODE_ENV=production/);
  assert.match(service, /Environment=GAME_API_HOST=127\.0\.0\.1/);
  assert.match(service, /ExecStart=.*npm start/);
  assert.match(service, /Restart=on-failure/);
});
