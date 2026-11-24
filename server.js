/**
 * Aurora Trades - Shared Backend (multi-device)
 * Zero npm dependencies - Node.js built-in only
 * Deploy: node server.js  (or on Render: node server/server.js)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = __dirname; // flat layout: HTML next to server.js
const REF_REWARD = 850;
const WHATSAPP = '2348162314640';

const VIP = [
  { level: 1, price: 6500, daily: 932, name: 'VIP 1' },
  { level: 2, price: 8500, daily: 1800, name: 'VIP 2' },
  { level: 3, price: 12000, daily: 2500, name: 'VIP 3' },
  { level: 4, price: 15000, daily: 3200, name: 'VIP 4' }
];

function loadDB() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  const db = { users: [], transactions: [], withdrawals: [], referrals: [], announcements: [], completedTasks: [] };
  saveDB(db);
  return db;
}
function saveDB(db) { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function hash(pw) { return crypto.createHash('sha256').update(pw).digest('hex'); }
function uid(p) { return (p || 'id') + '_' + crypto.randomBytes(6).toString('hex'); }
function today() { return new Date().toISOString().slice(0, 10); }
function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}
function parseBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
  });
}
function safeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function ensureAdmin(db) {
  if (!db.users.some(u => u.role === 'admin')) {
    db.users.push({
      id: 'admin_main', phone: '08000000001', name: 'Control Admin',
      password: hash('control2026'), balance: 0, totalEarnings: 0, todayEarnings: 0,
      completedTasks: 0, vipLevel: 4, referralCode: 'ADMIN', referredBy: null,
      bank: {}, role: 'admin', status: 'active', lastTaskDate: null, tasksToday: 0,
      createdAt: new Date().toISOString(), lastActive: null, hideBalance: false
    });
    saveDB(db);
  }
}
function resetDaily(u) {
  if (u.lastTaskDate !== today()) { u.lastTaskDate = today(); u.tasksToday = 0; u.todayEarnings = 0; }
}
function vipDaily(level) {
  const v = VIP.find(x => x.level === level);
  return v ? v.daily : 0;
}
function payReferral(db, userId) {
  const ref = db.referrals.find(r => r.referredId === userId && !r.credited);
  if (!ref) return null;
  const referrer = db.users.find(x => x.id === ref.referrerId);
  if (!referrer) return null;
  ref.credited = true; ref.reward = REF_REWARD; ref.status = 'paid';
  referrer.balance += REF_REWARD; referrer.totalEarnings += REF_REWARD;
  db.transactions.push({ id: uid('tx'), userId: referrer.id, type: 'referral_bonus', amount: REF_REWARD, status: 'success', date: new Date().toISOString(), ref: 'RF-' + Date.now() });
  return referrer.name;
}

async function handleAPI(req, res, pathname) {
  const db = loadDB();
  ensureAdmin(db);
  const method = req.method;

  if (pathname === '/api/health') return send(res, 200, { ok: true, users: db.users.filter(u => u.role === 'user').length });

  // REGISTER
  if (pathname === '/api/register' && method === 'POST') {
    const body = await parseBody(req);
    const { name, phone, password, referralCode } = body;
    if (!name || !phone || !password || String(phone).length !== 11 || String(password).length < 6)
      return send(res, 400, { error: 'Invalid input' });
    if (db.users.some(u => u.phone === phone)) return send(res, 400, { error: 'Phone already registered' });
    const user = {
      id: uid('u'), phone, name, password: hash(password),
      balance: 750, totalEarnings: 750, todayEarnings: 0, completedTasks: 0, vipLevel: 0,
      referralCode: 'AT-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      referredBy: null, bank: { provider: '', account: '', name: '' },
      role: 'user', status: 'active', lastTaskDate: null, tasksToday: 0,
      createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), hideBalance: false
    };
    if (referralCode) {
      const r = db.users.find(u => u.referralCode === String(referralCode).toUpperCase());
      if (r) {
        user.referredBy = r.id;
        db.referrals.push({ id: uid('ref'), referrerId: r.id, referredId: user.id, referredName: user.name, referredPhone: user.phone, reward: 0, status: 'registered', date: new Date().toISOString(), credited: false });
      }
    }
    db.users.push(user);
    db.transactions.push({ id: uid('tx'), userId: user.id, type: 'welcome_bonus', amount: 750, status: 'success', date: new Date().toISOString(), ref: 'WB-' + Date.now() });
    saveDB(db);
    return send(res, 200, { user: safeUser(user) });
  }

  // LOGIN
  if (pathname === '/api/login' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.phone === body.phone);
    if (!user || user.password !== hash(body.password || '')) return send(res, 401, { error: 'Incorrect phone or password' });
    if (user.status === 'suspended') return send(res, 403, { error: 'Account suspended' });
    user.lastActive = new Date().toISOString();
    saveDB(db);
    return send(res, 200, { user: safeUser(user) });
  }

  // GET USER
  if (pathname.startsWith('/api/user/') && method === 'GET') {
    const id = pathname.split('/')[3];
    const user = db.users.find(u => u.id === id);
    if (!user) return send(res, 404, { error: 'User not found' });
    resetDaily(user);
    user.lastActive = new Date().toISOString();
    saveDB(db);
    return send(res, 200, { user: safeUser(user) });
  }

  // TOUCH ONLINE
  if (pathname === '/api/touch' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.id === body.userId);
    if (user) { user.lastActive = new Date().toISOString(); saveDB(db); }
    return send(res, 200, { ok: true });
  }

  // SUBMIT TASK (pending approval)
  if (pathname === '/api/checkin' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.id === body.userId);
    if (!user) return send(res, 404, { error: 'User not found' });
    if (user.vipLevel === 0) return send(res, 403, { error: 'VIP required' });
    resetDaily(user);
    if (user.tasksToday >= 1) return send(res, 400, { error: 'Already completed today' });
    const reward = vipDaily(user.vipLevel);
    user.tasksToday = 1;
    user.lastTaskDate = today();
    user.completedTasks = (user.completedTasks || 0) + 1;
    const task = { id: uid('ct'), userId: user.id, userName: user.name, userPhone: user.phone, reward, vipLevel: user.vipLevel, date: new Date().toISOString(), status: 'pending_approval' };
    if (!db.completedTasks) db.completedTasks = [];
    db.completedTasks.push(task);
    saveDB(db);
    return send(res, 200, { user: safeUser(user), task });
  }

  // WITHDRAW
  if (pathname === '/api/withdraw' && method === 'POST') {
    const body = await parseBody(req);
    const { userId, amount, provider, account, name } = body;
    const user = db.users.find(u => u.id === userId);
    if (!user) return send(res, 404, { error: 'User not found' });
    if (user.vipLevel === 0) return send(res, 403, { error: 'VIP required' });
    if (!amount || amount < 10 || amount > user.balance) return send(res, 400, { error: 'Invalid amount' });
    user.balance -= amount;
    user.bank = { provider, account, name };
    const wdId = uid('wd');
    const now = new Date().toISOString();
    db.withdrawals.push({ id: wdId, userId, amount, provider, account, name, status: 'pending', date: now, ref: 'WD-' + Date.now() });
    db.transactions.push({ id: uid('tx'), userId, type: 'withdrawal', amount: -amount, status: 'pending', date: now, ref: 'WD-' + Date.now(), meta: { withdrawalId: wdId } });
    saveDB(db);
    return send(res, 200, { user: safeUser(user), withdrawalId: wdId });
  }

  // PASSWORD
  if (pathname === '/api/password' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.id === body.userId);
    if (!user || user.password !== hash(body.oldPassword || '')) return send(res, 400, { error: 'Wrong current password' });
    if (!body.newPassword || body.newPassword.length < 6) return send(res, 400, { error: 'Password too short' });
    user.password = hash(body.newPassword);
    saveDB(db);
    return send(res, 200, { ok: true });
  }

  // TRANSACTIONS / WITHDRAWALS / ANNOUNCEMENTS / REFERRALS for user
  if (pathname.startsWith('/api/transactions/') && method === 'GET') {
    const userId = pathname.split('/')[3];
    const txs = db.transactions.filter(t => t.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
    return send(res, 200, { transactions: txs });
  }
  if (pathname.startsWith('/api/withdrawals/') && method === 'GET') {
    const userId = pathname.split('/')[3];
    const list = db.withdrawals.filter(w => w.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
    return send(res, 200, { withdrawals: list });
  }
  if (pathname === '/api/announcements' && method === 'GET') {
    return send(res, 200, { announcements: (db.announcements || []).slice().reverse().slice(0, 20) });
  }
  if (pathname.startsWith('/api/referrals/') && method === 'GET') {
    const userId = pathname.split('/')[3];
    const refs = db.referrals.filter(r => r.referrerId === userId);
    return send(res, 200, { referrals: refs });
  }

  // ===== ADMIN =====
  if (pathname === '/api/admin/stats' && method === 'GET') {
    const users = db.users.filter(u => u.role === 'user');
    const online = users.filter(u => u.lastActive && (Date.now() - new Date(u.lastActive).getTime()) < 120000).length;
    return send(res, 200, {
      totalUsers: users.length,
      online,
      pendingTasks: (db.completedTasks || []).filter(t => t.status === 'pending_approval').length,
      pendingWithdrawals: db.withdrawals.filter(w => w.status === 'pending').length,
      vipUsers: users.filter(u => u.vipLevel > 0).length,
      totalBalances: users.reduce((s, u) => s + u.balance, 0)
    });
  }
  if (pathname === '/api/admin/users' && method === 'GET') {
    return send(res, 200, { users: db.users.filter(u => u.role === 'user').map(safeUser) });
  }
  if (pathname === '/api/admin/pending' && method === 'GET') {
    return send(res, 200, { pending: db.withdrawals.filter(w => w.status === 'pending') });
  }
  if (pathname === '/api/admin/pending-tasks' && method === 'GET') {
    return send(res, 200, { tasks: (db.completedTasks || []).filter(t => t.status === 'pending_approval') });
  }
  if (pathname === '/api/admin/completed-tasks' && method === 'GET') {
    return send(res, 200, { tasks: (db.completedTasks || []).slice().reverse().slice(0, 50) });
  }
  if (pathname === '/api/admin/referrals' && method === 'GET') {
    return send(res, 200, { referrals: (db.referrals || []).slice().reverse() });
  }
  if (pathname === '/api/admin/set-vip' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.phone === body.phone && u.role === 'user');
    if (!user) return send(res, 404, { error: 'User not found' });
    const wasZero = user.vipLevel === 0;
    user.vipLevel = parseInt(body.level) || 0;
    let referralPaid = null;
    if (user.vipLevel > 0 && wasZero) referralPaid = payReferral(db, user.id);
    saveDB(db);
    return send(res, 200, { ok: true, name: user.name, vipLevel: user.vipLevel, referralPaid });
  }
  if (pathname === '/api/admin/approve-task' && method === 'POST') {
    const body = await parseBody(req);
    const t = (db.completedTasks || []).find(x => x.id === body.id);
    if (!t || t.status !== 'pending_approval') return send(res, 400, { error: 'Not found or already processed' });
    const user = db.users.find(u => u.id === t.userId);
    if (!user) return send(res, 404, { error: 'User not found' });
    t.status = 'approved';
    user.balance += t.reward;
    user.totalEarnings += t.reward;
    user.todayEarnings = (user.todayEarnings || 0) + t.reward;
    db.transactions.push({ id: uid('tx'), userId: user.id, type: 'task_reward', amount: t.reward, status: 'success', date: new Date().toISOString(), ref: 'RW-' + Date.now() });
    saveDB(db);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/reject-task' && method === 'POST') {
    const body = await parseBody(req);
    const t = (db.completedTasks || []).find(x => x.id === body.id);
    if (!t || t.status !== 'pending_approval') return send(res, 400, { error: 'Not found or already processed' });
    t.status = 'rejected';
    saveDB(db);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/withdrawal-action' && method === 'POST') {
    const body = await parseBody(req);
    const w = db.withdrawals.find(x => x.id === body.id);
    if (!w || w.status !== 'pending') return send(res, 400, { error: 'Not found or already processed' });
    const tx = db.transactions.find(t => t.meta && t.meta.withdrawalId === body.id);
    if (body.action === 'approve') { w.status = 'completed'; if (tx) tx.status = 'success'; }
    else {
      w.status = 'rejected'; if (tx) tx.status = 'rejected';
      const user = db.users.find(u => u.id === w.userId);
      if (user) user.balance += w.amount;
    }
    saveDB(db);
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/toggle-status' && method === 'POST') {
    const body = await parseBody(req);
    const user = db.users.find(u => u.id === body.userId);
    if (!user) return send(res, 404, { error: 'Not found' });
    user.status = user.status === 'active' ? 'suspended' : 'active';
    saveDB(db);
    return send(res, 200, { ok: true, status: user.status });
  }
  if (pathname === '/api/admin/announce' && method === 'POST') {
    const body = await parseBody(req);
    if (!body.text) return send(res, 400, { error: 'Empty' });
    if (!db.announcements) db.announcements = [];
    db.announcements.push({ text: body.text, date: new Date().toISOString() });
    if (db.announcements.length > 30) db.announcements = db.announcements.slice(-30);
    saveDB(db);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  if (pathname.startsWith('/api/')) return handleAPI(req, res, pathname);

  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log('Aurora Trades multi-device server on port ' + PORT);
});
