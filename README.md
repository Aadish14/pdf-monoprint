# Laser-Printer Friendly PDF Converter

An air-gapped, client-side web application that prepares PDFs for monochrome laser printing. It converts color diagrams, lecture slides, and dark-themed presentations into clear, ink-efficient documents with distinct grayscale shades, hatch patterns, and outlines.

## Key Capabilities

- **100% Client-Side Processing**: Documents are rendered and compiled entirely inside the browser using PDF.js and jsPDF. Files never leave your local environment.
- **Air-Gapped Offline Operation**: All third-party dependencies are bundled directly in `vendor/`—no external network requests or CDN dependencies are required.
- **Toner Conservation**:
  - *Dark-Mode Inversion*: Inverts slide backgrounds from dark to white while automatically preserving original foreground ink colors for rule matching.
  - *Background Whitening*: Converts tinted, cream, or scanning-artifact backgrounds to pure white with an adjustable luminance threshold.
- **Rule-Based Color Mapping**:
  - Map specific document colors to distinct solid grayscale levels, diagonal stripes, crosshatching, or stipple dot patterns.
  - Automatically add morphological outline borders around targeted fills for high visual contrast on monochrome paper.
  - Auto-detection algorithm scans page palettes into color buckets to quickly identify unique inks.
- **High-Resolution Export**:
  - Export at 150, 200, or 300 DPI with resolution-scaled stroke widths and pattern frequencies.
  - Page range selection with format parsing and deduplication (e.g., `1-4, 7, 10-12`).
  - Optional monochrome legend added as a banner on the first page or as a standalone cover sheet.

## Architecture & Implementation

- **Pixel Processing Engine**: Grayscale, Hue, Saturation, and Value buffers are calculated once upon page load as typed arrays (`Uint8Array`, `Uint16Array`), allowing real-time preview updates during slider adjustments without repeated color space recalculations.
- **Separable Morphological Dilation**: Outline borders are computed via an $O(W \times H)$ two-pass separable sliding-window filter, ensuring fast border rendering independent of stroke thickness.
- **Synchronized Viewport**: Dual canvases feature synchronized panning locks and center-preserving zoom controls from 50% to 300%.

## Getting Started

Because the application contains no compilation or server-side dependencies, you can run it immediately:

1. Clone or download this repository.
2. Open `index.html` in any modern web browser.
3. Select or drag-and-drop a PDF into the workspace.

## License

This project is licensed under the MIT License.
