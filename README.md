# KLIM AI Experience

Experiencia phygital impulsada por inteligencia artificial que transforma una degustacion en una interaccion personalizada, medible y visualmente memorable.

Este proyecto fue desarrollado para que una persona interactue con el producto KLIM mientras el sistema analiza en tiempo real su reaccion emocional a traves de vision por computadora. A partir de esa lectura, la plataforma detecta el momento emocional mas relevante y genera una pieza visual estilizada del usuario mediante IA generativa, lista para descarga por codigo QR y pensada para incentivar recordacion de marca, engagement y difusion en redes sociales.

## Propuesta de valor

- Convierte una degustacion tradicional en una experiencia inmersiva, interactiva y medible.
- Detecta reaccion emocional en tiempo real a partir de landmarks faciales y microexpresiones.
- Personaliza el resultado final con una imagen generada por IA basada en la emocion predominante.
- Integra descarga por QR para extender la experiencia al celular del usuario.
- Combina branding, data, vision por computadora e IA generativa en un solo flujo.

## Que hace la experiencia

El sistema guia al usuario a traves de un recorrido simple e intuitivo:

1. Registro inicial del participante.
2. Activacion de camara y calibracion facial para obtener una linea base.
3. Seguimiento en tiempo real del rostro durante la interaccion con el producto.
4. Deteccion de la emocion predominante en el momento optimo de reaccion.
5. Generacion de un resultado visual estilizado con IA.
6. Publicacion y descarga del resultado mediante codigo QR.

Detras de esa experiencia sencilla hay una arquitectura que coordina captura de video, procesamiento de imagen, analisis facial, almacenamiento de resultados y generacion visual automatizada.

## Componentes tecnicos

- `Frontend web`: interfaz guiada para registro, calibracion, degustacion y entrega del resultado.
- `Vision por computadora`: seguimiento facial, lectura de landmarks y analisis de expresiones en tiempo real.
- `Calibracion inicial`: establece una referencia base del usuario antes de clasificar emociones.
- `Backend Node.js + Express`: expone endpoints para generacion y guardado de resultados.
- `IA generativa`: transforma la foto del usuario en una imagen estilizada usando `Replicate` con `google/gemini-2.5-flash-image`.
- `Firebase`: persistencia de registros, estadisticas y assets finales usados en la experiencia.
- `QR download flow`: entrega del resultado final al usuario en una mecanica lista para compartir.

## Enfoque de experiencia de usuario

Uno de los objetivos principales fue ocultar la complejidad tecnica detras de una interfaz clara, guiada e intuitiva. La experiencia entrega retroalimentacion visual en tiempo real para ayudar al usuario a posicionarse, calibrarse correctamente y avanzar sin friccion. El resultado es una solucion robusta a nivel tecnologico, pero muy natural desde la perspectiva del usuario final.

## Valor academico y aplicado

Ademas de su aplicacion en activaciones de marca y experiencias interactivas, este desarrollo esta siendo documentado en un paper tecnico enfocado en sus fundamentos, arquitectura, implementacion y resultados. Esto le da al proyecto una doble capa de valor: impacto real en experiencias de producto y aporte metodologico para investigacion aplicada en IA, UX y vision por computadora.

## Stack principal

- Node.js
- Express
- JavaScript
- Replicate API
- Google Gemini Flash Image
- Firebase / Firestore
- Firebase Storage
- Face tracking en navegador
- Generacion de QR

## Estructura del proyecto

```text
.
|-- public/     # Interfaz y recursos visuales de la experiencia
|-- scripts/    # Utilidades para analisis y exportacion de datos
|-- server.js   # Backend principal para generacion y guardado
|-- package.json
```

## Requisitos

- Node.js 18 o superior
- Python 3 si vas a usar los scripts de descarga y analitica

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

Modo desarrollo:

```bash
npm run dev
```

Modo normal:

```bash
npm start
```

La aplicacion sirve la experiencia web desde `public/` y utiliza `server.js` para los endpoints de procesamiento y generacion.

## Scripts disponibles

- `npm run dev`: inicia el servidor con `nodemon`
- `npm start`: inicia el servidor en modo normal
- `npm run export:stats`: exporta estadisticas desde Firestore
- `npm run analyze:storage`: analiza archivos de storage y genera reportes
- `npm run download:dataset`: descarga dataset de imagenes para analisis posterior

## Analitica y datos

El proyecto incluye scripts para explotar la informacion recolectada durante la experiencia:

- exportacion de estadisticas agregadas
- analisis de archivos en storage
- descarga de datasets para exploracion o investigacion

La carpeta `exports/` no se versiona porque contiene artefactos generados, imagenes y datasets pesados.

## Casos de uso

- Activaciones de marca
- Experiencias phygital en eventos
- Instalaciones interactivas
- Investigacion aplicada en emocion y comportamiento
- Campanas con alto potencial de contenido compartible

## Estado del proyecto

Proyecto funcional y orientado a experiencia real, con componentes de captura, analisis, generacion visual y explotacion de datos ya integrados.



https://github.com/user-attachments/assets/a7a69c92-6dc6-4044-b6e7-0005a931448a




https://github.com/user-attachments/assets/2e382fa5-dfd7-4575-ac8a-e1d1d592579e





https://github.com/user-attachments/assets/63be10f8-60b5-46fc-ab9b-051f9e365c69


