const { PNG } = require("pngjs");
const fs = require("fs");
const path = require("path");

// Colors matching the app theme
const NAVY = [27, 42, 74];       // #1B2A4A
const BLUE = [59, 130, 246];     // #3B82F6
const LIGHT_BLUE = [96, 165, 250]; // #60A5FA
const WHITE = [255, 255, 255];
const GREEN = [34, 197, 94];     // #22C55E
const DARK_BG = [15, 23, 42];    // #0F172A

function createPNG(width, height) {
  return new PNG({ width, height });
}

function setPixel(png, x, y, r, g, b, a = 255) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) return;
  const idx = (png.width * y + x) << 2;
  // Alpha blend
  const srcA = a / 255;
  const dstA = 1 - srcA;
  png.data[idx] = Math.round(r * srcA + png.data[idx] * dstA);
  png.data[idx + 1] = Math.round(g * srcA + png.data[idx + 1] * dstA);
  png.data[idx + 2] = Math.round(b * srcA + png.data[idx + 2] * dstA);
  png.data[idx + 3] = Math.min(255, Math.round(a + png.data[idx + 3] * dstA));
}

function fillRect(png, x, y, w, h, color, alpha = 255) {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      setPixel(png, x + dx, y + dy, color[0], color[1], color[2], alpha);
    }
  }
}

function fillCircle(png, cx, cy, radius, color, alpha = 255) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2) {
        setPixel(png, Math.round(x), Math.round(y), color[0], color[1], color[2], alpha);
      }
    }
  }
}

function fillRoundedRect(png, x, y, w, h, r, color, alpha = 255) {
  // Fill main body
  fillRect(png, x + r, y, w - 2 * r, h, color, alpha);
  fillRect(png, x, y + r, w, h - 2 * r, color, alpha);
  // Four corners
  fillCircle(png, x + r, y + r, r, color, alpha);
  fillCircle(png, x + w - r - 1, y + r, r, color, alpha);
  fillCircle(png, x + r, y + h - r - 1, r, color, alpha);
  fillCircle(png, x + w - r - 1, y + h - r - 1, r, color, alpha);
}

