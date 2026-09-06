/**
 * Generates the EasyTroski icon set (icon.png, adaptive-icon.png,
 * splash-icon.png, favicon.png) from a single vector design drawn as SVG.
 *
 * Run: node scripts/generate-icons.js
 */
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// Vector design (drawn in a 1000×1040 design space: 1000×1000 tile + 40px
// 3D extrusion below it). Everything scales from here.
// ─────────────────────────────────────────────────────────────────────────────

const TILE = 1000;

function roundedRect(x, y, w, h, r) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
}

/** Builds the SVG group for the emblem at scale `s` (px per design unit). */
function emblemGroup(s) {
  const g = (n) => (n * s).toFixed(2);
  const b = (x, y, w, h, r) =>
    roundedRect(g(x), g(y), g(w), g(h), g(r));
  const c = (cx, cy, r) =>
    `<circle cx="${g(cx)}" cy="${g(cy)}" r="${g(r)}"/>`;

  return `
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#57A9FF"/>
      <stop offset="0.45" stop-color="#1D6EEB"/>
      <stop offset="1" stop-color="#0B4BC8"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="shade" x1="0" y1="0.7" x2="0" y2="1">
      <stop offset="0" stop-color="#062054" stop-opacity="0"/>
      <stop offset="1" stop-color="#062054" stop-opacity="0.32"/>
    </linearGradient>
  </defs>

  <!-- 3D extrusion base (peeks out below the tile) -->
  <g transform="translate(0 ${g(40)})">
    <rect x="${g(0)}" y="${g(0)}" width="${g(TILE)}" height="${g(TILE)}" rx="${g(250)}" fill="#0A3FA8"/>
  </g>

  <!-- Main tile -->
  <rect x="0" y="0" width="${g(TILE)}" height="${g(TILE)}" rx="${g(250)}" fill="url(#tile)"/>

  <!-- Top gloss -->
  <rect x="0" y="0" width="${g(TILE)}" height="${g(TILE)}" rx="${g(250)}" fill="url(#gloss)"/>

  <!-- Bottom shade -->
  <rect x="0" y="0" width="${g(TILE)}" height="${g(TILE)}" rx="${g(250)}" fill="url(#shade)"/>

  <!-- Bus body -->
  ${b(170, 218, 660, 432, 116)}
  <rect x="${g(170)}" y="${g(218)}" width="${g(660)}" height="${g(432)}" rx="${g(116)}" fill="#FFFFFF"/>

  <!-- Gold accent stripe -->
  <rect x="${g(170)}" y="${g(396)}" width="${g(660)}" height="${g(30)}" rx="${g(15)}" fill="#FFC53D"/>

  <!-- Windows (rear, mid, front windshield) -->
  ${b(230, 268, 150, 120, 30)}
  <rect x="${g(230)}" y="${g(268)}" width="${g(150)}" height="${g(120)}" rx="${g(30)}" fill="#0D4FD4"/>
  ${b(402, 268, 150, 120, 30)}
  <rect x="${g(402)}" y="${g(268)}" width="${g(150)}" height="${g(120)}" rx="${g(30)}" fill="#0D4FD4"/>
  ${b(576, 268, 212, 120, 30)}
  <rect x="${g(576)}" y="${g(268)}" width="${g(212)}" height="${g(120)}" rx="${g(30)}" fill="#0D4FD4"/>

  <!-- Wheels -->
  ${c(350, 720, 104)}
  <circle cx="${g(350)}" cy="${g(720)}" r="${g(104)}" fill="#0B2E63"/>
  ${c(350, 720, 38)}
  <circle cx="${g(350)}" cy="${g(720)}" r="${g(38)}" fill="#FFFFFF"/>
  ${c(652, 720, 104)}
  <circle cx="${g(652)}" cy="${g(720)}" r="${g(104)}" fill="#0B2E63"/>
  ${c(652, 720, 38)}
  <circle cx="${g(652)}" cy="${g(720)}" r="${g(38)}" fill="#FFFFFF"/>

  <!-- Gold "go-live" badge with white dot -->
  ${c(838, 130, 96)}
  <circle cx="${g(838)}" cy="${g(130)}" r="${g(96)}" fill="#F2A93B"/>
  <circle cx="${g(838)}" cy="${g(130)}" r="${g(96)}" stroke="#FFFFFF" stroke-width="${g(14)}" fill="none"/>
  ${c(838, 130, 30)}
  <circle cx="${g(838)}" cy="${g(130)}" r="${g(30)}" fill="#FFFFFF"/>
`;
}

/**
 * Render the emblem centered on a transparent canvas.
 * canvasW/H: output pixel dims; tilePx: emblem tile size in pixels.
 */
async function renderEmblem(canvasW, canvasH, tilePx) {
  const s = tilePx / TILE;
  // Emblem box height in px = tile + 40 design units of extrusion.
  const boxH = (TILE + 40) * s;
  const tx = Math.max(0, (canvasW - tilePx) / 2);
  const ty = Math.max(0, (canvasH - boxH) / 2);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
  <g transform="translate(${tx} ${ty})">${emblemGroup(s)}</g>
</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function main() {
  const outDir = path.join(__dirname, "..", "assets");

  // Legacy / iOS launcher icon — full-bleed tile.
  fs.writeFileSync(
    path.join(outDir, "icon.png"),
    await renderEmblem(1024, 1024, 1024)
  );

  // Android adaptive icon foreground — tile kept inside the safe zone.
  fs.writeFileSync(
    path.join(outDir, "adaptive-icon.png"),
    await renderEmblem(1024, 1024, 640)
  );

  // Splash icon — centered mark on the transparent splash background.
  fs.writeFileSync(
    path.join(outDir, "splash-icon.png"),
    await renderEmblem(1024, 1024, 512)
  );

  // Web favicon.
  fs.writeFileSync(
    path.join(outDir, "favicon.png"),
    await renderEmblem(64, 64, 64)
  );

  console.log("Icons written to", outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
