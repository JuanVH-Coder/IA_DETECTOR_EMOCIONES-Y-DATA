# IA Detector Emociones y Data

Servidor Node.js para el flujo de filtros IA de KLIM, con frontend estatico en `public/` y scripts de analisis/exportacion de datos.

## Requisitos

- Node.js 18 o superior
- Python 3 si vas a usar el script de descarga de dataset

## Instalacion

```bash
npm install
```

## Variables de entorno

Crea un archivo `.env` basado en `.env.example`:

```env
REPLICATE_API_TOKEN=tu_token
PORT=3001
```

## Ejecutar en local

```bash
npm run dev
```

o

```bash
npm start
```

## Scripts utiles

- `npm run export:stats`: exporta estadisticas
- `npm run analyze:storage`: analiza archivos de storage
- `npm run download:dataset`: descarga dataset usando Python

## Nota sobre archivos exportados

La carpeta `exports/` no se versiona porque contiene artefactos generados y datasets pesados.
