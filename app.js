"use strict";

/**
 * Laser-Printer Friendly PDF Converter
 * Client-side PDF processor for monochrome printing and toner optimization.
 */

// Initialize PDF.js worker reference
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
}

const CONFIG = Object.freeze({
  previewScale: 1.6,
  minZoom: 0.5,
  maxZoom: 3.0,
  zoomStep: 0.25,
  debounceDelayMs: 180,
});

const PALETTES = Object.freeze({
  basicColors: [
    { name: "Red", hex: "#d92626" },
    { name: "Blue", hex: "#1d4ed8" },
    { name: "Green", hex: "#16a34a" },
    { name: "Orange", hex: "#ea580c" },
    { name: "Yellow", hex: "#eab308" },
    { name: "Purple", hex: "#9333ea" },
    { name: "Cyan", hex: "#06b6d4" },
    { name: "Pink", hex: "#ec4899" },
    { name: "Brown", hex: "#854d0e" },
    { name: "Black", hex: "#141414" },
  ],
  normalPresets: [
    { id: "light_border", label: "Light Gray + Dark Border", fillShade: 215, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: true, borderShade: 0, borderWidth: 2 },
    { id: "medium_gray", label: "Medium Gray (Solid)", fillShade: 120, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: false, borderShade: 0, borderWidth: 1 },
    { id: "light_gray", label: "Light Gray (Solid)", fillShade: 185, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: false, borderShade: 0, borderWidth: 1 },
    { id: "hollow_thick", label: "Hollow White + Thick Border", fillShade: 250, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: true, borderShade: 0, borderWidth: 3 },
    { id: "mid_border", label: "Medium Gray + Dark Border", fillShade: 150, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: true, borderShade: 0, borderWidth: 2 },
    { id: "dark_gray", label: "Dark Gray (Solid)", fillShade: 65, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: false, borderShade: 0, borderWidth: 1 },
    { id: "solid_black", label: "Solid Black", fillShade: 0, pattern: "solid", patternShade: 0, patternSpacing: 6, borderEnabled: false, borderShade: 0, borderWidth: 1 },
  ],
  patternPresets: [
    { id: "stripes_bdr", label: "Diagonal Stripes + Border", fillShade: 245, pattern: "stripes", patternShade: 0, patternSpacing: 6, borderEnabled: true, borderShade: 0, borderWidth: 1 },
    { id: "stripes_clean", label: "Diagonal Stripes (No Border)", fillShade: 245, pattern: "stripes", patternShade: 0, patternSpacing: 6, borderEnabled: false, borderShade: 0, borderWidth: 1 },
    { id: "crosshatch_bdr", label: "Crosshatch + Border", fillShade: 245, pattern: "crosshatch", patternShade: 0, patternSpacing: 7, borderEnabled: true, borderShade: 0, borderWidth: 1 },
    { id: "crosshatch_clean", label: "Crosshatch (No Border)", fillShade: 245, pattern: "crosshatch", patternShade: 0, patternSpacing: 7, borderEnabled: false, borderShade: 0, borderWidth: 1 },
    { id: "dots_bdr", label: "Stipple Dots + Border", fillShade: 245, pattern: "dots", patternShade: 0, patternSpacing: 5, borderEnabled: true, borderShade: 0, borderWidth: 1 },
    { id: "dots_clean", label: "Stipple Dots (No Border)", fillShade: 245, pattern: "dots", patternShade: 0, patternSpacing: 5, borderEnabled: false, borderShade: 0, borderWidth: 1 },
  ],
});

const DEFAULT_STYLE_CYCLE = Object.freeze([
  PALETTES.normalPresets[0],
  PALETTES.normalPresets[1],
  PALETTES.patternPresets[0],
  PALETTES.patternPresets[2],
  PALETTES.patternPresets[4],
  PALETTES.normalPresets[3],
]);

/**
 * Application State
 */
const state = {
  pdfDoc: null,
  currentPage: 1,
  uploadedFileName: "document.pdf",
  rules: [],
  nextRuleId: 1,
  ruleMode: "basic",
  zoomLevel: 1.0,
  toner: {
    darkModeInvert: false,
    bgWhitenEnabled: false,
    bgWhitenThreshold: 215,
  },
  cachedBuffers: null,
  debounceTimer: null,
  scrollSyncLock: null,
};

/**
 * Color Utilities Module
 */
