/* 在 Node 中加载浏览器侧 data.world.js / snapshot.js，得到可序列化世界数据。 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadScript(sandbox, rel) {
  const file = path.join(root, rel);
  const code = fs.readFileSync(file, 'utf8');
  vm.runInContext(code, sandbox, { filename: rel });
}

export function loadGeData() {
  const sandbox = {
    window: {},
    console,
    // snapshot.js 在 Node 侧 hydrate 用不到 location；提供最小桩
    location: { search: '' },
    localStorage: {
      getItem() { return null; },
      setItem() {},
      removeItem() {}
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  loadScript(sandbox, 'js/data.world.js');
  loadScript(sandbox, 'js/snapshot.js');
  if (!sandbox.GE || !sandbox.GE.data) {
    throw new Error('load-ge-data: GE.data missing after evaluating scripts');
  }
  return {
    GE: sandbox.GE,
    data: sandbox.GE.data,
    buildSnapshot(options) {
      return sandbox.GE.snapshot.buildFromData(sandbox.GE.data, options || {
        runId: 'local-seed',
        generatedAt: new Date().toISOString()
      });
    }
  };
}

export { root };
