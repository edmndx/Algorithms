# Algorithm JavaScript Visualizer

A local-first web application for visualizing algorithms and data-structure problems commonly encountered on LeetCode and similar coding platforms.

Supported JavaScript code is instrumented into execution traces and replayed step by step as interactive D3.js and SVG visualizations.

**Live website:** [edmndx.github.io/Algorithms](https://edmndx.github.io/Algorithms/)

https://github.com/user-attachments/assets/cbb5d68b-888e-491e-bf28-0e52c365a7e6

## Features

- Step-by-step algorithm visualization
- Monaco JavaScript editor
- Automatic source instrumentation
- Play, pause, step, seek, reset, and speed controls
- Active source-line highlighting
- Trace import and export
- Zoom and pan
- Web Worker execution

## Supported Structures

`Arrays` · `Matrices` · `Linked Lists` · `Trees` · `Graphs`

## Built With

`React` · `TypeScript` · `D3.js` · `SVG` · `Monaco Editor` · `Web Workers` · `Comlink` · `Zod` · `Vite`

## Installation

Requires Node.js 24 and npm 11 or newer.

```bash
git clone https://github.com/edmndx/Algorithms.git
cd Algorithms
npm ci
npm run dev
npm run build
```

## Deployment

GitHub Actions builds and deploys the website to [GitHub Pages](https://edmndx.github.io/Algorithms/) on every push to `main`. You can also run the **Deploy to GitHub Pages** workflow manually from the repository's Actions tab.

The workflow publishes `dist/`. Vite's base path is `/Algorithms/` so assets and Web Workers load correctly from the project URL.