const ColorUtils = {
  rgbToHsv(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;

    if (d !== 0) {
      if (max === r) {
        h = ((g - b) / d) % 6;
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else {
        h = (r - g) / d + 4;
      }
      h = Math.round(h * 60);
      if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : Math.round((d * 100) / max);
    const v = Math.round((max * 100) / 255);
    return { h, s, v };
  },

  rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
  },

  hexToRgb(hex) {
    const cleanHex = hex.replace(/^#/, "");
    const num = parseInt(cleanHex, 16);
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
  },

  describeColorName(hex) {
    const exact = PALETTES.basicColors.find((c) => c.hex.toLowerCase() === hex.toLowerCase());
    if (exact) return exact.name;

    const [r, g, b] = this.hexToRgb(hex);
    const { h, s, v } = this.rgbToHsv(r, g, b);

    if (v < 15) return "Black";
    if (s < 14) {
      if (v > 85) return "Light Gray";
      if (v > 45) return "Gray";
      return "Dark Gray";
    }

    const isDark = v < 52;
    const isLight = s < 42 && v > 78;

    let base;
    if (h < 15 || h >= 345) base = isLight ? "Pink" : "Red";
    else if (h < 40) base = isDark ? "Brown" : "Orange";
    else if (h < 68) base = isDark ? "Olive" : "Yellow";
    else if (h < 155) base = "Green";
    else if (h < 195) base = isDark ? "Teal" : "Cyan";
    else if (h < 250) base = isDark ? "Navy Blue" : isLight ? "Sky Blue" : "Blue";
    else if (h < 295) base = "Purple";
    else base = isLight ? "Pink" : "Magenta";

    if (isDark && !["Brown", "Olive", "Teal", "Navy Blue"].includes(base)) {
      return `Dark ${base}`;
    }
    return base;
  },

  describeRuleStyle(rule) {
    const patternNames = {
      solid: rule.fillShade < 40 ? "Solid Black" : rule.fillShade < 100 ? "Dark Gray" : rule.fillShade < 170 ? "Medium Gray" : rule.fillShade < 235 ? "Light Gray" : "Hollow White",
      stripes: "Diagonal Stripes",
      crosshatch: "Crosshatch",
      dots: "Stipple Dots",
    };
    const base = patternNames[rule.pattern] || "Solid";
    return rule.borderEnabled ? `${base} + Border` : base;
  },
};

/**
 * Image Processing Engine
 */
const ImageEngine = {
  buildPixelBuffers(srcImageData) {
    const { width, height, data } = srcImageData;
    const totalPixels = width * height;
    const gray = new Uint8Array(totalPixels);
    const h = new Uint16Array(totalPixels);
    const s = new Uint8Array(totalPixels);
    const v = new Uint8Array(totalPixels);

    for (let i = 0, p = 0; p < totalPixels; p++, i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      gray[p] = (77 * r + 150 * g + 29 * b) >> 8;

      const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
      const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
      const d = max - min;

      v[p] = Math.round((max * 100) / 255);
      s[p] = max === 0 ? 0 : Math.round((d * 100) / max);

      if (d === 0) {
        h[p] = 0;
      } else {
        let hue;
        if (max === r) hue = ((g - b) / d) % 6;
        else if (max === g) hue = (b - r) / d + 2;
        else hue = (r - g) / d + 4;
        hue = Math.round(hue * 60);
        h[p] = hue < 0 ? hue + 360 : hue;
      }
    }

    return { width, height, totalPixels, data, gray, h, s, v };
  },

  dilateMask(mask, width, height, radius) {
    if (radius <= 0) return mask;
    const temp = new Uint8Array(width * height);
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      const row = y * width;
      let count = 0;
      const initEnd = Math.min(radius, width - 1);
      for (let x = 0; x <= initEnd; x++) count += mask[row + x];
      for (let x = 0; x < width; x++) {
        if (count > 0) temp[row + x] = 1;
        if (x - radius >= 0) count -= mask[row + x - radius];
        if (x + radius + 1 < width) count += mask[row + x + radius + 1];
      }
    }

    for (let x = 0; x < width; x++) {
      let count = 0;
      const initEnd = Math.min(radius, height - 1);
      for (let y = 0; y <= initEnd; y++) count += temp[y * width + x];
      for (let y = 0; y < height; y++) {
        if (count > 0) out[y * width + x] = 1;
        if (y - radius >= 0) count -= temp[(y - radius) * width + x];
        if (y + radius + 1 < height) count += temp[(y + radius + 1) * width + x];
      }
    }

    return out;
  },

  getPatternPixelShade(rule, x, y, spacing, stroke, dotSize) {
    if (rule.pattern === "solid") return rule.fillShade;

    if (rule.pattern === "stripes") {
      return (x + y) % spacing < stroke ? rule.patternShade : rule.fillShade;
    }

    if (rule.pattern === "crosshatch") {
      const d1 = (x + y) % spacing;
      const d2 = ((x - y) % spacing + spacing) % spacing;
      return d1 < stroke || d2 < stroke ? rule.patternShade : rule.fillShade;
    }

    if (rule.pattern === "dots") {
      const rowBlock = Math.floor(y / spacing);
      const shift = (rowBlock & 1) ? (spacing >> 1) : 0;
      const gx = (x + shift) % spacing;
      const gy = y % spacing;
      return gx < dotSize && gy < dotSize ? rule.patternShade : rule.fillShade;
    }

    return rule.fillShade;
  },

  processBuffers(buffers, rules, toner, scaleFactor = 1) {
    const { width, height, totalPixels, data, gray, h, s, v } = buffers;
    const outGray = new Uint8Array(totalPixels);

    const invert = toner.darkModeInvert;
    const whiten = toner.bgWhitenEnabled;
    const whiteCutoff = toner.bgWhitenThreshold;

    for (let p = 0; p < totalPixels; p++) {
      let val = invert ? 255 - gray[p] : gray[p];
      if (whiten && val >= whiteCutoff) {
        val = 255;
      }
      outGray[p] = val;
    }

    if (rules.length === 0) {
      const result = new ImageData(width, height);
      const rd = result.data;
      for (let i = 0, p = 0; p < totalPixels; p++, i += 4) {
        const val = outGray[p];
        rd[i] = val;
        rd[i + 1] = val;
        rd[i + 2] = val;
        rd[i + 3] = 255;
      }
      return result;
    }

    // Competitive rule assignment: determine the closest matching rule for each pixel
    const pixelRuleIndex = new Int16Array(totalPixels);
    pixelRuleIndex.fill(-1);
    const pixelBestDist = new Float32Array(totalPixels);
    pixelBestDist.fill(999999);

    rules.forEach((rule, idx) => {
      const [tr, tg, tb] = ColorUtils.hexToRgb(rule.sourceHex);
      const targetHsv = ColorUtils.rgbToHsv(tr, tg, tb);
      const isNeutral = targetHsv.s < 15 || targetHsv.v < 15;

      if (isNeutral) {
        const maxDistSq = Math.pow(rule.tolerance * 1.8, 2);
        for (let p = 0; p < totalPixels; p++) {
          if (s[p] < 20 || v[p] < 20) {
            const i = p * 4;
            const dr = data[i] - tr;
            const dg = data[i + 1] - tg;
            const db = data[i + 2] - tb;
            const dSq = dr * dr + dg * dg + db * db;
            if (dSq <= maxDistSq) {
              const normDist = dSq / maxDistSq;
              if (normDist < pixelBestDist[p]) {
                pixelBestDist[p] = normDist;
                pixelRuleIndex[p] = idx;
              }
            }
          }
        }
      } else {
        const th = targetHsv.h;
        const ts = targetHsv.s;
        const tv = targetHsv.v;
        const maxH = Math.max(7, rule.tolerance * 0.35);
        const maxS = Math.max(15, rule.tolerance * 0.9);
        const maxV = Math.max(15, rule.tolerance * 0.75);

        const invH = 1 / maxH;
        const invS = 1 / maxS;
        const invV = 1 / maxV;

        for (let p = 0; p < totalPixels; p++) {
          if (s[p] > 12 && v[p] > 8) {
            let dh = Math.abs(h[p] - th);
            if (dh > 180) dh = 360 - dh;
            if (dh <= maxH) {
              const ds = Math.abs(s[p] - ts);
              if (ds <= maxS) {
                const dv = Math.abs(v[p] - tv);
                if (dv <= maxV) {
                  const nh = dh * invH;
                  const ns = ds * invS;
                  const nv = dv * invV;
                  const normDist = nh * nh + ns * ns + nv * nv;
                  if (normDist < pixelBestDist[p]) {
                    pixelBestDist[p] = normDist;
                    pixelRuleIndex[p] = idx;
                  }
                }
              }
            }
          }
        }
      }
    });

    rules.forEach((rule, idx) => {
      if (rule.borderEnabled) {
        const mask = new Uint8Array(totalPixels);
        for (let p = 0; p < totalPixels; p++) {
          if (pixelRuleIndex[p] === idx) mask[p] = 1;
        }
        const radius = Math.max(1, Math.round(rule.borderWidth * scaleFactor));
        const dilated = this.dilateMask(mask, width, height, radius);
        const bShade = rule.borderShade;
        for (let p = 0; p < totalPixels; p++) {
          if (dilated[p] && pixelRuleIndex[p] !== idx) {
            outGray[p] = bShade;
          }
        }
      }

      if (rule.pattern === "solid") {
        const fShade = rule.fillShade;
        for (let p = 0; p < totalPixels; p++) {
          if (pixelRuleIndex[p] === idx) {
            outGray[p] = fShade;
          }
        }
      } else {
        const spacing = Math.max(3, Math.round(rule.patternSpacing * scaleFactor));
        const stroke = Math.max(1, Math.round(1.1 * scaleFactor));
        const dotSize = Math.max(1, Math.round(1.6 * scaleFactor));

        for (let y = 0; y < height; y++) {
          const rowOffset = y * width;
          for (let x = 0; x < width; x++) {
            const p = rowOffset + x;
            if (pixelRuleIndex[p] === idx) {
              outGray[p] = this.getPatternPixelShade(rule, x, y, spacing, stroke, dotSize);
            }
          }
        }
      }
    });

    const result = new ImageData(width, height);
    const rd = result.data;
    for (let i = 0, p = 0; p < totalPixels; p++, i += 4) {
      const val = outGray[p];
      rd[i] = val;
      rd[i + 1] = val;
      rd[i + 2] = val;
      rd[i + 3] = 255;
    }
    return result;
  },

  drawRuleSwatch(ctx, x, y, width, height, rule, scaleFactor) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iw = Math.max(4, Math.round(width));
    const ih = Math.max(4, Math.round(height));
    const imgData = ctx.createImageData(iw, ih);
    const d = imgData.data;

    const spacing = Math.max(3, Math.round(rule.patternSpacing * scaleFactor));
    const stroke = Math.max(1, Math.round(1.1 * scaleFactor));
    const dotSize = Math.max(1, Math.round(1.6 * scaleFactor));
    const bw = rule.borderEnabled ? Math.max(1, Math.round(rule.borderWidth * scaleFactor)) : 0;

    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        let shade;
        if (bw > 0 && (px < bw || py < bw || px >= iw - bw || py >= ih - bw)) {
          shade = rule.borderShade;
        } else if (!rule.borderEnabled && (px === 0 || py === 0 || px === iw - 1 || py === ih - 1)) {
          shade = 160;
        } else {
          shade = this.getPatternPixelShade(rule, px, py, spacing, stroke, dotSize);
        }

        const idx = (py * iw + px) * 4;
        d[idx] = shade;
        d[idx + 1] = shade;
        d[idx + 2] = shade;
        d[idx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, ix, iy);
  },
};

