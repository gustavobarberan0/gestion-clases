# MisClases v4

Sistema de gestión de clases para docentes.
Multi-usuario, seguro, listo para producción.

---

## Correr en local

```
npm install
npm start
```

Abrir http://localhost:3000  
En modo local no hay autenticación (acceso directo).

---

## Subir a Railway

1. Subir a GitHub: https://github.com/new
2. Railway: New Project → Deploy from GitHub
3. Agregar PostgreSQL: + Add → Database → PostgreSQL
4. Agregar variables en el servicio gestion-clases:
   - SESSION_SECRET = (texto largo aleatorio, ej: misclases-2024-xyz-secreto)
5. Railway redespliega automáticamente

---

## Seguridad implementada (triada CID)

### Confidencialidad
- HTTPS forzado en producción (redirect 301)
- Headers de seguridad HTTP via Helmet.js
  - Content-Security-Policy
  - HSTS (HTTP Strict Transport Security)
  - X-Frame-Options, X-XSS-Protection, etc.
- Contraseñas hasheadas con bcrypt (cost factor 12)
- Cookies httpOnly + secure + sameSite
- Nombre de cookie personalizado (no el default 'connect.sid')
- Protección timing attack en login (hash falso para emails inexistentes)

### Integridad
- Queries 100% parametrizadas (sin concatenación de strings SQL)
- Validación de inputs en servidor con express-validator
- Sanitización de todos los campos de texto
- IDs generados con crypto.randomUUID() (no predecibles)
- Regeneración de sesión al hacer login (previene session fixation)
- Datos aislados por usuario_id en PostgreSQL

### Disponibilidad
- Rate limiting global: 300 requests / 15 min por IP
- Rate limiting en auth: 10 intentos / 15 min por IP (anti brute force)
- Rate limiting en uploads: 10 subidas / minuto
- Pool de conexiones PostgreSQL con timeouts configurados
- Backup automático del JSON en modo local
- Error handler global

---

## Importación de alumnos

Formatos soportados: Excel (.xlsx), CSV (.csv), PDF (.pdf), Word (.docx)

Columnas reconocidas automáticamente:
- Nombre / Name / Alumno
- Email / Mail / Correo  
- DNI / Documento
- Nota 1 a Nota 6

Descargar plantilla modelo: GET /api/plantilla-alumnos

Límites: máximo 500 alumnos por importación, archivos hasta 5MB.

---

## Variables de entorno

| Variable       | Descripción                                    | Requerida     |
|----------------|------------------------------------------------|---------------|
| DATABASE_URL   | Conexión PostgreSQL (Railway la agrega sola)   | Sí (hosting)  |
| SESSION_SECRET | Clave para firmar sesiones                     | Sí (hosting)  |
| PORT           | Puerto del servidor                            | No            |

---

## Sistema de usuarios

- Registro libre, cualquier profe puede crear su cuenta
- Primer usuario registrado = administrador automáticamente
- Admin puede ver todos los usuarios, cambiar roles y eliminar cuentas
- Cada profe ve y gestiona únicamente sus propias clases
