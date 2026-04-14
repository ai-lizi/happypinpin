/* ==========================================================
   拼豆图纸生成器 · 主逻辑
   ========================================================== */

// ---- DOM refs ----
const uploadArea        = document.getElementById('uploadArea');
const fileInput         = document.getElementById('fileInput');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const previewImg        = document.getElementById('previewImg');
const generateBtn       = document.getElementById('generateBtn');
const outputCanvas      = document.getElementById('outputCanvas');
const exportCanvas      = document.getElementById('exportCanvas');
const emptyState        = document.getElementById('emptyState');
const canvasWrapper     = document.getElementById('canvasWrapper');
const canvasToolbar     = document.getElementById('canvasToolbar');
const paletteSection    = document.getElementById('paletteSection');
const paletteList       = document.getElementById('paletteList');
const exportPngBtn      = document.getElementById('exportPngBtn');
const exportListBtn     = document.getElementById('exportListBtn');

// ---- Sliders ----
const gridSizeEl     = document.getElementById('gridSize');
const canvasWidthEl  = document.getElementById('canvasWidth');
const canvasHeightEl = document.getElementById('canvasHeight');
const maxColorsEl    = document.getElementById('maxColors');
const showGridEl     = document.getElementById('showGrid');
const showCodeEl     = document.getElementById('showCode');

// ---- State ----
let loadedImage = null;
let beadGrid    = null;   // 2D array of MARD color objs (or null for transparent)
let gridW = 0, gridH = 0;

// ---- Constants ----
// High-res cell size used for all rendering (保证图纸清晰度)
const RENDER_CELL = 48;   // px per bead, high-res
const LABEL_PADDING = 3;  // px between text lines

// ---- Slider labels ----
function bindSlider(el, suffix) {
  const label = document.getElementById(el.id + 'Val');
  el.addEventListener('input', () => { label.textContent = el.value + (suffix || ''); });
}
bindSlider(gridSizeEl, 'px');
bindSlider(canvasWidthEl, '');
bindSlider(canvasHeightEl, '');
bindSlider(maxColorsEl, '');

// ---- Upload ----
uploadArea.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => loadFile(e.target.files[0]));

uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f && f.type.startsWith('image/')) loadFile(f);
});

function loadFile(file) {
  if (!file) return;
  const url = URL.createObjectURL(file);
  previewImg.src = url;
  previewImg.onload = () => {
    uploadPlaceholder.classList.add('hidden');
    previewImg.classList.remove('hidden');
    loadedImage = previewImg;
    generateBtn.disabled = false;
    URL.revokeObjectURL(url);
  };
}

// ---- Generate ----
generateBtn.addEventListener('click', generate);

function generate() {
  if (!loadedImage) return;
  generateBtn.disabled = true;
  generateBtn.textContent = '生成中...';
  setTimeout(() => {
    try { runGenerate(); }
    finally {
      generateBtn.disabled = false;
      generateBtn.innerHTML = '<span class="btn-icon">✨</span> 生成图纸';
    }
  }, 30);
}

