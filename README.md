# APEIRON — Instituto de Arquitectura No Euclidiana

Experiencia web inmersiva en WebGL donde la arquitectura se **calcula** en tiempo real.
*Ápeiron* (ἄπειρον) significa «lo ilimitado». Toda la geometría es procedural: no hay modelos, ni imágenes, ni audio pregrabado.

## Las cinco escenas

| # | Escena | Técnica | Interacción |
|---|--------|---------|-------------|
| 01 | **Umbral** — una ciudad paramétrica de miles de monolitos que crece del suelo; la cámara la sobrevuela y atraviesa la palabra APEIRON | Instancing en GPU, shaders de fachada procedurales, tipografía dentro del mundo 3D | El cursor levanta la ciudad como un campo de presión; clic = onda sísmica |
| 02 | **Espacio imposible** — columnata infinita, celosía de Menger y galería helicoidal que se transforman entre sí | *Raymarching* de campos de distancia (SDF) por píxel, mezcla de SDF, AO | Mirar con el cursor; clic = plegar el espacio; mantener = vértigo (*dolly zoom*) |
| 03 | **Transformación** — miles de módulos que se desmontan y reconstruyen en torre helicoidal, hiperboloide de Shukhov, cúpula geodésica y nudo tórico | Morphing en el *vertex shader* con escalonado por altura | Elegir forma, arrastrar para rotar, clic = detonar, mantener = ??? |
| 04 | **Laboratorio** — generador de torres paramétricas | Geometría reconstruida en buffers preasignados, materiales PBR (transmisión, iridiscencia), sombras, ciclo solar | Plantas, torsión, ahusamiento, pulso, despiece, planta, material, hora; `R` = mutar |
| 05 | **Apeiron** — una nebulosa de partículas que se condensa en rascacielos, estalla en palabra y colapsa en el portal de la escena 1 | Partículas en GPU con ruido simplex, viento según velocidad del cursor | Mover = viento, clic = onda de choque |

Las escenas se encadenan con transiciones hechas en un shader de composición (paneles de vidrio que refractan, zoom a través, glitch controlado, frente de combustión). También hay *bloom*, aberración cromática por velocidad de scroll, grano y un modo secreto.

Hay **4 anomalías** escondidas.

## Stack

- [Three.js](https://threejs.org) + GLSL propio (WebGL 2)
- [GSAP](https://gsap.com) + ScrollTrigger para la coreografía DOM
- [Lenis](https://lenis.darkroom.engineering) para el scroll suave
- Web Audio API: banda sonora generativa (drone + filtros + delay)
- Vite + TypeScript

## Ejecutar

```bash
npm install
npm run dev
```

Compilación de producción:

```bash
npm run build
npm run preview
```

Fuerza un nivel de calidad con `?q=low`, `?q=mid` o `?q=high`.

## Estructura

```
src/
  core/      Engine (renderer, render targets, composición), Scroll (Lenis → progreso por escena),
             Pointer (posición, velocidad, gestos), Audio, Quality (niveles por dispositivo)
  gl/        Shader de composición/transiciones, TypePlane (tipografía en 3D), utilidades GLSL
  scenes/    Una clase por escena (EntryScene, ImpossibleScene, TransformScene, LabScene, FinalScene)
  ui/        Cursor, panel del laboratorio, toasts
  styles/    Identidad visual
```

Cada escena implementa la misma interfaz (`init`, `update`, `render`, `resize`, `dispose`). El motor solo actualiza y renderiza las escenas visibles, y precompila todos los shaders durante la carga para que no haya tirones.
