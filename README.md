# Irodori

Irodori is a browser-based flag and image recoloring tool. It extracts the dominant colors in an uploaded image (including SVGs), lets you regroup or override them, and applies cleanup/upscaling so you can download a polished PNG or SVG for use in games like NationStates or anywhere else you need a tidy palette.

## Quick start

```bash
npm install
npm run dev
```

Then open the printed local URL (typically http://localhost:5173) in your browser.

For a production build:

```bash
npm run build
```

## How to use

1. **Upload an image**: PNG/JPG or SVG. The app auto-detects colors and groups the most significant ones.
2. **Adjust the palette**:
   - Toggle groups on/off, merge or split colors, or add manual layers.
   - Click a swatch to pick a new source color; click the target swatch to recolor it.
   - Drag colors between groups to reorganize them.
3. **Tweak quality**: Optional controls for denoising, edge protection, smoothing, and scaling (NationStates-friendly sizes for raster images). SVGs keep their vector resolution and skip post-processing.
4. **Process & export**: Press **Apply** to recolor. When finished, download a PNG (raster) or SVG (vector) version with the updated palette.

## Notes

- Recoloring can be disabled if you only want cleanup/upscaling on raster images.
- SVG uploads bypass filters and scaling to preserve vector fidelity.
- The default presets limit the palette to the most significant colors so results stay clean; you can recompute groups after changing anchor colors.