function runGenerate() {
  const cols     = parseInt(canvasWidthEl.value);
  const rows     = parseInt(canvasHeightEl.value);
  const maxColor = parseInt(maxColorsEl.value);
  gridW = cols; gridH = rows;

  // ---- Step 1: Sample image into grid (dominant color per cell) ----
  // Use a slightly larger sample (4× oversampling per cell) to get dominant color
  const sample = 4;
  const sW = cols * sample, sH = rows * sample;
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = sW; sampleCanvas.height = sH;
  const sCtx = sampleCanvas.getContext('2d');
  sCtx.drawImage(loadedImage, 0, 0, sW, sH);
  const imgData = sCtx.getImageData(0, 0, sW, sH).data;

  // ---- Step 2: For each cell, find dominant MARD color ----
  const rawGrid = [];
  for (let cy = 0; cy < rows; cy++) {
    rawGrid.push([]);
    for (let cx = 0; cx < cols; cx++) {
      // Collect all sampled pixels in this cell
      const buckets = {};
      let totalA = 0;
      for (let sy = 0; sy < sample; sy++) {
        for (let sx = 0; sx < sample; sx++) {
          const px = cx * sample + sx;
          const py = cy * sample + sy;
          const idx = (py * sW + px) * 4;
          const a = imgData[idx + 3];
          totalA += a;
          if (a >= 30) {
            const nearest = findNearestMard(imgData[idx], imgData[idx+1], imgData[idx+2]);
            buckets[nearest.mard] = (buckets[nearest.mard] || 0) + 1;
          }
        }
      }
      // If mostly transparent, push null
      if (totalA / (sample * sample) < 30) {
        rawGrid[cy].push(null);
      } else {
        // Dominant MARD color
        const dominant = Object.entries(buckets).sort((a,b)=>b[1]-a[1])[0];
        rawGrid[cy].push(MARD_PALETTE.find(p => p.mard === dominant[0]));
      }
    }
  }

  // ---- Step 3: Count & limit to maxColor ----
  const colorCount = {};
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (rawGrid[y][x]) {
        const k = rawGrid[y][x].mard;
        colorCount[k] = (colorCount[k] || 0) + 1;
      }

  const sorted = Object.entries(colorCount).sort((a,b) => b[1]-a[1]);
  const allowedSet = new Set(sorted.slice(0, maxColor).map(([k])=>k));
  const allowedPalette = MARD_PALETTE.filter(c => allowedSet.has(c.mard));

  // ---- Step 4: Remap excluded colors ----
  beadGrid = [];
  for (let y = 0; y < rows; y++) {
    beadGrid.push([]);
    for (let x = 0; x < cols; x++) {
      const c = rawGrid[y][x];
      if (!c) { beadGrid[y].push(null); continue; }
      if (allowedSet.has(c.mard)) { beadGrid[y].push(c); continue; }
      let best = null, bestDist = Infinity;
      for (const a of allowedPalette) {
        const dr=c.r-a.r, dg=c.g-a.g, db=c.b-a.b;
        const d = dr*dr+dg*dg+db*db;
        if (d < bestDist) { bestDist = d; best = a; }
      }
      beadGrid[y].push(best);
    }
  }

  // ---- Step 5: Final count & render ----
  const finalCount = countColors();
  renderGrid(finalCount);
  renderPaletteList(finalCount);
}

// ---- Count helper ----
function countColors() {
  const fc = {};
  for (let y = 0; y < gridH; y++)
    for (let x = 0; x < gridW; x++)
      if (beadGrid[y][x]) {
        const k = beadGrid[y][x].mard;
        fc[k] = (fc[k]||0)+1;
      }
  return fc;
}

// ---- Render Grid (high-res) ----
function renderGrid(finalCount) {
  const cols = gridW, rows = gridH;
  const cell = RENDER_CELL;
  const showGrid = showGridEl.checked;
  const showCode = showCodeEl.checked;

  // Canvas pixel dimensions
  const W = cols * cell;
  const H = rows * cell;

  // Set canvas backing store at full resolution
  outputCanvas.width  = W;
  outputCanvas.height = H;
  // Display size: scale down to fit panel (CSS handles it)
  outputCanvas.style.width  = '100%';
  outputCanvas.style.height = 'auto';
  outputCanvas.style.maxWidth = W + 'px';

  const ctx = outputCanvas.getContext('2d');
  // Ensure crisp rendering
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W, H);

  // ---- Background ----
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, W, H);

  // ---- Draw each bead ----
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = beadGrid[y][x];
      const px = x * cell, py = y * cell;

      if (!c) {
        // Transparent checker
        const chk = (x+y) % 2 === 0 ? '#ffffff' : '#d8d8d8';
        ctx.fillStyle = chk;
        ctx.fillRect(px, py, cell, cell);
        continue;
      }

      // ---- Flat square fill ----
      ctx.fillStyle = c.hex;
      ctx.fillRect(px, py, cell, cell);

      // ---- Color code label (always shown) ----
      if (showCode) {
        const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        const textColor = luma > 145
          ? 'rgba(0,0,0,0.75)'
          : 'rgba(255,255,255,0.90)';

        ctx.save();
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';

        const codeSize = Math.floor(cell * 0.28);
        ctx.font = `bold ${codeSize}px 'Courier New', monospace`;

        ctx.shadowColor   = luma > 145 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
        ctx.shadowBlur    = 2;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = textColor;
        ctx.fillText(c.mard, px + cell / 2, py + cell / 2);

        ctx.restore();
      }
    }
  }

  // ---- Grid lines ----
  if (showGrid) {
    // Fine grid (every cell)
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, H);
    }
    for (let y = 0; y <= rows; y++) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(W, y * cell);
    }
    ctx.stroke();

    // Bold grid every 10 cells (ruler aid)
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= cols; x += 10) {
      ctx.moveTo(x * cell, 0);
      ctx.lineTo(x * cell, H);
    }
    for (let y = 0; y <= rows; y += 10) {
      ctx.moveTo(0, y * cell);
      ctx.lineTo(W, y * cell);
    }
    ctx.stroke();

    // ---- Row/Column number rulers ----
    const rulerSize = Math.floor(cell * 0.32);
    ctx.font = `${rulerSize}px 'Courier New', monospace`;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    // Column numbers (top edge, every 5)
    for (let x = 0; x < cols; x += 5) {
      ctx.fillText(x + 1, x * cell + cell / 2, 2);
    }
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'middle';
    // Row numbers (left edge, every 5)
    for (let y = 0; y < rows; y += 5) {
      ctx.fillText(y + 1, 2, y * cell + cell / 2);
    }
  }

  // Show canvas
  emptyState.classList.add('hidden');
  outputCanvas.classList.remove('hidden');
  canvasToolbar.classList.remove('hidden');
}

