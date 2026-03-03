const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const ConnectPgSimple = require('connect-pg-simple');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const USE_PG = !!process.env.DATABASE_URL;

// ── Pool PostgreSQL ─────────────────────────────────────────────────────────────
let pool = null;
if (USE_PG) {
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  console.log('Modo: PostgreSQL');
} else {
  console.log('Modo: JSON local (sin autenticacion multi-usuario)');
}

// ── Sesiones ────────────────────────────────────────────────────────────────────
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'misclases-secret-local-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
};

if (USE_PG) {
  const PgSession = ConnectPgSimple(session);
  sessionConfig.store = new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true });
  if (process.env.NODE_ENV === 'production') sessionConfig.cookie.secure = true;
}

app.use(express.json());
app.use(session(sessionConfig));

// ── Init tablas ─────────────────────────────────────────────────────────────────
async function initDB() {
  if (!USE_PG) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'profe',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS clases (
      id TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      data JSONB NOT NULL
    );
  `);
  console.log('Tablas listas');
}

// ── Middleware auth ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.rol !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
  next();
}

// ── Helpers PG ─────────────────────────────────────────────────────────────────
async function pgLoadClases(userId, isAdmin) {
  let res;
  if (isAdmin) {
    res = await pool.query(`
      SELECT c.data, u.nombre as profe_nombre, u.email as profe_email
      FROM clases c JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY u.nombre, c.data->>'nombre'
    `);
    return res.rows.map(r => ({ ...r.data, _profe: r.profe_nombre, _profe_email: r.profe_email }));
  } else {
    res = await pool.query('SELECT data FROM clases WHERE usuario_id = $1 ORDER BY data->>\'nombre\'', [userId]);
    return res.rows.map(r => r.data);
  }
}

async function pgSaveClase(clase, userId) {
  await pool.query(
    'INSERT INTO clases (id, usuario_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = $3',
    [clase.id, userId, JSON.stringify(clase)]
  );
}

async function pgGetClase(claseId, userId, isAdmin) {
  let res;
  if (isAdmin) {
    res = await pool.query('SELECT data, usuario_id FROM clases WHERE id = $1', [claseId]);
  } else {
    res = await pool.query('SELECT data, usuario_id FROM clases WHERE id = $1 AND usuario_id = $2', [claseId, userId]);
  }
  if (!res.rows.length) throw new Error('Not found');
  return { clase: res.rows[0].data, ownerId: res.rows[0].usuario_id };
}

async function pgUpdateClase(claseId, userId, isAdmin, updateFn) {
  const { clase, ownerId } = await pgGetClase(claseId, userId, isAdmin);
  const updated = updateFn(clase);
  await pool.query('UPDATE clases SET data = $1 WHERE id = $2', [JSON.stringify(updated), claseId]);
  return updated;
}

// ── JSON local helpers ──────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const BACKUP_FILE = path.join(DATA_DIR, 'data.backup.json');

function loadJSON() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { try { return JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf8')); } catch { return { clases: [] }; } }
}
function saveJSON(data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, BACKUP_FILE);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── Static files (SPA) ─────────────────────────────────────────────────────────
// Serve login/register pages without auth
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH ROUTES ─────────────────────────────────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
  if (!USE_PG) return res.json({ ok: true, msg: 'Modo local, sin auth' });
  const { nombre, email, password } = req.body;
  if (!nombre || !email || !password) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  try {
    const exists = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(400).json({ error: 'El email ya esta registrado' });
    const count = await pool.query('SELECT COUNT(*) FROM usuarios');
    const isFirst = parseInt(count.rows[0].count) === 0;
    const hash = await bcrypt.hash(password, 10);
    const id = Date.now().toString();
    const rol = isFirst ? 'admin' : 'profe';
    await pool.query('INSERT INTO usuarios (id, nombre, email, password, rol) VALUES ($1,$2,$3,$4,$5)',
      [id, nombre.trim(), email.toLowerCase().trim(), hash, rol]);
    req.session.userId = id;
    req.session.nombre = nombre.trim();
    req.session.rol = rol;
    res.json({ ok: true, nombre: nombre.trim(), rol });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  if (!USE_PG) return res.json({ ok: true, nombre: 'Local', rol: 'admin' });
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email.toLowerCase()]);
    if (!result.rows.length) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    req.session.userId = user.id;
    req.session.nombre = user.nombre;
    req.session.rol = user.rol;
    res.json({ ok: true, nombre: user.nombre, rol: user.rol });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Me (check session)
app.get('/api/auth/me', (req, res) => {
  if (!USE_PG) return res.json({ ok: true, nombre: 'Local', rol: 'admin', localMode: true });
  if (!req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  res.json({ ok: true, nombre: req.session.nombre, rol: req.session.rol });
});

// ── ADMIN ROUTES ────────────────────────────────────────────────────────────────

// Get all users (admin)
app.get('/api/admin/usuarios', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.created_at,
        COUNT(c.id) as total_clases
      FROM usuarios u LEFT JOIN clases c ON u.id = c.usuario_id
      GROUP BY u.id ORDER BY u.created_at
    `);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Change user role (admin)