/**
 * PDF Export Engine
 */
const PdfExportEngine = {
  parsePageRange(rawInput, totalPages) {
    const trimmed = (rawInput || "").trim();
    if (!trimmed) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }

    const pages = [];
    const seen = new Set();
    const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);

    if (tokens.length === 0) {
      throw new Error("Page range is empty or invalid.");
    }

    for (const token of tokens) {
      if (/^\d+$/.test(token)) {
        const p = Number(token);
        if (p < 1 || p > totalPages) {
          throw new Error(`Page ${p} is out of bounds (1-${totalPages}).`);
        }
        if (!seen.has(p)) {
          seen.add(p);
          pages.push(p);
        }
      } else if (/^\d+\s*-\s*\d+$/.test(token)) {
        const [startStr, endStr] = token.split("-");
        const start = Number(startStr.trim());
        const end = Number(endStr.trim());
        if (start < 1 || end < 1 || start > totalPages || end > totalPages) {
          throw new Error(`Range "${token}" is out of bounds (1-${totalPages}).`);
        }
        if (start > end) {
          throw new Error(`Invalid range "${token}": start page exceeds end page.`);
        }
        for (let p = start; p <= end; p++) {
          if (!seen.has(p)) {
            seen.add(p);
            pages.push(p);
          }
        }
      } else {
        throw new Error(`Invalid range token "${token}". Use formats such as "1-5, 8, 12".`);
      }
    }

    return pages;
  },

  createLegendCoverPage(widthPx, heightPx, scaleFactor, fileName, rules) {
    const canvas = document.createElement("canvas");
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);

    const pad = Math.round(widthPx * 0.07);
    const titleSize = Math.round(widthPx * 0.032);
    const subSize = Math.round(widthPx * 0.017);
    const labelSize = Math.round(widthPx * 0.018);
    const metaSize = Math.round(widthPx * 0.0145);

    ctx.fillStyle = "#000000";
    ctx.font = `700 ${titleSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText("Color-to-Monochrome Print Legend", pad, pad + titleSize);

    ctx.fillStyle = "#333333";
    ctx.font = `400 ${subSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(`Document: ${fileName}`, pad, pad + titleSize + Math.round(subSize * 1.7));

    const dividerY = pad + titleSize + Math.round(subSize * 2.6);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(2, Math.round(2 * scaleFactor));
    ctx.beginPath();
    ctx.moveTo(pad, dividerY);
    ctx.lineTo(widthPx - pad, dividerY);
    ctx.stroke();

    const cols = rules.length > 6 ? 2 : 1;
    const colGap = Math.round(widthPx * 0.04);
    const colWidth = Math.floor((widthPx - pad * 2 - colGap * (cols - 1)) / cols);
    const rowHeight = Math.round(Math.min(heightPx * 0.085, (heightPx - dividerY - pad * 1.5) / Math.ceil(rules.length / cols)));
    const swatchW = Math.round(colWidth * 0.28);
    const swatchH = Math.round(rowHeight * 0.56);

    rules.forEach((rule, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = pad + col * (colWidth + colGap);
      const y = dividerY + Math.round(pad * 0.5) + row * rowHeight;

      ImageEngine.drawRuleSwatch(ctx, x, y + Math.round((rowHeight - swatchH) / 2), swatchW, swatchH, rule, scaleFactor);

      const textX = x + swatchW + Math.round(colWidth * 0.05);
      const colorName = ColorUtils.describeColorName(rule.sourceHex);
      const styleDesc = ColorUtils.describeRuleStyle(rule);

      ctx.fillStyle = "#000000";
      ctx.font = `700 ${labelSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(`${colorName} (${rule.sourceHex.toUpperCase()})`, textX, y + Math.round(rowHeight * 0.44));

      ctx.fillStyle = "#333333";
      ctx.font = `400 ${metaSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(`Prints as: ${styleDesc}`, textX, y + Math.round(rowHeight * 0.74));
    });

    return canvas;
  },

  composeFirstPageWithBanner(pageCanvas, scaleFactor, rules) {
    const widthPx = pageCanvas.width;
    const heightPx = pageCanvas.height;

    const padX = Math.round(widthPx * 0.025);
    const padY = Math.round(heightPx * 0.012);
    const headerFont = Math.max(12, Math.round(widthPx * 0.016));
    const itemFont = Math.max(11, Math.round(widthPx * 0.0135));
    const swatchW = Math.round(widthPx * 0.045);
    const swatchH = Math.round(itemFont * 1.45);

    const cols = Math.min(4, Math.max(2, rules.length));
    const rows = Math.ceil(rules.length / cols);
    const rowH = Math.round(swatchH * 1.55);
    const bannerHeight = padY * 2 + Math.round(headerFont * 1.6) + rows * rowH + Math.round(padY * 0.6);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = widthPx;
    outCanvas.height = heightPx;
    const ctx = outCanvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, widthPx, heightPx);

    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(padX, padY, widthPx - padX * 2, bannerHeight - padY);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = Math.max(1.5, Math.round(1.5 * scaleFactor));
    ctx.strokeRect(padX, padY, widthPx - padX * 2, bannerHeight - padY);

    ctx.fillStyle = "#000000";
    ctx.font = `700 ${headerFont}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText("Print Legend (Original Color \u2192 Monochrome Key)", padX + Math.round(padX * 0.5), padY + Math.round(headerFont * 1.35));

    const innerX = padX + Math.round(padX * 0.5);
    const innerW = widthPx - padX * 3;
    const colW = Math.floor(innerW / cols);
    const startY = padY + Math.round(headerFont * 1.85);

    rules.forEach((rule, idx) => {
      const c = idx % cols;
      const r = Math.floor(idx / cols);
      const x = innerX + c * colW;
      const y = startY + r * rowH;

      ImageEngine.drawRuleSwatch(ctx, x, y + Math.round((rowH - swatchH) / 2), swatchW, swatchH, rule, scaleFactor);

      const textX = x + swatchW + Math.round(widthPx * 0.009);
      const colorName = ColorUtils.describeColorName(rule.sourceHex);
      const styleDesc = ColorUtils.describeRuleStyle(rule);

      ctx.fillStyle = "#000000";
      ctx.font = `700 ${itemFont}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(colorName, textX, y + Math.round(rowH * 0.45));

      ctx.fillStyle = "#333333";
      ctx.font = `400 ${Math.round(itemFont * 0.86)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(styleDesc, textX, y + Math.round(rowH * 0.8));
    });

    const availTop = bannerHeight + Math.round(padY * 0.6);
    const availH = Math.max(10, heightPx - availTop);
    const fitScale = Math.min(1, availH / heightPx);
    const drawW = Math.round(widthPx * fitScale);
    const drawH = Math.round(heightPx * fitScale);
    const drawX = Math.round((widthPx - drawW) / 2);

    ctx.drawImage(pageCanvas, 0, 0, widthPx, heightPx, drawX, availTop, drawW, drawH);
    return outCanvas;
  },
};

/**
 * UI Controller Module
 */
const AppController = {
  dom: {},

  init() {
    this.cacheElements();
    this.bindEvents();
    this.renderPaletteChips();
  },

  cacheElements() {
    this.dom = {
      pdfUpload: document.getElementById("pdfUpload"),
      dropZone: document.getElementById("dropZone"),
      fileNameDisplay: document.getElementById("fileNameDisplay"),
      globalDropOverlay: document.getElementById("globalDropOverlay"),
      darkModeInvertCheckbox: document.getElementById("darkModeInvertCheckbox"),
      bgWhitenCheckbox: document.getElementById("bgWhitenCheckbox"),
      bgWhitenControls: document.getElementById("bgWhitenControls"),
      bgWhitenSlider: document.getElementById("bgWhitenSlider"),
      bgWhitenVal: document.getElementById("bgWhitenVal"),
      autoDetectPageBtn: document.getElementById("autoDetectPageBtn"),
      clearRulesBtn: document.getElementById("clearRulesBtn"),
      basicModeBtn: document.getElementById("basicModeBtn"),
      advancedModeBtn: document.getElementById("advancedModeBtn"),
      basicColorsBox: document.getElementById("basicColorsBox"),
      basicColorChips: document.getElementById("basicColorChips"),
      rulesContainer: document.getElementById("rulesContainer"),
      addManualRuleBtn: document.getElementById("addManualRuleBtn"),
      dpiSelect: document.getElementById("dpiSelect"),
      pageRangeInput: document.getElementById("pageRangeInput"),
      includeLegendCheckbox: document.getElementById("includeLegendCheckbox"),
      legendPlacementRow: document.getElementById("legendPlacementRow"),
      legendPlacementSelect: document.getElementById("legendPlacementSelect"),
      exportBtn: document.getElementById("exportBtn"),
      statusText: document.getElementById("statusText"),
      pageNav: document.getElementById("pageNav"),
      prevPage: document.getElementById("prevPage"),
      nextPage: document.getElementById("nextPage"),
      pageIndicator: document.getElementById("pageIndicator"),
      zoomOutBtn: document.getElementById("zoomOutBtn"),
      zoomResetBtn: document.getElementById("zoomResetBtn"),
      zoomInBtn: document.getElementById("zoomInBtn"),
      origWrapper: document.getElementById("origWrapper"),
      outWrapper: document.getElementById("outWrapper"),
      origCanvas: document.getElementById("origCanvas"),
      outCanvas: document.getElementById("outCanvas"),
      previewLoader: document.getElementById("previewLoader"),
    };

    this.origCtx = this.dom.origCanvas.getContext("2d", { willReadFrequently: true });
    this.outCtx = this.dom.outCanvas.getContext("2d");
  },

  bindEvents() {
    this.dom.pdfUpload.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) this.loadPdfFile(file);
      this.dom.pdfUpload.value = "";
    });

    this.bindDragDrop();

    this.dom.darkModeInvertCheckbox.addEventListener("change", () => {
      state.toner.darkModeInvert = this.dom.darkModeInvertCheckbox.checked;
      this.schedulePreviewUpdate(30);
    });

    this.dom.bgWhitenCheckbox.addEventListener("change", () => {
      state.toner.bgWhitenEnabled = this.dom.bgWhitenCheckbox.checked;
      this.dom.bgWhitenControls.classList.toggle("hidden", !state.toner.bgWhitenEnabled);
      this.schedulePreviewUpdate(30);
    });

    this.dom.bgWhitenSlider.addEventListener("input", () => {
      state.toner.bgWhitenThreshold = Number(this.dom.bgWhitenSlider.value);
      this.dom.bgWhitenVal.textContent = this.dom.bgWhitenSlider.value;
      this.schedulePreviewUpdate(CONFIG.debounceDelayMs);
    });

    this.dom.basicModeBtn.addEventListener("click", () => this.setRuleMode("basic"));
    this.dom.advancedModeBtn.addEventListener("click", () => this.setRuleMode("advanced"));

    this.dom.autoDetectPageBtn.addEventListener("click", () => this.autoDetectCurrentPage());
    this.dom.addManualRuleBtn.addEventListener("click", () => this.addRule("#d92626"));
    this.dom.clearRulesBtn.addEventListener("click", () => {
      state.rules = [];
      this.renderRulesUI();
      this.schedulePreviewUpdate(0);
      this.setStatus("All color rules cleared.");
    });

    this.dom.prevPage.addEventListener("click", () => {
      if (state.currentPage > 1) this.renderPreviewPage(--state.currentPage);
    });

    this.dom.nextPage.addEventListener("click", () => {
      if (state.pdfDoc && state.currentPage < state.pdfDoc.numPages) {
        this.renderPreviewPage(++state.currentPage);
      }
    });

    this.dom.zoomOutBtn.addEventListener("click", () => this.setZoom(state.zoomLevel - CONFIG.zoomStep));
    this.dom.zoomInBtn.addEventListener("click", () => this.setZoom(state.zoomLevel + CONFIG.zoomStep));
    this.dom.zoomResetBtn.addEventListener("click", () => this.setZoom(1.0));

    const wheelHandler = (e) => this.handleWheelZoom(e);
    this.dom.origWrapper.addEventListener("wheel", wheelHandler, { passive: false });
    this.dom.outWrapper.addEventListener("wheel", wheelHandler, { passive: false });

    this.dom.origWrapper.addEventListener("scroll", () => this.syncScroll(this.dom.origWrapper, this.dom.outWrapper, "orig"));
    this.dom.outWrapper.addEventListener("scroll", () => this.syncScroll(this.dom.outWrapper, this.dom.origWrapper, "out"));

    this.dom.origCanvas.addEventListener("click", (e) => this.handleEyedropperClick(e));

    this.dom.includeLegendCheckbox.addEventListener("change", () => {
      this.dom.legendPlacementRow.classList.toggle("hidden", !this.dom.includeLegendCheckbox.checked);
    });

    this.dom.exportBtn.addEventListener("click", () => this.handleExport());

    window.addEventListener("resize", () => {
      if (state.pdfDoc) this.updateZoomUI();
    });
  },

  bindDragDrop() {
    ["dragenter", "dragover"].forEach((evt) => {
      this.dom.dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        this.dom.dropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      this.dom.dropZone.addEventListener(evt, () => {
        this.dom.dropZone.classList.remove("drag-over");
      });
    });

    let dragDepth = 0;
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      dragDepth++;
      this.dom.globalDropOverlay.classList.add("active");
    });

    window.addEventListener("dragover", (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("dragleave", () => {
      if (dragDepth > 0) dragDepth--;
      if (dragDepth === 0) this.dom.globalDropOverlay.classList.remove("active");
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      this.dom.globalDropOverlay.classList.remove("active");
      this.dom.dropZone.classList.remove("drag-over");

      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) this.loadPdfFile(file);
    });
  },

  setStatus(msg, isError = false) {
    this.dom.statusText.textContent = msg;
    this.dom.statusText.classList.toggle("error", isError);
  },

  renderPaletteChips() {
    this.dom.basicColorChips.innerHTML = "";
    PALETTES.basicColors.forEach((color) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "color-chip-btn";
      btn.disabled = !state.pdfDoc;
      btn.title = `Add rule for ${color.name}`;
      btn.innerHTML = `<span class="color-chip-dot" style="background:${color.hex};"></span><span>${color.name}</span>`;
      btn.addEventListener("click", () => {
        this.addRule(color.hex);
        this.setStatus(`Added rule for ${color.name}.`);
      });
      this.dom.basicColorChips.appendChild(btn);
    });
  },

  setRuleMode(mode) {
    state.ruleMode = mode;
    this.dom.basicModeBtn.classList.toggle("active", mode === "basic");
    this.dom.advancedModeBtn.classList.toggle("active", mode === "advanced");
    this.dom.basicColorsBox.classList.toggle("hidden", mode !== "basic");
    this.renderRulesUI();
  },

  async loadPdfFile(file) {
    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      this.setStatus("Please select a valid .pdf file.", true);
      return;
    }

    state.uploadedFileName = file.name;
    this.dom.fileNameDisplay.textContent = file.name;
    this.dom.fileNameDisplay.classList.remove("hidden");
    this.setStatus("Parsing PDF locally...");

    try {
      const arrayBuffer = await file.arrayBuffer();
      state.pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      state.currentPage = 1;
      state.zoomLevel = 1.0;

      this.dom.pageNav.classList.remove("hidden");
      this.dom.autoDetectPageBtn.disabled = false;
      this.dom.clearRulesBtn.disabled = false;
      this.dom.addManualRuleBtn.disabled = false;
      this.dom.exportBtn.disabled = false;
      this.dom.pageRangeInput.placeholder = `e.g. 1-${Math.min(5, state.pdfDoc.numPages)} (1-${state.pdfDoc.numPages} available)`;

      this.renderPaletteChips();
      this.updateZoomUI();
      this.renderRulesUI();
      await this.renderPreviewPage(state.currentPage);
      this.setStatus("Ready. Select colors, click ink on the Original canvas, or run Auto-Detect.");
    } catch (err) {
      console.error("PDF Parsing Failure:", err);
      this.setStatus(`Failed to read PDF: ${err.message}`, true);
    }
  },

  async renderPreviewPage(pageNum) {
    this.showPreviewLoader(true);
    const page = await state.pdfDoc.getPage(pageNum);
    const rotation = page.rotate || 0;
    const viewport = page.getViewport({ scale: CONFIG.previewScale, rotation });

    this.dom.origCanvas.width = Math.floor(viewport.width);
    this.dom.origCanvas.height = Math.floor(viewport.height);
    this.dom.outCanvas.width = this.dom.origCanvas.width;
    this.dom.outCanvas.height = this.dom.origCanvas.height;

    const isLandscape = viewport.width > viewport.height;
    const orientLabel = isLandscape ? "Landscape" : "Portrait";
    this.dom.pageIndicator.textContent = `Page ${pageNum} / ${state.pdfDoc.numPages} (${orientLabel})`;
    this.dom.prevPage.disabled = pageNum <= 1;
    this.dom.nextPage.disabled = pageNum >= state.pdfDoc.numPages;

    this.updateZoomUI();
    this.dom.origWrapper.scrollTop = 0;
    this.dom.origWrapper.scrollLeft = 0;
    this.dom.outWrapper.scrollTop = 0;
    this.dom.outWrapper.scrollLeft = 0;

    await page.render({ canvasContext: this.origCtx, viewport }).promise;

    const src = this.origCtx.getImageData(0, 0, this.dom.origCanvas.width, this.dom.origCanvas.height);
    state.cachedBuffers = ImageEngine.buildPixelBuffers(src);

    this.runPreviewUpdateNow();
  },

  handleWheelZoom(e) {
    if (!state.pdfDoc || (!e.ctrlKey && !e.metaKey)) return;
    e.preventDefault();
    const direction = e.deltaY < 0 ? 1 : -1;
    this.setZoom(state.zoomLevel + direction * CONFIG.zoomStep);
  },

  setZoom(targetZoom) {
    const clamped = Math.round(Math.min(CONFIG.maxZoom, Math.max(CONFIG.minZoom, targetZoom)) * 100) / 100;
    if (clamped === state.zoomLevel) return;

    const centerRatioX =
      this.dom.origWrapper.scrollWidth > this.dom.origWrapper.clientWidth
        ? (this.dom.origWrapper.scrollLeft + this.dom.origWrapper.clientWidth / 2) / this.dom.origWrapper.scrollWidth
        : 0.5;

    const centerRatioY =
      this.dom.origWrapper.scrollHeight > this.dom.origWrapper.clientHeight
        ? (this.dom.origWrapper.scrollTop + this.dom.origWrapper.clientHeight / 2) / this.dom.origWrapper.scrollHeight
        : 0;

    state.zoomLevel = clamped;
    this.updateZoomUI();

    const targetLeft = Math.max(0, centerRatioX * this.dom.origWrapper.scrollWidth - this.dom.origWrapper.clientWidth / 2);
    const targetTop = Math.max(0, centerRatioY * this.dom.origWrapper.scrollHeight - this.dom.origWrapper.clientHeight / 2);

    this.dom.origWrapper.scrollLeft = targetLeft;
    this.dom.origWrapper.scrollTop = targetTop;
    this.dom.outWrapper.scrollLeft = targetLeft;
    this.dom.outWrapper.scrollTop = targetTop;
  },

  updateZoomUI() {
    if (!this.dom.origCanvas.width || !this.dom.origCanvas.height) return;

    const wrapperWidth = this.dom.origWrapper.clientWidth || 400;
    const wrapperHeight = this.dom.origWrapper.clientHeight || 350;

    const pad = 24;
    const availW = Math.max(100, wrapperWidth - pad);
    const availH = Math.max(100, wrapperHeight - pad);

    const canvasAspect = this.dom.origCanvas.width / this.dom.origCanvas.height;
    const wrapperAspect = availW / availH;

    let baseW, baseH;
    if (canvasAspect > wrapperAspect) {
      baseW = availW;
      baseH = availW / canvasAspect;
    } else {
      baseH = availH;
      baseW = availH * canvasAspect;
    }

    const targetW = Math.round(baseW * state.zoomLevel);
    const targetH = Math.round(baseH * state.zoomLevel);

    this.dom.origCanvas.style.width = `${targetW}px`;
    this.dom.origCanvas.style.height = `${targetH}px`;
    this.dom.outCanvas.style.width = `${targetW}px`;
    this.dom.outCanvas.style.height = `${targetH}px`;

    const pct = `${Math.round(state.zoomLevel * 100)}%`;
    this.dom.zoomResetBtn.textContent = pct;
    this.dom.zoomOutBtn.disabled = state.zoomLevel <= CONFIG.minZoom;
    this.dom.zoomInBtn.disabled = state.zoomLevel >= CONFIG.maxZoom;
  },

  syncScroll(source, target, key) {
    if (state.scrollSyncLock && state.scrollSyncLock !== key) return;
    state.scrollSyncLock = key;
    target.scrollLeft = source.scrollLeft;
    target.scrollTop = source.scrollTop;
    requestAnimationFrame(() => {
      if (state.scrollSyncLock === key) state.scrollSyncLock = null;
    });
  },

  handleEyedropperClick(e) {
    if (!state.pdfDoc) return;
    const rect = this.dom.origCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(this.dom.origCanvas.width - 1, Math.floor(((e.clientX - rect.left) / rect.width) * this.dom.origCanvas.width)));
    const y = Math.max(0, Math.min(this.dom.origCanvas.height - 1, Math.floor(((e.clientY - rect.top) / rect.height) * this.dom.origCanvas.height)));

    const size = 5;
    const sx = Math.max(0, Math.min(this.dom.origCanvas.width - size, x - 2));
    const sy = Math.max(0, Math.min(this.dom.origCanvas.height - size, y - 2));
    const patch = this.origCtx.getImageData(sx, sy, size, size).data;

    let bestRgb = [0, 0, 0];
    let bestScore = -1;

    for (let i = 0; i < patch.length; i += 4) {
      const r = patch[i];
      const g = patch[i + 1];
      const b = patch[i + 2];
      const { s, v } = ColorUtils.rgbToHsv(r, g, b);
      const lumBias = state.toner.darkModeInvert ? v / 100 : 1 - v / 100;
      const score = (s / 100) * 2.2 + lumBias;
      if (score > bestScore) {
        bestScore = score;
        bestRgb = [r, g, b];
      }
    }

    this.addRule(ColorUtils.rgbToHex(bestRgb[0], bestRgb[1], bestRgb[2]));
  },

  autoDetectCurrentPage() {
    if (!state.cachedBuffers) return;
    const { h, s, v, data, totalPixels } = state.cachedBuffers;

    const NUM_HUE = 18;
    const buckets = Array.from({ length: NUM_HUE * 2 }, () => ({ count: 0, r: 0, g: 0, b: 0 }));
    let sampled = 0;

    for (let p = 0; p < totalPixels; p += 2) {
      sampled++;
      const sat = s[p];
      const val = v[p];
      if (sat >= 18 && val >= 10 && val <= 96) {
        const hIdx = Math.floor(((h[p] + 10) % 360) / 20);
        const vBand = val < 55 ? 0 : 1;
        const bIdx = hIdx * 2 + vBand;
        const i = p * 4;
        buckets[bIdx].count++;
        buckets[bIdx].r += data[i];
        buckets[bIdx].g += data[i + 1];
        buckets[bIdx].b += data[i + 2];
      }
    }

    const minCount = Math.max(20, sampled * 0.00012);
    const candidates = buckets.filter((b) => b.count >= minCount).sort((a, b) => b.count - a.count);

    let addedCount = 0;

    for (const b of candidates) {
      const cr = Math.round(b.r / b.count);
      const cg = Math.round(b.g / b.count);
      const cb = Math.round(b.b / b.count);
      const cHsv = ColorUtils.rgbToHsv(cr, cg, cb);

      const alreadyExists = state.rules.some((existing) => {
        const [er, eg, eb] = ColorUtils.hexToRgb(existing.sourceHex);
        const eHsv = ColorUtils.rgbToHsv(er, eg, eb);
        let dh = Math.abs(cHsv.h - eHsv.h);
        if (dh > 180) dh = 360 - dh;
        const rgbDist = Math.hypot(cr - er, cg - eg, cb - eb);
        return rgbDist < 28 || (dh < 12 && Math.abs(cHsv.v - eHsv.v) < 18 && Math.abs(cHsv.s - eHsv.s) < 20);
      });

      if (!alreadyExists) {
        this.addRule(ColorUtils.rgbToHex(cr, cg, cb), false);
        addedCount++;
        if (addedCount >= 10) break;
      }
    }

    this.renderRulesUI();
    this.schedulePreviewUpdate(0);

    if (addedCount > 0) {
      this.setStatus(`Page ${state.currentPage}: Added ${addedCount} detected color(s).`);
    } else {
      this.setStatus(`Page ${state.currentPage}: Visible colors already covered by rules.`);
    }
  },

  addRule(hexColor, shouldRender = true) {
    const preset = DEFAULT_STYLE_CYCLE[state.rules.length % DEFAULT_STYLE_CYCLE.length];
    state.rules.push({
      id: state.nextRuleId++,
      sourceHex: hexColor.toLowerCase(),
      tolerance: 35,
      fillShade: preset.fillShade,
      pattern: preset.pattern,
      patternShade: preset.patternShade,
      patternSpacing: preset.patternSpacing,
      borderEnabled: preset.borderEnabled,
      borderShade: preset.borderShade,
      borderWidth: preset.borderWidth,
    });

    if (shouldRender) {
      this.renderRulesUI();
      this.schedulePreviewUpdate(0);
    }
  },

  applyPresetToRule(rule, preset) {
    rule.fillShade = preset.fillShade;
    rule.pattern = preset.pattern;
    rule.patternShade = preset.patternShade;
    rule.patternSpacing = preset.patternSpacing;
    rule.borderEnabled = preset.borderEnabled;
    rule.borderShade = preset.borderShade;
    rule.borderWidth = preset.borderWidth;
  },

  getMatchingPresetId(rule, list) {
    const match = list.find(
      (p) =>
        p.fillShade === rule.fillShade &&
        p.pattern === rule.pattern &&
        (p.pattern === "solid" || (p.patternShade === rule.patternShade && p.patternSpacing === rule.patternSpacing)) &&
        p.borderEnabled === rule.borderEnabled &&
        (!p.borderEnabled || (p.borderShade === rule.borderShade && p.borderWidth === rule.borderWidth))
    );
    return match ? match.id : "custom";
  },

  getPreviewBoxStyle(rule) {
    const f = `rgb(${rule.fillShade},${rule.fillShade},${rule.fillShade})`;
    const p = `rgb(${rule.patternShade},${rule.patternShade},${rule.patternShade})`;
    const sp = Math.max(4, rule.patternSpacing);
    const borderCss = rule.borderEnabled
      ? `${rule.borderWidth}px solid rgb(${rule.borderShade},${rule.borderShade},${rule.borderShade})`
      : "1px dashed #cbd5e1";

    let bgCss = `background-color:${f};`;
    if (rule.pattern === "stripes") {
      bgCss = `background:repeating-linear-gradient(135deg, ${p} 0 1.5px, ${f} 1.5px ${sp}px);`;
    } else if (rule.pattern === "crosshatch") {
      bgCss =
        `background-color:${f};` +
        `background-image:` +
        `repeating-linear-gradient(135deg, ${p} 0 1.2px, transparent 1.2px ${sp}px),` +
        `repeating-linear-gradient(45deg, ${p} 0 1.2px, transparent 1.2px ${sp}px);`;
    } else if (rule.pattern === "dots") {
      bgCss =
        `background-color:${f};` +
        `background-image:radial-gradient(${p} 1.3px, transparent 1.3px);` +
        `background-size:${sp}px ${sp}px;`;
    }

    return `${bgCss} border:${borderCss};`;
  },

  renderRulesUI() {
    this.dom.rulesContainer.innerHTML = "";

    if (state.rules.length === 0) {
      this.dom.rulesContainer.innerHTML = `<p class="hint">No color rules defined. Pick a palette color, click ink on the Original preview, or run Auto-Detect.</p>`;
      return;
    }

    state.rules.forEach((rule) => {
      const card = document.createElement("div");
      card.className = "rule-card";

      const isPattern = rule.pattern !== "solid";
      const activePresetList = isPattern ? PALETTES.patternPresets : PALETTES.normalPresets;
      const matchedPreset = this.getMatchingPresetId(rule, activePresetList);
      const colorName = ColorUtils.describeColorName(rule.sourceHex);
      const matchedBasicColor = PALETTES.basicColors.find((c) => c.hex.toLowerCase() === rule.sourceHex.toLowerCase());

      const basicColorOptionsHtml =
        PALETTES.basicColors
          .map((c) => `<option value="${c.hex}" ${matchedBasicColor && matchedBasicColor.hex === c.hex ? "selected" : ""}>${c.name}</option>`)
          .join("") + (!matchedBasicColor ? `<option value="custom" selected>${colorName} (Sampled)</option>` : "");

      const presetOptionsHtml =
        activePresetList
          .map((p) => `<option value="${p.id}" ${matchedPreset === p.id ? "selected" : ""}>${p.label}</option>`)
          .join("") + (matchedPreset === "custom" ? `<option value="custom" selected>Custom Rule</option>` : "");

      card.innerHTML = `
        <div class="rule-top">
          <div class="swatch-group">
            <input type="color" value="${rule.sourceHex}" data-field="sourceHex" title="Source Color (${rule.sourceHex})" />
            ${
              state.ruleMode === "basic"
                ? `<select class="source-color-select" data-basic-source="true" aria-label="Source color">${basicColorOptionsHtml}</select>`
                : `<span class="color-name-tag" data-color-name="true" title="${colorName} (${rule.sourceHex})">${colorName}</span>`
            }
            <span>\u2192</span>
            <span class="rule-preview-box" style="${this.getPreviewBoxStyle(rule)}"></span>
          </div>
          <button class="delete-btn" data-delete="${rule.id}" type="button">Remove</button>
        </div>

        ${
          state.ruleMode === "basic"
            ? `
          <div class="style-category-toggle" role="tablist" aria-label="Style category">
            <button type="button" class="cat-btn ${!isPattern ? "active" : ""}" data-cat="normal">Normal</button>
            <button type="button" class="cat-btn ${isPattern ? "active" : ""}" data-cat="pattern">Pattern</button>
          </div>
          <select class="preset-select" data-preset="true" aria-label="Monochrome style preset">${presetOptionsHtml}</select>
        `
            : `
          <div class="adv-section">
            <div class="adv-section-title">Base Tone &amp; Border</div>
            <label class="control-row">
              <span>Tolerance (<strong data-val="tolerance">${rule.tolerance}</strong>)</span>
              <input type="range" min="10" max="80" value="${rule.tolerance}" data-field="tolerance" />
            </label>
            <label class="control-row">
              <span>Fill Tone (<strong data-val="fillShade">${rule.fillShade}</strong>)</span>
              <input type="range" min="0" max="255" value="${rule.fillShade}" data-field="fillShade" />
            </label>
            <label class="control-row">
              <span><input type="checkbox" ${rule.borderEnabled ? "checked" : ""} data-field="borderEnabled" /> Contrast Outline</span>
            </label>
            <div class="border-controls ${rule.borderEnabled ? "" : "hidden"}">
              <label class="control-row">
                <span>Outline Tone (<strong data-val="borderShade">${rule.borderShade}</strong>)</span>
                <input type="range" min="0" max="255" value="${rule.borderShade}" data-field="borderShade" />
              </label>
              <label class="control-row">
                <span>Thickness (<strong data-val="borderWidth">${rule.borderWidth}</strong>px)</span>
                <input type="range" min="1" max="5" value="${rule.borderWidth}" data-field="borderWidth" />
              </label>
            </div>
          </div>

          <div class="adv-section">
            <div class="adv-section-title">Hatch Pattern</div>
            <label class="control-row">
              <span>Pattern</span>
              <select class="control-select" data-field="pattern">
                <option value="solid" ${rule.pattern === "solid" ? "selected" : ""}>Solid Fill</option>
                <option value="stripes" ${rule.pattern === "stripes" ? "selected" : ""}>Diagonal Stripes</option>
                <option value="crosshatch" ${rule.pattern === "crosshatch" ? "selected" : ""}>Crosshatch</option>
                <option value="dots" ${rule.pattern === "dots" ? "selected" : ""}>Stipple Dots</option>
              </select>
            </label>
            <div class="pattern-controls ${rule.pattern === "solid" ? "hidden" : ""}">
              <label class="control-row">
                <span>Stroke Tone (<strong data-val="patternShade">${rule.patternShade}</strong>)</span>
                <input type="range" min="0" max="255" value="${rule.patternShade}" data-field="patternShade" />
              </label>
              <label class="control-row">
                <span>Pitch / Spacing (<strong data-val="patternSpacing">${rule.patternSpacing}</strong>px)</span>
                <input type="range" min="4" max="14" value="${rule.patternSpacing}" data-field="patternSpacing" />
              </label>
            </div>
          </div>
        `
        }
      `;

      const previewBox = card.querySelector(".rule-preview-box");
      const colorNameTag = card.querySelector("[data-color-name]");
      const colorPickerInput = card.querySelector('input[data-field="sourceHex"]');

      const basicSourceSelect = card.querySelector("[data-basic-source]");
      if (basicSourceSelect) {
        basicSourceSelect.addEventListener("change", () => {
          if (basicSourceSelect.value === "custom") return;
          rule.sourceHex = basicSourceSelect.value.toLowerCase();
          if (colorPickerInput) colorPickerInput.value = rule.sourceHex;
          this.schedulePreviewUpdate(40);
        });
      }

      card.querySelectorAll("[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const targetCat = btn.dataset.cat;
          if (targetCat === "normal" && rule.pattern !== "solid") {
            this.applyPresetToRule(rule, PALETTES.normalPresets[0]);
            this.renderRulesUI();
            this.schedulePreviewUpdate(40);
          } else if (targetCat === "pattern" && rule.pattern === "solid") {
            this.applyPresetToRule(rule, PALETTES.patternPresets[0]);
            this.renderRulesUI();
            this.schedulePreviewUpdate(40);
          }
        });
      });

      const presetSelect = card.querySelector("[data-preset]");
      if (presetSelect) {
        presetSelect.addEventListener("change", () => {
          const list = rule.pattern !== "solid" ? PALETTES.patternPresets : PALETTES.normalPresets;
          const chosen = list.find((p) => p.id === presetSelect.value);
          if (!chosen) return;
          this.applyPresetToRule(rule, chosen);
          previewBox.setAttribute("style", this.getPreviewBoxStyle(rule));
          this.schedulePreviewUpdate(40);
        });
      }

      const patternSelect = card.querySelector('select[data-field="pattern"]');
      if (patternSelect) {
        patternSelect.addEventListener("change", () => {
          const prevWasSolid = rule.pattern === "solid";
          rule.pattern = patternSelect.value;
          if (prevWasSolid && rule.pattern !== "solid" && rule.fillShade < 180) {
            rule.fillShade = 245;
            const fillSlider = card.querySelector('input[data-field="fillShade"]');
            const fillVal = card.querySelector('[data-val="fillShade"]');
            if (fillSlider) fillSlider.value = "245";
            if (fillVal) fillVal.textContent = "245";
          }
          const patternDiv = card.querySelector(".pattern-controls");
          if (patternDiv) patternDiv.classList.toggle("hidden", rule.pattern === "solid");
          previewBox.setAttribute("style", this.getPreviewBoxStyle(rule));
          this.schedulePreviewUpdate(40);
        });
      }

      card.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", () => {
          const field = input.dataset.field;
          if (input.type === "checkbox") {
            rule[field] = input.checked;
            const borderDiv = card.querySelector(".border-controls");
            if (borderDiv) borderDiv.classList.toggle("hidden", !rule.borderEnabled);
            previewBox.setAttribute("style", this.getPreviewBoxStyle(rule));
            this.schedulePreviewUpdate(40);
          } else if (input.type === "color") {
            rule[field] = input.value.toLowerCase();
            const updatedName = ColorUtils.describeColorName(rule.sourceHex);
            if (colorNameTag) {
              colorNameTag.textContent = updatedName;
              colorNameTag.title = `${updatedName} (${rule.sourceHex})`;
            }
            if (basicSourceSelect) {
              const match = PALETTES.basicColors.find((c) => c.hex.toLowerCase() === rule.sourceHex);
              if (match) {
                basicSourceSelect.value = match.hex;
              } else {
                let customOpt = basicSourceSelect.querySelector('option[value="custom"]');
                if (!customOpt) {
                  customOpt = document.createElement("option");
                  customOpt.value = "custom";
                  basicSourceSelect.appendChild(customOpt);
                }
                customOpt.textContent = `${updatedName} (Sampled)`;
                basicSourceSelect.value = "custom";
              }
            }
            this.schedulePreviewUpdate(CONFIG.debounceDelayMs);
          } else {
            rule[field] = Number(input.value);
            const valLabel = card.querySelector(`[data-val="${field}"]`);
            if (valLabel) valLabel.textContent = input.value;
            previewBox.setAttribute("style", this.getPreviewBoxStyle(rule));
            this.schedulePreviewUpdate(CONFIG.debounceDelayMs);
          }
        });
      });

      card.querySelector("[data-delete]").addEventListener("click", () => {
        state.rules = state.rules.filter((r) => r.id !== rule.id);
        this.renderRulesUI();
        this.schedulePreviewUpdate(0);
      });

      this.dom.rulesContainer.appendChild(card);
    });
  },

  showPreviewLoader(visible) {
    this.dom.previewLoader.classList.toggle("hidden", !visible);
  },

  schedulePreviewUpdate(delayMs = CONFIG.debounceDelayMs) {
    if (!state.cachedBuffers) return;
    this.showPreviewLoader(true);
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      requestAnimationFrame(() => {
        setTimeout(() => this.runPreviewUpdateNow(), 0);
      });
    }, delayMs);
  },

  runPreviewUpdateNow() {
    if (!state.cachedBuffers) {
      this.showPreviewLoader(false);
      return;
    }
    const processed = ImageEngine.processBuffers(state.cachedBuffers, state.rules, state.toner, 1);
    this.outCtx.putImageData(processed, 0, 0);
    this.showPreviewLoader(false);
  },

  async handleExport() {
    if (!state.pdfDoc) return;

    if (!window.jspdf || !window.jspdf.jsPDF) {
      this.setStatus("PDF generation library missing in vendor directory.", true);
      return;
    }

    let selectedPages;
    try {
      selectedPages = PdfExportEngine.parsePageRange(this.dom.pageRangeInput.value, state.pdfDoc.numPages);
    } catch (rangeErr) {
      this.setStatus(rangeErr.message, true);
      return;
    }

    this.dom.exportBtn.disabled = true;
    const workCanvas = document.createElement("canvas");
    const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

    try {
      const dpi = Number(this.dom.dpiSelect.value);
      const renderScale = dpi / 72;
      const borderScale = renderScale / CONFIG.previewScale;
      const includeLegend = this.dom.includeLegendCheckbox.checked && state.rules.length > 0;
      const legendPlacement = this.dom.legendPlacementSelect.value;
      const { jsPDF } = window.jspdf;

      let outPdf = null;

      if (includeLegend && legendPlacement === "page") {
        this.setStatus("Generating legend cover sheet...");
        await new Promise((r) => setTimeout(r, 20));

        const firstPage = await state.pdfDoc.getPage(selectedPages[0]);
        const rotation = firstPage.rotate || 0;
        const ptVp = firstPage.getViewport({ scale: 1.0, rotation });
        const rVp = firstPage.getViewport({ scale: renderScale, rotation });

        const legendCanvas = PdfExportEngine.createLegendCoverPage(
          Math.floor(rVp.width),
          Math.floor(rVp.height),
          borderScale,
          state.uploadedFileName,
          state.rules
        );
        const legendImg = legendCanvas.toDataURL("image/jpeg", 0.9);
        const orientation = ptVp.width > ptVp.height ? "l" : "p";

        outPdf = new jsPDF({
          orientation,
          unit: "pt",
          format: [ptVp.width, ptVp.height],
          compress: true,
        });
        outPdf.addImage(legendImg, "JPEG", 0, 0, ptVp.width, ptVp.height, undefined, "FAST");
        legendCanvas.width = 0;
        legendCanvas.height = 0;
      }

      for (let idx = 0; idx < selectedPages.length; idx++) {
        const pageNum = selectedPages[idx];
        this.setStatus(`Rasterizing page ${pageNum} (${idx + 1} of ${selectedPages.length})...`);
        await new Promise((r) => setTimeout(r, 20));

        const page = await state.pdfDoc.getPage(pageNum);
        const rotation = page.rotate || 0;
        const ptViewport = page.getViewport({ scale: 1.0, rotation });
        const renderViewport = page.getViewport({ scale: renderScale, rotation });

        workCanvas.width = Math.floor(renderViewport.width);
        workCanvas.height = Math.floor(renderViewport.height);
        await page.render({ canvasContext: workCtx, viewport: renderViewport }).promise;

        const src = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
        const buffers = ImageEngine.buildPixelBuffers(src);
        const processed = ImageEngine.processBuffers(buffers, state.rules, state.toner, borderScale);
        workCtx.putImageData(processed, 0, 0);

        let canvasToExport = workCanvas;
        let tempBannerCanvas = null;

        if (includeLegend && legendPlacement === "banner" && idx === 0) {
          tempBannerCanvas = PdfExportEngine.composeFirstPageWithBanner(workCanvas, borderScale, state.rules);
          canvasToExport = tempBannerCanvas;
        }

        const imgData = canvasToExport.toDataURL("image/jpeg", 0.88);
        if (tempBannerCanvas) {
          tempBannerCanvas.width = 0;
          tempBannerCanvas.height = 0;
        }

        const orientation = ptViewport.width > ptViewport.height ? "l" : "p";
        if (!outPdf) {
          outPdf = new jsPDF({
            orientation,
            unit: "pt",
            format: [ptViewport.width, ptViewport.height],
            compress: true,
          });
        } else {
          outPdf.addPage([ptViewport.width, ptViewport.height], orientation);
        }

        outPdf.addImage(imgData, "JPEG", 0, 0, ptViewport.width, ptViewport.height, undefined, "FAST");
      }

      this.setStatus("Packaging PDF download...");
      await new Promise((r) => setTimeout(r, 20));

      const blob = outPdf.output("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const rangeTag = this.dom.pageRangeInput.value.trim() ? `_p${this.dom.pageRangeInput.value.trim().replace(/[^0-9,-]/g, "")}` : "";
      const outName = state.uploadedFileName.replace(/\.pdf$/i, "") + rangeTag + "_monochrome.pdf";
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      this.setStatus(`Export complete: ${outName}`);
    } catch (err) {
      console.error("PDF Export Failure:", err);
      this.setStatus(`Export failed: ${err.message}`, true);
    } finally {
      workCanvas.width = 0;
      workCanvas.height = 0;
      this.dom.exportBtn.disabled = false;
    }
  },
};

// Start application once DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  AppController.init();
});
