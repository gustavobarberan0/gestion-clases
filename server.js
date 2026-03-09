/**
 * MisClases v4 — Servidor principal
 * Seguridad: Helmet, Rate Limiting, Validación, SQL parametrizado, HTTPS forzado
 */

'use strict';

const express      = require('express');
const path         = require('path');
const { Pool }     = require('pg');
const bcrypt       = require('bcryptjs');
const session      = require('express-session');
const ConnectPg    = require('connect-pg-simple');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const cookieParser = require('cookie-parser');
const fs           = require('fs');
const crypto       = require('crypto');

const app     = express();
const PORT    = process.env.PORT || 3000;
const USE_PG  = !!process.env.DATABASE_URL;
const IS_PROD = !!process.env.DATABASE_URL;

// ── Pool PostgreSQL ────────────────────────────────────────────────────────────
let pool = null;
if (USE_PG) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', (err) => console.error('DB pool error:', err.message));
  console.log('Modo: PostgreSQL');
} else {
  console.log('Modo: JSON local');
}

// ── Trust proxy (Railway usa HTTPS via proxy) ──────────────────────────────────
app.set('trust proxy', 1);

// ── Helmet — headers de seguridad HTTP ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:    ["'self'"],
      scriptSrc:     ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],  // permite onclick= en elementos HTML
      styleSrc:      ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      fontSrc:       ["'self'", "https://fonts.gstatic.com"],
      imgSrc:        ["'self'", "data:"],
      connectSrc:    ["'self'"],
    },
  },
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

// Forzar HTTPS en producción
if (IS_PROD) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, 'https://' + req.headers.host + req.url);
    }
    next();
  });
}

// ── Rate limiting ──────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá en 15 minutos' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, intentá en 15 minutos' },
});

app.use(globalLimiter);

// ── Sesiones ───────────────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'mc_sid',
  cookie: {
    maxAge:   7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure:   IS_PROD,
  },
};

if (USE_PG) {
  const PgSession = ConnectPg(session);
  sessionConfig.store = new PgSession({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  });
}

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(session(sessionConfig));


