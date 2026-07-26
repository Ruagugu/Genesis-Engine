/* ============================================================
   创世引擎 · 账号系统（阶段 E）
   用户名+密码，本地存储 data/users.json（gitignore）；
   注册即签发稳定 token（= seat.playerId），登录取回同一 token。
   无 OAuth / 邮箱 / 找回密码（阶段 E §9）。
   ============================================================ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = process.env.GE_USERS_PATH
  ? path.resolve(process.env.GE_USERS_PATH)
  : path.join(root, 'data', 'users.json');

const USERNAME_RE = /^[\w.\-一-龥]{2,24}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 128;

let users = null; // Array<{ username, usernameLower, passSalt, passHash, token, createdAt, lastLoginAt }>

function loadUsers() {
  if (users) return users;
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      users = Array.isArray(parsed.users) ? parsed.users : [];
      return users;
    }
  } catch (err) {
    console.warn('[auth] load failed:', err && err.message);
  }
  users = [];
  return users;
}

function persist() {
  try {
    const dir = path.dirname(STORE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STORE_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ users: loadUsers() }, null, 2), 'utf8');
    fs.renameSync(tmp, STORE_PATH);
  } catch (err) {
    console.warn('[auth] persist failed:', err && err.message);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function newToken() {
  return 'ge_' + crypto.randomBytes(24).toString('hex');
}

function publicUser(user) {
  if (!user) return null;
  return { username: user.username, createdAt: user.createdAt };
}

function validCredsShape(body) {
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');
  if (!USERNAME_RE.test(username)) {
    return { ok: false, status: 400, error: 'invalid_username', message: '用户名须 2～24 位中英文、数字或 ._-' };
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return { ok: false, status: 400, error: 'invalid_password', message: `密码须 ${PASSWORD_MIN}～${PASSWORD_MAX} 位` };
  }
  return { ok: true, username, password };
}

function register(body) {
  const creds = validCredsShape(body);
  if (!creds.ok) return creds;
  const list = loadUsers();
  const lower = creds.username.toLowerCase();
  if (list.some(u => u.usernameLower === lower)) {
    return { ok: false, status: 409, error: 'name_taken', message: '用户名已被注册' };
  }
  const passSalt = crypto.randomBytes(16).toString('hex');
  const user = {
    username: creds.username,
    usernameLower: lower,
    passSalt,
    passHash: hashPassword(creds.password, passSalt),
    token: newToken(),
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  };
  list.push(user);
  persist();
  return { ok: true, status: 201, token: user.token, username: user.username };
}

function login(body) {
  const creds = validCredsShape(body);
  if (!creds.ok) {
    // 不区分「格式错」与「不存在」，统一 401 减少枚举面
    return { ok: false, status: 401, error: 'bad_credentials', message: '用户名或密码错误' };
  }
  const list = loadUsers();
  const user = list.find(u => u.usernameLower === creds.username.toLowerCase());
  if (!user) return { ok: false, status: 401, error: 'bad_credentials', message: '用户名或密码错误' };
  const attempt = Buffer.from(hashPassword(creds.password, user.passSalt), 'hex');
  const stored = Buffer.from(user.passHash, 'hex');
  if (attempt.length !== stored.length || !crypto.timingSafeEqual(attempt, stored)) {
    return { ok: false, status: 401, error: 'bad_credentials', message: '用户名或密码错误' };
  }
  user.lastLoginAt = new Date().toISOString();
  persist();
  return { ok: true, status: 200, token: user.token, username: user.username };
}

/** token → 用户；未注册 token 返回 null */
function userByToken(token) {
  const t = String(token || '').trim();
  if (!t) return null;
  return loadUsers().find(u => u.token === t) || null;
}

/** QA / 测试隔离用 */
function resetStore() {
  users = [];
  try {
    if (fs.existsSync(STORE_PATH)) fs.unlinkSync(STORE_PATH);
  } catch (_) { /* ignore */ }
  return { ok: true, cleared: true };
}

export {
  STORE_PATH,
  USERNAME_RE,
  register,
  login,
  userByToken,
  publicUser,
  resetStore
};