app.put('/api/admin/usuarios/:id/rol', requireAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE usuarios SET rol = $1 WHERE id = $2', [req.body.rol, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete user (admin)
app.delete('/api/admin/usuarios/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DATA ROUTES ─────────────────────────────────────────────────────────────────

app.get('/api/data', requireAuth, async (req, res) => {
  try {
    if (!USE_PG) return res.json(loadJSON());
    const isAdmin = req.session.rol === 'admin';
    const clases = await pgLoadClases(req.session.userId, isAdmin);
    res.json({ clases });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clases', requireAuth, async (req, res) => {
  try {
    const clase = { id: Date.now().toString(), ...req.body, alumnos: [], sesiones: [] };
    if (USE_PG) {
      await pgSaveClase(clase, req.session.userId);
    } else {
      const data = loadJSON(); data.clases.push(clase); saveJSON(data);
    }
    res.json(clase);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clases/:id', requireAuth, async (req, res) => {
  try {
    if (USE_PG) {
      const updated = await pgUpdateClase(req.params.id, req.session.userId, req.session.rol === 'admin',
        c => ({ ...c, ...req.body }));
      res.json(updated);
    } else {
      const data = loadJSON();
      const idx = data.clases.findIndex(c => c.id === req.params.id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      data.clases[idx] = { ...data.clases[idx], ...req.body };
      saveJSON(data); res.json(data.clases[idx]);
    }
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:id', requireAuth, async (req, res) => {
  try {
    if (USE_PG) {
      await pgGetClase(req.params.id, req.session.userId, req.session.rol === 'admin');
      await pool.query('DELETE FROM clases WHERE id = $1', [req.params.id]);
    } else {
      const data = loadJSON();
      data.clases = data.clases.filter(c => c.id !== req.params.id);
      saveJSON(data);
    }
    res.json({ ok: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:id/alumnos', requireAuth, async (req, res) => {
  try {
    const alumno = { id: Date.now().toString(), asistencias: 0, ...req.body };
    if (USE_PG) {
      await pgUpdateClase(req.params.id, req.session.userId, req.session.rol === 'admin',
        c => { c.alumnos.push(alumno); return c; });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.id);
      if (!clase) return res.status(404).json({ error: 'Not found' });
      clase.alumnos.push(alumno); saveJSON(data);
    }
    res.json(alumno);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.put('/api/clases/:cId/alumnos/:aId', requireAuth, async (req, res) => {
  try {
    let updated;
    if (USE_PG) {
      await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol === 'admin', c => {
        const idx = c.alumnos.findIndex(a => a.id === req.params.aId);
        if (idx === -1) throw new Error('Not found');
        c.alumnos[idx] = { ...c.alumnos[idx], ...req.body }; updated = c.alumnos[idx]; return c;
      });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.cId);
      const idx = clase && clase.alumnos.findIndex(a => a.id === req.params.aId);
      if (!clase || idx === -1) return res.status(404).json({ error: 'Not found' });
      clase.alumnos[idx] = { ...clase.alumnos[idx], ...req.body }; updated = clase.alumnos[idx]; saveJSON(data);
    }
    res.json(updated);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:cId/alumnos/:aId', requireAuth, async (req, res) => {
  try {
    if (USE_PG) {
      await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol === 'admin',
        c => { c.alumnos = c.alumnos.filter(a => a.id !== req.params.aId); return c; });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.cId);
      if (!clase) return res.status(404).json({ error: 'Not found' });
      clase.alumnos = clase.alumnos.filter(a => a.id !== req.params.aId); saveJSON(data);
    }
    res.json({ ok: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:id/sesiones', requireAuth, async (req, res) => {
  try {
    const sesion = { id: Date.now().toString(), fecha: new Date().toISOString().split('T')[0], ...req.body };
    if (USE_PG) {
      await pgUpdateClase(req.params.id, req.session.userId, req.session.rol === 'admin',
        c => { c.sesiones.push(sesion); return c; });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.id);
      if (!clase) return res.status(404).json({ error: 'Not found' });
      clase.sesiones.push(sesion); saveJSON(data);
    }
    res.json(sesion);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:cId/sesiones/:sId', requireAuth, async (req, res) => {
  try {
    if (USE_PG) {
      await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol === 'admin',
        c => { c.sesiones = c.sesiones.filter(s => s.id !== req.params.sId); return c; });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.cId);
      if (!clase) return res.status(404).json({ error: 'Not found' });
      clase.sesiones = clase.sesiones.filter(s => s.id !== req.params.sId); saveJSON(data);
    }
    res.json({ ok: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:cId/sesiones/:sId/asistencia', requireAuth, async (req, res) => {
  try {
    if (USE_PG) {
      await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol === 'admin', c => {
        const ses = c.sesiones.find(s => s.id === req.params.sId);
        if (!ses) throw new Error('Not found');
        ses.asistencia = req.body.asistencia;
        c.alumnos.forEach(a => {
          let cnt = 0;
          c.sesiones.forEach(s => { if (s.asistencia && s.asistencia[a.id] === true) cnt++; });
          a.asistencias = cnt;
        });
        return c;
      });
    } else {
      const data = loadJSON();
      const clase = data.clases.find(c => c.id === req.params.cId);
      const ses = clase && clase.sesiones.find(s => s.id === req.params.sId);
      if (!ses) return res.status(404).json({ error: 'Not found' });
      ses.asistencia = req.body.asistencia;
      clase.alumnos.forEach(a => {
        let cnt = 0;
        clase.sesiones.forEach(s => { if (s.asistencia && s.asistencia[a.id] === true) cnt++; });
        a.asistencias = cnt;
      });
      saveJSON(data);
    }
    res.json({ ok: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ── Start ───────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('\n=====================================');
    console.log('  MisClases v3 en puerto ' + PORT);
    if (!USE_PG) console.log('  Abre: http://localhost:' + PORT);
    console.log('=====================================\n');
  });
}).catch(err => { console.error('Error:', err); process.exit(1); });
