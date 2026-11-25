import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  folderIsFree,
  isAppName,
  isStarterName,
  listStarters,
  nameThePackage,
  removeRepositoryFiles,
  startCommand,
  starterRepoUrl,
} from '../../apps.js';

describe('starterRepoUrl', () => {
  it('names a starter by rule, with no list', () => {
    expect(starterRepoUrl('react')).toBe('https://github.com/ulabase/starter-react.git');
    expect(starterRepoUrl('whatever')).toBe('https://github.com/ulabase/starter-whatever.git');
  });

  it('takes a name, never an address or another owner', () => {
    for (const bad of ['https://github.com/evil/x', 'evil/starter-x', '../x', 'x.git', '', 'React', '-x']) {
      expect(isStarterName(bad)).toBe(false);
      expect(() => starterRepoUrl(bad)).toThrow();
    }
  });
});

describe('isAppName', () => {
  it('is a folder and a package name at once', () => {
    expect(isAppName('shop')).toBe(true);
    expect(isAppName('my-shop_2.0')).toBe(true);
    for (const bad of ['', 'My Shop', '../shop', 'shop/web', '.hidden', 'Shop']) {
      expect(isAppName(bad)).toBe(false);
    }
  });
});

describe('listStarters', () => {
  const answer = (body: unknown, ok = true) => async () => ({ ok, json: async () => body }) as Response;

  it('reads the starters from the public repositories of the organization', async () => {
    const repos = [{ name: 'starter-vue' }, { name: 'kit' }, { name: 'starter-react' }, { name: 'starter-old', archived: true }];
    expect(await listStarters(answer(repos))).toEqual(['react', 'vue']);
  });

  it('answers null when GitHub cannot be asked', async () => {
    expect(await listStarters(answer({}, false))).toBeNull();
    expect(
      await listStarters(async () => {
        throw new Error('offline');
      })
    ).toBeNull();
  });
});

describe('the new folder', () => {
  it('is free when it does not exist or is empty', () => {
    const base = mkdtempSync(join(tmpdir(), 'ulabase-app-'));
    expect(folderIsFree(join(base, 'shop'))).toBe(true);
    mkdirSync(join(base, 'empty'));
    expect(folderIsFree(join(base, 'empty'))).toBe(true);
    writeFileSync(join(base, 'empty', 'file'), '');
    expect(folderIsFree(join(base, 'empty'))).toBe(false);
  });

  it('gets the name of the app in its package.json, and nothing else changes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ulabase-app-'));
    const before = '{\n  "name": "starter-react",\n  "private": true,\n  "scripts": { "dev": "vite" }\n}\n';
    writeFileSync(join(dir, 'package.json'), before);

    expect(nameThePackage(dir, 'shop')).toBe(true);
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(before.replace('starter-react', 'shop'));
    expect(startCommand(dir)).toBe('npm run dev');
  });

  it('loses what belongs to the starter's repository: its CI, its wiki, the pointers to the wiki', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ulabase-app-'));
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(dir, '.github', 'workflows', 'no-service-url.yml'), 'on: push');
    mkdirSync(join(dir, 'openwiki'));
    writeFileSync(join(dir, 'openwiki', 'quickstart.md'), '# wiki');
    const block = '<!-- OPENWIKI:START -->\n\n## OpenWiki\n\n@AGENTS.md\n\n<!-- OPENWIKI:END -->\n';
    writeFileSync(join(dir, 'CLAUDE.md'), block);
    writeFileSync(join(dir, 'AGENTS.md'), `# This app\n\nRun npm test.\n\n${block}`);
    writeFileSync(join(dir, 'README.md'), '# Starter');

    removeRepositoryFiles(dir);

    expect(existsSync(join(dir, '.github'))).toBe(false);
    expect(existsSync(join(dir, 'openwiki'))).toBe(false);
    // nothing but the wiki block: the file goes
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
    // something of the app's own: it stays, without the block
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# This app\n\nRun npm test.\n\n');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('# Starter');
  });

  it('starts an Angular starter with npm start', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ulabase-app-'));
    writeFileSync(join(dir, 'package.json'), '{ "name": "x", "scripts": { "start": "ng serve" } }');
    expect(startCommand(dir)).toBe('npm start');
  });
});
