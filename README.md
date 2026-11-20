# ASTRQ — Stock Tools Platform · UI

React + Vite + TypeScript dashboard of the platform: the Large Order Radar, sector
heatmap, indicator screener, and the embeddable widgets (`/embed`, `/embed/sectors`).

> Backend and API docs: **astrq-platform-api** · deployment: **infrastructure**.
> Clone the three repos side by side.

## Development

Requirements: Node ≥ 20, and the backend running on `:8000`
(in `../astrq-platform-api`: `make up`, or `./run.sh --demo` for a synthetic market).

```bash
npm install
npm run dev          # http://localhost:5173 — proxies /api, /ws, /health… to :8000
npm run build        # typecheck + production build into dist/
```

Point the dev server at another backend with `ASTRQ_BACKEND=http://host:port npm run dev`.

The UI talks to the API with same-origin relative URLs (`/api/...`, `/ws`); in
production it is served by the backend from the same domain.

## Release

1. Merge to `main` through `develop` → `release` → `main`.
2. Bump `"version"` in `package.json`, then tag that commit on `main`:
   `git tag v0.2.0 && git push origin v0.2.0`.
3. The Release workflow builds `dist/` and attaches `ui-dist.tar.gz` to the GitHub
   Release.
4. In astrq-platform-api, set `ui.version` to the new tag via PR. Merging it to `main`
   builds a new image with this dashboard and deploys it.

## Layout

```
src/
  App.tsx            full dashboard (radar, panels, screener)
  Embed.tsx          /embed — radar widget for iframes
  EmbedSectors.tsx   /embed/sectors — sector heatmap widget
  api.ts             API client + response types
  components/        Radar, Flow, Panels, OrderDetails, Screener
  useLive.ts         WebSocket live updates
```