// ---- Palette List ----
function renderPaletteList(finalCount) {
  paletteList.innerHTML = '';
  const sorted = Object.entries(finalCount).sort((a,b) => b[1]-a[1]);
  for (const [mard, count] of sorted) {
    const c = MARD_PALETTE.find(p => p.mard === mard);
    if (!c) continue;
    const item = document.createElement('div');
    item.className = 'palette-item';
    item.innerHTML = `
      <div class="palette-swatch" style="background:${c.hex}"></div>
      <div class="palette-info">
        <div class="palette-code">${mard}</div>
        <div class="palette-count">×${count}</div>
      </div>`;
    paletteList.appendChild(item);
  }
  paletteSection.classList.remove('hidden');
}

// ---- Export PNG (导出高清图纸，直接使用高分辨率 canvas) ----
exportPngBtn.addEventListener('click', () => {
  if (!beadGrid) return;
  // The outputCanvas is already high-res (RENDER_CELL * gridW x RENDER_CELL * gridH)
  const link = document.createElement('a');
  link.download = `拼豆图纸_MARD_${gridW}x${gridH}.png`;
  link.href = outputCanvas.toDataURL('image/png');
  link.click();
});

// ---- Export Purchase List ----
exportListBtn.addEventListener('click', exportPurchaseList);

function exportPurchaseList() {
  if (!beadGrid) return;
  const finalCount = countColors();
  const sorted = Object.entries(finalCount).sort((a,b) => b[1]-a[1]);

  const colCount  = 4;
  const listRows  = Math.ceil(sorted.length / colCount);
  const cellW = 220, cellH = 64, padding = 24;
  const titleH = 88;
  const totalBeads = sorted.reduce((s,[,n])=>s+n, 0);

  const W = colCount * cellW + padding * 2;
  const H = listRows * cellH + titleH + padding * 2;

  exportCanvas.width  = W;
  exportCanvas.height = H;
  const ctx = exportCanvas.getContext('2d');

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Title
  ctx.fillStyle = '#1d1d1f';
  ctx.font = 'bold 22px PingFang SC, Helvetica, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`拼豆采购清单 · MARD色号 · ${gridW}×${gridH}`, W/2, 38);
  ctx.fillStyle = '#6e6e73';
  ctx.font = '14px PingFang SC, Helvetica, sans-serif';
  ctx.fillText(`共 ${sorted.length} 种颜色 · 合计 ${totalBeads} 颗`, W/2, 64);

  // Separator
  ctx.strokeStyle = '#e5e5ea';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padding, titleH - 10); ctx.lineTo(W - padding, titleH - 10); ctx.stroke();

  // Items
  sorted.forEach(([mard, count], i) => {
    const col = i % colCount, row = Math.floor(i / colCount);
    const x = padding + col * cellW;
    const y = titleH + row * cellH;
    const c = MARD_PALETTE.find(p => p.mard === mard);
    if (!c) return;

    // Alternating row bg
    if (Math.floor(i / colCount) % 2 === 0) {
      ctx.fillStyle = '#f5f5f7';
      ctx.fillRect(x, y, cellW, cellH);
    }

    // Swatch
    const sw = 30;
    const sx = x + 14, sy = y + (cellH - sw) / 2;
    ctx.fillStyle = c.hex;
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sw, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Code
    ctx.fillStyle = '#1d1d1f';
    ctx.font = 'bold 15px Courier New, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(mard, sx + sw + 12, y + cellH/2 - 8);

    // Count
    ctx.fillStyle = '#6e6e73';
    ctx.font = '12px PingFang SC, Helvetica, sans-serif';
    ctx.fillText(`×${count} 颗`, sx + sw + 12, y + cellH/2 + 10);
  });

  const link = document.createElement('a');
  link.download = `采购清单_MARD_${gridW}x${gridH}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

// ---- Re-render on checkbox change ----
function rerender() {
  if (!beadGrid) return;
  renderGrid(countColors());
}
showGridEl.addEventListener('change', rerender);
showCodeEl.addEventListener('change', rerender);
