# Barberia SaaS

SaaS para barberías en Mérida. Este proyecto permite gestionar negocios barbería, citas, agenda administrativa y catálogo de servicios.

## Stack

- Node.js 18+
- Express
- PostgreSQL
- HTML + CSS + JavaScript

## Requisitos

- Node.js 18 o superior
- PostgreSQL configurado y accesible
- Base de datos con conexión disponible por `DATABASE_URL`

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
DATABASE_URL=postgresql://usuario:password@localhost:5432/barberia
ADMIN_PASS=admin123
BARBEROS=Pedro,GGTHEBARBER
```

## Funcionalidades principales

- Registro de negocio
- Agenda de citas por barbero y fecha
- Administración de servicios y precios
- Gestión de horarios
- Panel para administración del negocio
- APIs para consultar info, estilos, productos y citas

## Mejoras aplicadas en esta versión

- Soporte a `.env` sin depender de paquetes externos
- Validación centralizada para slugs, fechas, horas y teléfonos
- `npm test` con pruebas para lógica clave
- Manejo de errores más robusto en Express
- Validación del estado de citas antes de actualizarlo
- Mejor limpieza del `.gitignore` para evitar secretos en el repositorio

## Ejecutar pruebas

```bash
npm test
```

## Estructura relevante

```text
.
├── lib/
│   └── validation.js
├── public/
├── test/
│   └── validation.test.js
├── .env.example
├── .gitignore
├── package.json
├── server.js
└── README.md
```

## Observaciones

- El proyecto usa un esquema inicial con datos de ejemplo para un negocio llamado `onyx`.
- La base de datos se crea automáticamente si no existe.
- El servicio usa cookies/headers de seguridad básicos para reforzar la aplicación.