// ── Init tablas ────────────────────────────────────────────────────────────────
async function initDB() {
  if (!USE_PG) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id                   TEXT PRIMARY KEY,
      nombre               TEXT NOT NULL,
      email                TEXT UNIQUE NOT NULL,
      password             TEXT NOT NULL,
      rol                  TEXT NOT NULL DEFAULT 'profe',
      terminos_aceptados   BOOLEAN NOT NULL DEFAULT FALSE,
      terminos_fecha       TIMESTAMPTZ,
      terminos_version     TEXT DEFAULT '1.0',
      created_at           TIMESTAMPTZ DEFAULT NOW()
    );
    -- Agregar columnas si ya existe la tabla (migracion segura)
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS terminos_aceptados BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS terminos_fecha TIMESTAMPTZ;
    ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS terminos_version TEXT DEFAULT '1.0';
    CREATE TABLE IF NOT EXISTS clases (
      id         TEXT PRIMARY KEY,
      usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      data       JSONB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_clases_usuario ON clases(usuario_id);
  `);
  console.log('Tablas listas');
}

// ── Middleware auth ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  if (req.session.rol !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
  next();
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function sanitizeStr(str) {
  if (typeof str !== 'string') return '';
  return str.trim().substring(0, 500);
}
function validarResultado(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ error: errors.array()[0].msg }); return false; }
  return true;
}

// ── Helpers PG ─────────────────────────────────────────────────────────────────
async function pgLoadClases(userId, isAdmin) {
  let res;
  if (isAdmin) {
    res = await pool.query(`
      SELECT c.data, u.nombre AS profe_nombre, u.email AS profe_email
      FROM clases c JOIN usuarios u ON c.usuario_id = u.id
      ORDER BY u.nombre, c.data->>'nombre'
    `);
    return res.rows.map(r => ({ ...r.data, _profe: r.profe_nombre, _profe_email: r.profe_email }));
  }
  res = await pool.query(`SELECT data FROM clases WHERE usuario_id = $1 ORDER BY data->>'nombre'`, [userId]);
  return res.rows.map(r => r.data);
}
async function pgSaveClase(clase, userId) {
  await pool.query(
    `INSERT INTO clases (id, usuario_id, data) VALUES ($1,$2,$3) ON CONFLICT (id) DO UPDATE SET data=$3`,
    [clase.id, userId, JSON.stringify(clase)]
  );
}
async function pgGetClase(claseId, userId, isAdmin) {
  const res = isAdmin
    ? await pool.query(`SELECT data, usuario_id FROM clases WHERE id=$1`, [claseId])
    : await pool.query(`SELECT data, usuario_id FROM clases WHERE id=$1 AND usuario_id=$2`, [claseId, userId]);
  if (!res.rows.length) throw new Error('Not found');
  return { clase: res.rows[0].data, ownerId: res.rows[0].usuario_id };
}
async function pgUpdateClase(claseId, userId, isAdmin, updateFn) {
  const { clase } = await pgGetClase(claseId, userId, isAdmin);
  const updated = updateFn(clase);
  await pool.query(`UPDATE clases SET data=$1 WHERE id=$2`, [JSON.stringify(updated), claseId]);
  return updated;
}

// ── JSON local ─────────────────────────────────────────────────────────────────
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









// ── Static ─────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Health ─────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, version: '4.0.0' }));

// ── AUTH ───────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', authLimiter, [
  body('nombre').trim().isLength({ min:2, max:100 }).withMessage('Nombre debe tener entre 2 y 100 caracteres'),
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min:6, max:100 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('terminos_aceptados').equals('true').withMessage('Debés aceptar los Términos y Condiciones'),
], async (req, res) => {
  if (!USE_PG) return res.json({ ok:true, nombre:'Local', rol:'admin' });
  if (!validarResultado(req, res)) return;
  const { nombre, email, password } = req.body;
  try {
    const exists = await pool.query('SELECT id FROM usuarios WHERE email=$1', [email]);
    if (exists.rows.length) return res.status(400).json({ error: 'El email ya está registrado' });
    const count   = await pool.query('SELECT COUNT(*) FROM usuarios');
    const isFirst = parseInt(count.rows[0].count) === 0;
    const hash    = await bcrypt.hash(password, 12);
    const id      = crypto.randomUUID();
    const rol     = isFirst ? 'admin' : 'profe';
    const terminosFecha = new Date().toISOString();
    await pool.query(
      'INSERT INTO usuarios (id,nombre,email,password,rol,terminos_aceptados,terminos_fecha,terminos_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, nombre, email, hash, rol, true, terminosFecha, '1.0']
    );
    req.session.userId = id; req.session.nombre = nombre; req.session.rol = rol;
    res.json({ ok:true, nombre, rol });
  } catch(e) { console.error(e.message); res.status(500).json({ error: 'Error al registrar' }); }
});

app.post('/api/auth/login', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Email inválido'),
  body('password').isLength({ min:1 }).withMessage('Contraseña requerida'),
], async (req, res) => {
  if (!USE_PG) return res.json({ ok:true, nombre:'Local', rol:'admin' });
  if (!validarResultado(req, res)) return;
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE email=$1', [email]);
    const user   = result.rows[0];
    const fakeH  = '$2a$12$fakehashfakehashfakehashfakehashfakehashfakeha';
    const valid  = user ? await bcrypt.compare(password, user.password) : await bcrypt.compare(password, fakeH);
    if (!user || !valid) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Error de sesión' });
      req.session.userId = user.id; req.session.nombre = user.nombre; req.session.rol = user.rol;
      res.json({ ok:true, nombre: user.nombre, rol: user.rol });
    });
  } catch(e) { console.error(e.message); res.status(500).json({ error: 'Error al ingresar' }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.clearCookie('mc_sid'); res.json({ ok:true }); });
});

app.get('/api/auth/me', (req, res) => {
  if (!USE_PG) return res.json({ ok:true, nombre:'Local', rol:'admin', localMode:true });
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'No autenticado' });
  res.json({ ok:true, nombre: req.session.nombre, rol: req.session.rol });
});

// ── ADMIN ──────────────────────────────────────────────────────────────────────
app.get('/api/admin/usuarios', requireAdmin, async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT u.id, u.nombre, u.email, u.rol, u.created_at, u.terminos_aceptados, u.terminos_fecha, u.terminos_version, COUNT(c.id) AS total_clases
      FROM usuarios u LEFT JOIN clases c ON u.id = c.usuario_id
      GROUP BY u.id ORDER BY u.created_at
    `);
    res.json(r.rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/admin/usuarios/:id/rol', requireAdmin, [
  body('rol').isIn(['admin','profe']).withMessage('Rol inválido'),
], async (req, res) => {
  if (!validarResultado(req, res)) return;
  try { await pool.query('UPDATE usuarios SET rol=$1 WHERE id=$2', [req.body.rol, req.params.id]); res.json({ ok:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/admin/usuarios/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.session.userId) return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
  try { await pool.query('DELETE FROM usuarios WHERE id=$1', [req.params.id]); res.json({ ok:true }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DATA ROUTES ────────────────────────────────────────────────────────────────
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    if (!USE_PG) return res.json(loadJSON());
    const clases = await pgLoadClases(req.session.userId, req.session.rol === 'admin');
    res.json({ clases });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/clases', requireAuth, [
  body('nombre').trim().isLength({ min:1, max:200 }).withMessage('Nombre requerido'),
], async (req, res) => {
  if (!validarResultado(req, res)) return;
  try {
    const clase = { id: crypto.randomUUID(), ...req.body, alumnos:[], sesiones:[] };
    if (USE_PG) await pgSaveClase(clase, req.session.userId);
    else { const d = loadJSON(); d.clases.push(clase); saveJSON(d); }
    res.json(clase);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/clases/:id', requireAuth, async (req, res) => {
  try {
    if (USE_PG) { res.json(await pgUpdateClase(req.params.id, req.session.userId, req.session.rol==='admin', c=>({...c,...req.body}))); }
    else {
      const d = loadJSON(); const idx = d.clases.findIndex(c=>c.id===req.params.id);
      if (idx===-1) return res.status(404).json({ error:'Not found' });
      d.clases[idx] = {...d.clases[idx],...req.body}; saveJSON(d); res.json(d.clases[idx]);
    }
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:id', requireAuth, async (req, res) => {
  try {
    if (USE_PG) { await pgGetClase(req.params.id, req.session.userId, req.session.rol==='admin'); await pool.query('DELETE FROM clases WHERE id=$1',[req.params.id]); }
    else { const d = loadJSON(); d.clases = d.clases.filter(c=>c.id!==req.params.id); saveJSON(d); }
    res.json({ ok:true });
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:id/alumnos', requireAuth, [
  body('nombre').trim().isLength({ min:1, max:200 }).withMessage('Nombre requerido'),
], async (req, res) => {
  if (!validarResultado(req, res)) return;
  try {
    const alumno = { id: crypto.randomUUID(), asistencias:0, ...req.body };
    if (USE_PG) await pgUpdateClase(req.params.id, req.session.userId, req.session.rol==='admin', c=>{c.alumnos.push(alumno);return c;});
    else { const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.id); if(!c) return res.status(404).json({error:'Not found'}); c.alumnos.push(alumno); saveJSON(d); }
    res.json(alumno);
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.put('/api/clases/:cId/alumnos/:aId', requireAuth, async (req, res) => {
  try {
    let updated;
    if (USE_PG) {
      await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol==='admin', c=>{
        const idx = c.alumnos.findIndex(a=>a.id===req.params.aId);
        if(idx===-1) throw new Error('Not found');
        c.alumnos[idx]={...c.alumnos[idx],...req.body}; updated=c.alumnos[idx]; return c;
      });
    } else {
      const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.cId);
      const idx=c&&c.alumnos.findIndex(a=>a.id===req.params.aId);
      if(!c||idx===-1) return res.status(404).json({error:'Not found'});
      c.alumnos[idx]={...c.alumnos[idx],...req.body}; updated=c.alumnos[idx]; saveJSON(d);
    }
    res.json(updated);
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:cId/alumnos/:aId', requireAuth, async (req, res) => {
  try {
    if (USE_PG) await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol==='admin', c=>{c.alumnos=c.alumnos.filter(a=>a.id!==req.params.aId);return c;});
    else { const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.cId); if(!c) return res.status(404).json({error:'Not found'}); c.alumnos=c.alumnos.filter(a=>a.id!==req.params.aId); saveJSON(d); }
    res.json({ ok:true });
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:id/sesiones', requireAuth, async (req, res) => {
  try {
    const sesion = { id: crypto.randomUUID(), fecha: new Date().toISOString().split('T')[0], ...req.body };
    if (USE_PG) await pgUpdateClase(req.params.id, req.session.userId, req.session.rol==='admin', c=>{c.sesiones.push(sesion);return c;});
    else { const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.id); if(!c) return res.status(404).json({error:'Not found'}); c.sesiones.push(sesion); saveJSON(d); }
    res.json(sesion);
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/clases/:cId/sesiones/:sId', requireAuth, async (req, res) => {
  try {
    if (USE_PG) await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol==='admin', c=>{c.sesiones=c.sesiones.filter(s=>s.id!==req.params.sId);return c;});
    else { const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.cId); if(!c) return res.status(404).json({error:'Not found'}); c.sesiones=c.sesiones.filter(s=>s.id!==req.params.sId); saveJSON(d); }
    res.json({ ok:true });
  } catch(e) { res.status(404).json({ error: e.message }); }
});

app.post('/api/clases/:cId/sesiones/:sId/asistencia', requireAuth, async (req, res) => {
  try {
    const updater = c => {
      const ses = c.sesiones.find(s=>s.id===req.params.sId);
      if (!ses) throw new Error('Not found');
      ses.asistencia = req.body.asistencia;
      c.alumnos.forEach(a => { let cnt=0; c.sesiones.forEach(s=>{if(s.asistencia&&s.asistencia[a.id]===true)cnt++;}); a.asistencias=cnt; });
      return c;
    };
    if (USE_PG) await pgUpdateClase(req.params.cId, req.session.userId, req.session.rol==='admin', updater);
    else { const d=loadJSON(); const c=d.clases.find(c=>c.id===req.params.cId); if(!c) return res.status(404).json({error:'Not found'}); updater(c); saveJSON(d); }
    res.json({ ok:true });
  } catch(e) { res.status(404).json({ error: e.message }); }
});

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera los 5MB' });
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ── Start ──────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log('\n=====================================');
    console.log('  MisClases v4 en puerto ' + PORT);
    if (!USE_PG) console.log('  Abre: http://localhost:' + PORT);
    console.log('=====================================\n');
  });
}).catch(err => { console.error('Error init:', err); process.exit(1); });
