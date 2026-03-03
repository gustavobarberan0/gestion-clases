# MisClases v3

Sistema de gestion de clases para docentes con login, multi-usuario y panel admin.

---

## Correr en local

```
npm install
npm start
```

Abrir http://localhost:3000
En modo local no hay autenticacion (acceso directo).

---

## Subir a Railway

### 1. Subir a GitHub
- Crear repo en https://github.com/new y subir todos los archivos

### 2. Crear proyecto en Railway
- railway.app -> New Project -> Deploy from GitHub repo

### 3. Agregar PostgreSQL
- En el proyecto: + New -> Database -> PostgreSQL
- Railway agrega DATABASE_URL automaticamente

### 4. Agregar variable de sesion (importante para seguridad)
- En Railway: Variables -> New Variable
  - Nombre: SESSION_SECRET
  - Valor: (cualquier texto largo y aleatorio, ej: "misclases-2024-xyz-abc-secreto")

### 5. Listo
Railway despliega automaticamente y te da una URL publica.

---

## Sistema de usuarios

- **Registro libre**: cualquier profe puede crear su cuenta
- **Primer usuario = admin**: el primero en registrarse queda como administrador
- **Admin puede**:
  - Ver todos los profes registrados
  - Promover/quitar rol de admin a otros
  - Eliminar usuarios
- **Cada profe** ve y gestiona solo sus propias clases

---

## Variables de entorno

| Variable | Descripcion | Requerida |
|---|---|---|
| DATABASE_URL | Conexion PostgreSQL (Railway la agrega sola) | Si (en hosting) |
| SESSION_SECRET | Clave para firmar sesiones | Si (en hosting) |
| PORT | Puerto del servidor | No (Railway lo maneja) |
