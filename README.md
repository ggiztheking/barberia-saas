# Barberia SaaS

SaaS para barberías en Mérida. Este proyecto permite gestionar negocios barbería, citas, agenda administrativa y catálogo de servicios.

## Stack

- Node.js 18+
- Express
- PostgreSQL
- HTML + CSS + JavaScript
- JWT para administración
- Helmet + rate limiting para seguridad

## Requisitos

- Node.js 18 o superior
- PostgreSQL configurado y accesible
- Base de datos accesible por `DATABASE_URL`

## Instalación

1. Clona el repositorio.
2. Instala dependencias:

```bash
npm install
```

3. Crea un archivo `.env` basado en `.env.example`.
4. Inicia la aplicación:

```bash
npm start
```

## Variables de entorno

Crea un archivo `.env` con este contenido:

```env
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://usuario:password@localhost:5432/barberia
ADMIN_PASS=admin123
JWT_SECRET=cambia-esto-en-produccion
JWT_EXPIRES_IN=12h
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=200
```

## Funcionalidades principales

- Registro de negocio
- Agenda de citas por barbero y fecha
- Administración de servicios y precios
- Gestión de horarios
- Panel de administración con JWT
- APIs para consultar info, estilos, productos y citas
- Endpoint de salud para monitoreo

## Mejoras aplicadas en esta versión

- Soporte a `.env` sin depender de paquetes externos
- Validación centralizada para slugs, fechas, horas y teléfonos
- JWT para administración real
- Seguridad con Helmet y rate limiting
- Logging con Pino
- Manejo de errores más robusto
- Healthcheck de base de datos
- Pruebas básicas para lógica clave
- Preparación para uso real y despliegue

## Ejecutar pruebas

```bash
npm test
```

## Login administrativo

Para acceder al panel del negocio, puedes usar el endpoint:

```bash
POST /api/:slug/admin/login
Content-Type: application/json

{
  "password": "admin123"
}
```

La respuesta devuelve un JWT que debes enviar en el header:

```http
Authorization: Bearer <token>
```

## Estructura relevante

```text
.
├── lib/
│   ├── auth.js
│   ├── config.js
│   ├── logger.js
│   └── validation.js
├── public/
├── test/
│   └── validation.test.js
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── package.json
├── server.js
└── .dockerignore
```

## Despliegue con Docker

```bash
docker build -t barberia-saas .
docker run -p 3000:3000 --env-file .env barberia-saas
```

## Observaciones

- El proyecto usa un esquema inicial con datos de ejemplo para un negocio llamado `onyx`.
- La base de datos se crea automáticamente si no existe.
- En producción, `JWT_SECRET` y `ADMIN_PASS` deben ser secrets reales.