// Simple bitmap font for small text (basic uppercase + numbers)
const FONT = {
  'E': [[1,1,1,1],[1,0,0,0],[1,1,1,0],[1,0,0,0],[1,1,1,1]],
  'T': [[1,1,1,1],[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
};

function drawLetter(png, letter, x, y, scale, color) {
  const data = FONT[letter];
  if (!data) return;
  for (let row = 0; row < data.length; row++) {
    for (let col = 0; col < data[row].length; col++) {
      if (data[row][col]) {
        fillRect(png, x + col * scale, y + row * scale, scale, scale, color);
      }
    }
  }
}

// ---- Generate Icon (1024x1024) ----
function generateIcon() {
  const size = 1024;
  const png = createPNG(size, size);

  // Background - dark navy with slight gradient feel
  fillRect(png, 0, 0, size, size, NAVY);

  // Rounded rectangle background for the bus
  const busW = 600;
  const busH = 340;
  const busX = (size - busW) / 2;
  const busY = 240;
  fillRoundedRect(png, busX, busY, busW, busH, 40, BLUE);

  // Bus body (lighter blue)
  const innerW = busW - 40;
  const innerH = busH - 60;
  const innerX = busX + 20;
  const innerY = busY + 20;
  fillRoundedRect(png, innerX, innerY, innerW, innerH, 25, LIGHT_BLUE);

  // Windows - 4 windows
  const winW = 100;
  const winH = 80;
  const winY = innerY + 30;
  const winGap = 30;
  const totalWinW = 4 * winW + 3 * winGap;
  const winStartX = innerX + (innerW - totalWinW) / 2;
  for (let i = 0; i < 4; i++) {
    const wx = winStartX + i * (winW + winGap);
    fillRoundedRect(png, wx, winY, winW, winH, 12, WHITE);
  }

  // Front windshield (bigger)
  const windshieldW = 120;
  const windshieldH = 90;
  const windshieldX = innerX + innerW - windshieldW - 25;
  const windshieldY = innerY + 25;
  fillRoundedRect(png, windshieldX, windshieldY, windshieldW, windshieldH, 14, WHITE);

  // Wheels
  const wheelR = 45;
  const wheelY = busY + busH - 15;
  fillCircle(png, busX + 140, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + 140, wheelY, wheelR - 12, NAVY);
  fillCircle(png, busX + busW - 140, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + busW - 140, wheelY, wheelR - 12, NAVY);
  // Hub caps
  fillCircle(png, busX + 140, wheelY, 12, [100, 116, 139]);
  fillCircle(png, busX + busW - 140, wheelY, 12, [100, 116, 139]);

  // Headlight
  fillCircle(png, busX + busW - 30, busY + busH - 80, 18, GREEN);

  // "ET" monogram in the center area above the bus
  const letterScale = 18;
  const etWidth = 4 * letterScale + 30 + 4 * letterScale; // E width + gap + T width
  const etX = (size - etWidth) / 2;
  const etY = 100;
  drawLetter(png, 'E', etX, etY, letterScale, WHITE);
  drawLetter(png, 'T', etX + 4 * letterScale + 30, etY, letterScale, WHITE);

  // "EasyTroski" text area below bus
  const textY = busY + busH + 80;
  // Draw text as simple block letters
  const letters = 'EASYTROSKI';
  const letterDefs = {
    'E': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,1,1]],
    'A': [[0,1,0],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
    'S': [[1,1,1],[1,0,0],[1,1,0],[0,0,1],[1,1,1]],
    'Y': [[1,0,1],[1,0,1],[0,1,0],[0,1,0],[0,1,0]],
    'T2':[[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
    'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
    'O': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
    'K': [[1,0,1],[1,1,0],[1,0,0],[1,1,0],[1,0,1]],
    'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
  };

  const lScale = 12;
  const lGap = 6;
  const totalTextW = letters.length * (3 * lScale + lGap) - lGap;
  let tx = (size - totalTextW) / 2;

  for (const ch of letters) {
    let data;
    if (ch === 'T') data = letterDefs['T2'];
    else data = letterDefs[ch];
    if (data) {
      for (let row = 0; row < data.length; row++) {
        for (let col = 0; col < data[row].length; col++) {
          if (data[row][col]) {
            fillRect(png, tx + col * lScale, textY + row * lScale, lScale - 1, lScale - 1, WHITE);
          }
        }
      }
    }
    tx += 3 * lScale + lGap;
  }

  // Subtle accent line below text
  fillRect(png, size / 2 - 100, textY + 75, 200, 3, BLUE);

  return png;
}

// ---- Generate Adaptive Icon (1024x1024) - just the foreground ----
function generateAdaptiveIcon() {
  const size = 1024;
  const png = createPNG(size, size);

  // Transparent background for adaptive icon (foreground only)
  // Just draw the bus and ET logo centered

  // Bus body
  const busW = 600;
  const busH = 340;
  const busX = (size - busW) / 2;
  const busY = 280;
  fillRoundedRect(png, busX, busY, busW, busH, 40, BLUE);

  const innerW = busW - 40;
  const innerH = busH - 60;
  const innerX = busX + 20;
  const innerY = busY + 20;
  fillRoundedRect(png, innerX, innerY, innerW, innerH, 25, LIGHT_BLUE);

  // Windows
  const winW = 100;
  const winH = 80;
  const winY = innerY + 30;
  const winGap = 30;
  const totalWinW = 4 * winW + 3 * winGap;
  const winStartX = innerX + (innerW - totalWinW) / 2;
  for (let i = 0; i < 4; i++) {
    const wx = winStartX + i * (winW + winGap);
    fillRoundedRect(png, wx, winY, winW, winH, 12, WHITE);
  }

  // Windshield
  const windshieldW = 120;
  const windshieldH = 90;
  const windshieldX = innerX + innerW - windshieldW - 25;
  const windshieldY = innerY + 25;
  fillRoundedRect(png, windshieldX, windshieldY, windshieldW, windshieldH, 14, WHITE);

  // Wheels
  const wheelR = 45;
  const wheelY = busY + busH - 15;
  fillCircle(png, busX + 140, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + 140, wheelY, wheelR - 12, NAVY);
  fillCircle(png, busX + busW - 140, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + busW - 140, wheelY, wheelR - 12, NAVY);
  fillCircle(png, busX + 140, wheelY, 12, [100, 116, 139]);
  fillCircle(png, busX + busW - 140, wheelY, 12, [100, 116, 139]);

  // Headlight
  fillCircle(png, busX + busW - 30, busY + busH - 80, 18, GREEN);

  // ET monogram
  const letterScale = 22;
  const etWidth = 4 * letterScale + 30 + 4 * letterScale;
  const etX = (size - etWidth) / 2;
  const etY = 80;
  drawLetter(png, 'E', etX, etY, letterScale, NAVY);
  drawLetter(png, 'T', etX + 4 * letterScale + 30, etY, letterScale, NAVY);

  return png;
}

// ---- Generate Splash (1284x2778 or similar tall format) ----
function generateSplash() {
  const width = 1284;
  const height = 2778;
  const png = createPNG(width, height);

  // Background
  fillRect(png, 0, 0, width, height, NAVY);

  // Center content
  const centerX = width / 2;
  const centerY = height / 2;

  // Bus (smaller for splash)
  const busW = 500;
  const busH = 280;
  const busX = centerX - busW / 2;
  const busY = centerY - 180;
  fillRoundedRect(png, busX, busY, busW, busH, 35, BLUE);

  const innerW = busW - 30;
  const innerH = busH - 50;
  const innerX = busX + 15;
  const innerY = busY + 15;
  fillRoundedRect(png, innerX, innerY, innerW, innerH, 20, LIGHT_BLUE);

  // Windows
  const winW = 80;
  const winH = 65;
  const winY = innerY + 25;
  const winGap = 25;
  const totalWinW = 4 * winW + 3 * winGap;
  const winStartX = innerX + (innerW - totalWinW) / 2;
  for (let i = 0; i < 4; i++) {
    const wx = winStartX + i * (winW + winGap);
    fillRoundedRect(png, wx, winY, winW, winH, 10, WHITE);
  }

  // Windshield
  fillRoundedRect(png, innerX + innerW - 100 - 20, innerY + 20, 100, 70, 12, WHITE);

  // Wheels
  const wheelR = 38;
  const wheelY = busY + busH - 12;
  fillCircle(png, busX + 120, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + 120, wheelY, wheelR - 10, NAVY);
  fillCircle(png, busX + busW - 120, wheelY, wheelR, DARK_BG);
  fillCircle(png, busX + busW - 120, wheelY, wheelR - 10, NAVY);
  fillCircle(png, busX + 120, wheelY, 10, [100, 116, 139]);
  fillCircle(png, busX + busW - 120, wheelY, 10, [100, 116, 139]);

  // Headlight
  fillCircle(png, busX + busW - 25, busY + busH - 65, 15, GREEN);

  // "EasyTroski" below bus
  const letterDefs = {
    'E': [[1,1,1],[1,0,0],[1,1,0],[1,0,0],[1,1,1]],
    'A': [[0,1,0],[1,0,1],[1,1,1],[1,0,1],[1,0,1]],
    'S': [[1,1,1],[1,0,0],[1,1,0],[0,0,1],[1,1,1]],
    'Y': [[1,0,1],[1,0,1],[0,1,0],[0,1,0],[0,1,0]],
    'T2':[[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
    'R': [[1,1,0],[1,0,1],[1,1,0],[1,0,1],[1,0,1]],
    'O': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
    'K': [[1,0,1],[1,1,0],[1,0,0],[1,1,0],[1,0,1]],
    'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
  };

  const letters = 'EASYTROSKI';
  const lScale = 16;
  const lGap = 8;
  const totalTextW = letters.length * (3 * lScale + lGap) - lGap;
  let tx = centerX - totalTextW / 2;
  const textY = busY + busH + 100;

  for (const ch of letters) {
    let data;
    if (ch === 'T') data = letterDefs['T2'];
    else data = letterDefs[ch];
    if (data) {
      for (let row = 0; row < data.length; row++) {
        for (let col = 0; col < data[row].length; col++) {
          if (data[row][col]) {
            fillRect(png, tx + col * lScale, textY + row * lScale, lScale - 1, lScale - 1, WHITE);
          }
        }
      }
    }
    tx += 3 * lScale + lGap;
  }

  // Tagline
  const tagY = textY + 100;
  fillRect(png, centerX - 80, tagY, 160, 3, BLUE);

  return png;
}

// ---- Generate Favicon (48x48) ----
function generateFavicon() {
  const size = 48;
  const png = createPNG(size, size);

  fillRect(png, 0, 0, size, size, NAVY);

  // Simple bus shape
  const busX = 6;
  const busY = 14;
  const busW = 36;
  const busH = 22;
  fillRoundedRect(png, busX, busY, busW, busH, 4, BLUE);

  // Windows (2 visible at this size)
  fillRect(png, busX + 5, busY + 5, 10, 8, WHITE);
  fillRect(png, busX + 18, busY + 5, 10, 8, WHITE);

  // Wheels
  fillCircle(png, busX + 10, busY + busH + 2, 4, DARK_BG);
  fillCircle(png, busX + busW - 10, busY + busH + 2, 4, DARK_BG);

  return png;
}

// Write all PNGs
const assetsDir = path.join(__dirname, '..', 'assets');

console.log('Generating icon.png (1024x1024)...');
const icon = generateIcon();
fs.writeFileSync(path.join(assetsDir, 'icon.png'), PNG.sync.write(icon));

console.log('Generating adaptive-icon.png (1024x1024)...');
const adaptive = generateAdaptiveIcon();
fs.writeFileSync(path.join(assetsDir, 'adaptive-icon.png'), PNG.sync.write(adaptive));

console.log('Generating splash-icon.png (1284x2778)...');
const splash = generateSplash();
fs.writeFileSync(path.join(assetsDir, 'splash-icon.png'), PNG.sync.write(splash));

console.log('Generating favicon.png (48x48)...');
const favicon = generateFavicon();
fs.writeFileSync(path.join(assetsDir, 'favicon.png'), PNG.sync.write(favicon));

console.log('✅ All logo files generated!');
