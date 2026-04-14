/* ==========================================================
   refine.js — 局部优化模块
   依赖全局: outputCanvas, beadGrid, gridW, gridH,
             RENDER_CELL, MARD_PALETTE, findNearestMard,
             loadedImage, renderGrid, countColors, renderPaletteList
   ========================================================== */

(function () {
  // ---- DOM ----
  const refineBtn      = document.getElementById('refineBtn');
  const refineBar      = document.getElementById('refineBar');
  const refineHint     = document.getElementById('refineHint');
  const refineActions  = document.getElementById('refineActions');
  const refineRegenBtn = document.getElementById('refineRegenBtn');
  const refineMergeBtn = document.getElementById('refineMergeBtn');
  const refineDiscardBtn = document.getElementById('refineDiscardBtn');
  const refineCancelBtn  = document.getElementById('refineCancelBtn');
  const canvasWrapper  = document.getElementById('canvasWrapper');
  const selCanvas      = document.getElementById('selectionCanvas');
  const prevCanvas     = document.getElementById('previewCanvas');

  // ---- State ----
  // Mode: 'idle' | 'selecting' | 'selected' | 'previewing'
  let mode = 'idle';

  // Selection in bead-grid coordinates
  let sel = null;  // { x0, y0, x1, y1 } grid cell indices (inclusive)

  // Pending region beadGrid (2D array, same size as sel)
  let regionGrid = null;

  // Mouse drag state for rubber-band selection
  let dragStart = null;

  // ---- Activate / deactivate refine mode ----
  refineBtn.addEventListener('click', () => {
    if (!window.beadGrid) return;
    if (mode === 'idle') {
      enterSelectMode();
    } else {
      exitRefineMode();
    }
  });

  function enterSelectMode() {
    mode = 'selecting';
    refineBtn.classList.add('active');
    refineBar.classList.remove('hidden');
    refineActions.classList.add('hidden');
    refineHint.textContent = '拖拽框选要优化的区域';
    canvasWrapper.classList.add('selecting');

    // Size selCanvas to match outputCanvas display rect
    syncOverlaySize(selCanvas);
    selCanvas.classList.remove('hidden');
    prevCanvas.classList.add('hidden');

    clearSelCanvas();
    sel = null;
    regionGrid = null;
  }

  function exitRefineMode() {
    mode = 'idle';
    refineBtn.classList.remove('active');
    refineBar.classList.add('hidden');
    refineActions.classList.add('hidden');
    canvasWrapper.classList.remove('selecting', 'previewing');
    selCanvas.classList.add('hidden');
    prevCanvas.classList.add('hidden');
    sel = null;
    regionGrid = null;
  }

  // ---- Overlay size sync ----
  function syncOverlaySize(canvas) {
    const oc = document.getElementById('outputCanvas');
    const rect = oc.getBoundingClientRect();
    const wrapRect = canvasWrapper.getBoundingClientRect();

    canvas.style.left   = (rect.left - wrapRect.left + canvasWrapper.scrollLeft) + 'px';
    canvas.style.top    = (rect.top  - wrapRect.top  + canvasWrapper.scrollTop)  + 'px';
    canvas.style.width  = rect.width  + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.width  = rect.width;
    canvas.height = rect.height;
  }

  // ---- Selection drawing ----
  function clearSelCanvas() {
    const ctx = selCanvas.getContext('2d');
    ctx.clearRect(0, 0, selCanvas.width, selCanvas.height);
  }

  function drawSelection(sx, sy, ex, ey) {
    const ctx = selCanvas.getContext('2d');
    ctx.clearRect(0, 0, selCanvas.width, selCanvas.height);

    // Dimming overlay
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, selCanvas.width, selCanvas.height);

    // Punch-out selected area
    const x = Math.min(sx, ex), y = Math.min(sy, ey);
    const w = Math.abs(ex - sx),  h = Math.abs(ey - sy);
    ctx.clearRect(x, y, w, h);

    // Border
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  // ---- Convert display px → grid cell ----
  function displayToGrid(px, py) {
    const oc = document.getElementById('outputCanvas');
    const rect = oc.getBoundingClientRect();
    const scaleX = window.gridW / rect.width;
    const scaleY = window.gridH / rect.height;
    return {
      gx: Math.floor(px * scaleX),
      gy: Math.floor(py * scaleY)
    };
  }

  // ---- Mouse events on selCanvas ----
  selCanvas.addEventListener('mousedown', onSelMouseDown);
  selCanvas.addEventListener('mousemove', onSelMouseMove);
  selCanvas.addEventListener('mouseup',   onSelMouseUp);
  selCanvas.addEventListener('mouseleave', onSelMouseUp);
  selCanvas.addEventListener('touchstart', onSelTouchStart, { passive: false });
  selCanvas.addEventListener('touchmove',  onSelTouchMove,  { passive: false });
  selCanvas.addEventListener('touchend',   onSelTouchEnd);

  function clientToSel(clientX, clientY) {
    const r = selCanvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function onSelMouseDown(e) {
    if (mode !== 'selecting') return;
    const pos = clientToSel(e.clientX, e.clientY);
    dragStart = pos;
  }
  function onSelMouseMove(e) {
    if (!dragStart || mode !== 'selecting') return;
    const pos = clientToSel(e.clientX, e.clientY);
    drawSelection(dragStart.x, dragStart.y, pos.x, pos.y);
  }
  function onSelMouseUp(e) {
    if (!dragStart || mode !== 'selecting') return;
    const pos = clientToSel(e.clientX, e.clientY);
    finishSelection(dragStart, pos);
    dragStart = null;
  }

  function onSelTouchStart(e) {
    e.preventDefault();
    const t = e.touches[0];
    dragStart = clientToSel(t.clientX, t.clientY);
  }
  function onSelTouchMove(e) {
    e.preventDefault();
    if (!dragStart) return;
    const t = e.touches[0];
    const pos = clientToSel(t.clientX, t.clientY);
    drawSelection(dragStart.x, dragStart.y, pos.x, pos.y);
  }
  function onSelTouchEnd(e) {
    if (!dragStart) return;
    const t = e.changedTouches[0];
    const pos = clientToSel(t.clientX, t.clientY);
    finishSelection(dragStart, pos);
    dragStart = null;
  }

  function finishSelection(start, end) {
    const g0 = displayToGrid(Math.min(start.x, end.x), Math.min(start.y, end.y));
    const g1 = displayToGrid(Math.max(start.x, end.x), Math.max(start.y, end.y));

    // Clamp to grid
    const x0 = Math.max(0, Math.min(g0.gx, window.gridW - 1));
    const y0 = Math.max(0, Math.min(g0.gy, window.gridH - 1));
    const x1 = Math.max(0, Math.min(g1.gx, window.gridW - 1));
    const y1 = Math.max(0, Math.min(g1.gy, window.gridH - 1));

    if (x1 - x0 < 1 || y1 - y0 < 1) return; // too small

    sel = { x0, y0, x1, y1 };
    mode = 'selected';

    refineHint.textContent = `已选中 ${x1 - x0 + 1}×${y1 - y0 + 1} 格`;
    // Show action buttons only after first generate
    refineActions.classList.add('hidden');

    // Auto-run region generation immediately
    generateRegion();
  }

  // ---- Region generation ----
  function generateRegion() {
    if (!sel || !window.loadedImage) return;
    refineHint.textContent = '正在二次生成...';

    setTimeout(() => {
      const { x0, y0, x1, y1 } = sel;
      const rW = x1 - x0 + 1;
      const rH = y1 - y0 + 1;

      // Sample source image for just this region
      const srcImg = window.loadedImage;
      const srcW = srcImg.naturalWidth || srcImg.width;
      const srcH = srcImg.naturalHeight || srcImg.height;

      // Map grid region → pixel region in source image
      const totalCols = window.gridW, totalRows = window.gridH;
      const px0 = Math.round((x0 / totalCols) * srcW);
      const py0 = Math.round((y0 / totalRows) * srcH);
      const pw  = Math.round((rW  / totalCols) * srcW);
      const ph  = Math.round((rH  / totalRows) * srcH);

      // Sample at 4× oversample
      const sample = 4;
      const sW = rW * sample, sH = rH * sample;
      const tmpC = document.createElement('canvas');
      tmpC.width = sW; tmpC.height = sH;
      const tmpCtx = tmpC.getContext('2d');
      tmpCtx.drawImage(srcImg, px0, py0, pw, ph, 0, 0, sW, sH);
      const imgData = tmpCtx.getImageData(0, 0, sW, sH).data;

      // ---- Build region beadGrid ----
      const maxColor = parseInt(document.getElementById('maxColors').value);
      const rawRegion = [];
      for (let cy = 0; cy < rH; cy++) {
        rawRegion.push([]);
        for (let cx = 0; cx < rW; cx++) {
          const buckets = {};
          let totalA = 0;
          for (let sy = 0; sy < sample; sy++) {
            for (let sx = 0; sx < sample; sx++) {
              const pidx = ((cy * sample + sy) * sW + (cx * sample + sx)) * 4;
              const a = imgData[pidx + 3];
              totalA += a;
              if (a >= 30) {
                const n = findNearestMard(imgData[pidx], imgData[pidx+1], imgData[pidx+2]);
                buckets[n.mard] = (buckets[n.mard] || 0) + 1;
              }
            }
          }
          if (totalA / (sample * sample) < 30) {
            rawRegion[cy].push(null);
          } else {
            const dom = Object.entries(buckets).sort((a,b)=>b[1]-a[1])[0];
            rawRegion[cy].push(MARD_PALETTE.find(p => p.mard === dom[0]));
          }
        }
      }

      // Count & limit colors (allow same max as global)
      const colorCount = {};
      for (let y = 0; y < rH; y++)
        for (let x = 0; x < rW; x++)
          if (rawRegion[y][x]) {
            const k = rawRegion[y][x].mard;
            colorCount[k] = (colorCount[k]||0)+1;
          }
      const sorted = Object.entries(colorCount).sort((a,b)=>b[1]-a[1]);
      const allowedSet = new Set(sorted.slice(0, maxColor).map(([k])=>k));
      const allowedPalette = MARD_PALETTE.filter(c => allowedSet.has(c.mard));

      regionGrid = [];
      for (let y = 0; y < rH; y++) {
        regionGrid.push([]);
        for (let x = 0; x < rW; x++) {
          const c = rawRegion[y][x];
          if (!c) { regionGrid[y].push(null); continue; }
          if (allowedSet.has(c.mard)) { regionGrid[y].push(c); continue; }
          let best = null, bestDist = Infinity;
          for (const a of allowedPalette) {
            const dr=c.r-a.r, dg=c.g-a.g, db=c.b-a.b;
            const d=dr*dr+dg*dg+db*db;
            if (d<bestDist) { bestDist=d; best=a; }
          }
          regionGrid[y].push(best);
        }
      }

      // Render preview overlay
      renderPreviewOverlay();
      mode = 'previewing';
      canvasWrapper.classList.remove('selecting');
      canvasWrapper.classList.add('previewing');

      refineHint.textContent = `预览区域（${rW}×${rH} 格）`;
      refineActions.classList.remove('hidden');
    }, 20);
  }

  // ---- Preview overlay render ----
  function renderPreviewOverlay() {
    const { x0, y0, x1, y1 } = sel;
    const rW = x1 - x0 + 1;
    const rH = y1 - y0 + 1;
    const cell = window.RENDER_CELL;
    const showCode = document.getElementById('showCode').checked;
    const showGrid = document.getElementById('showGrid').checked;

    // Size preview canvas = region pixel size
    const PW = rW * cell, PH = rH * cell;
    prevCanvas.width  = PW;
    prevCanvas.height = PH;

    const ctx = prevCanvas.getContext('2d');
    ctx.clearRect(0, 0, PW, PH);

    // Draw region
    for (let ry = 0; ry < rH; ry++) {
      for (let rx = 0; rx < rW; rx++) {
        const c   = regionGrid[ry][rx];
        const px  = rx * cell, py = ry * cell;
        if (!c) {
          ctx.fillStyle = (rx+ry)%2===0 ? '#fff' : '#d8d8d8';
          ctx.fillRect(px, py, cell, cell);
          continue;
        }
        ctx.fillStyle = c.hex;
        ctx.fillRect(px, py, cell, cell);
        if (showCode) {
          const luma = 0.299*c.r + 0.587*c.g + 0.114*c.b;
          ctx.save();
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const fs = Math.floor(cell * 0.28);
          ctx.font = `bold ${fs}px 'Courier New', monospace`;
          ctx.shadowColor = luma>145 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = 2;
          ctx.fillStyle = luma>145 ? 'rgba(0,0,0,0.75)' : 'rgba(255,255,255,0.9)';
          ctx.fillText(c.mard, px + cell/2, py + cell/2);
          ctx.restore();
        }
      }
    }

    // Grid lines
    if (showGrid) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      for (let i = 0; i <= rW; i++) { ctx.moveTo(i*cell,0); ctx.lineTo(i*cell,PH); }
      for (let i = 0; i <= rH; i++) { ctx.moveTo(0,i*cell); ctx.lineTo(PW,i*cell); }
      ctx.stroke();
    }

    // Orange border
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, PW-3, PH-3);

    // Position and show
    syncOverlaySize(selCanvas); // keep sel overlay for dim effect
    positionPreviewCanvas();
    prevCanvas.classList.remove('hidden');

    // Keep dim overlay but no dashed selection box — redraw dim only
    const sctx = selCanvas.getContext('2d');
    sctx.clearRect(0, 0, selCanvas.width, selCanvas.height);
    sctx.fillStyle = 'rgba(0,0,0,0.3)';
    sctx.fillRect(0, 0, selCanvas.width, selCanvas.height);
    // Punch out region in display coords
    const oc = document.getElementById('outputCanvas');
    const rect = oc.getBoundingClientRect();
    const scaleX = rect.width  / window.gridW;
    const scaleY = rect.height / window.gridH;
    const dx = x0 * scaleX, dy = y0 * scaleY;
    const dw = rW * scaleX, dh = rH * scaleY;
    sctx.clearRect(dx, dy, dw, dh);
    selCanvas.classList.remove('hidden');
  }

  function positionPreviewCanvas() {
    const oc = document.getElementById('outputCanvas');
    const rect = oc.getBoundingClientRect();
    const wrapRect = canvasWrapper.getBoundingClientRect();
    const { x0, y0, x1, y1 } = sel;
    const rW = x1 - x0 + 1, rH = y1 - y0 + 1;
    const scaleX = rect.width  / window.gridW;
    const scaleY = rect.height / window.gridH;

    const left = rect.left - wrapRect.left + canvasWrapper.scrollLeft + x0 * scaleX;
    const top  = rect.top  - wrapRect.top  + canvasWrapper.scrollTop  + y0 * scaleY;
    const w    = rW * scaleX;
    const h    = rH * scaleY;

    prevCanvas.style.left   = left + 'px';
    prevCanvas.style.top    = top  + 'px';
    prevCanvas.style.width  = w + 'px';
    prevCanvas.style.height = h + 'px';
  }

  // ---- Actions ----
  // Merge
  refineMergeBtn.addEventListener('click', () => {
    if (!regionGrid || !sel) return;
    const { x0, y0, x1, y1 } = sel;
    for (let ry = 0; ry <= y1-y0; ry++)
      for (let rx = 0; rx <= x1-x0; rx++)
        window.beadGrid[y0+ry][x0+rx] = regionGrid[ry][rx];

    const fc = window.countColors();
    window.renderGrid(fc);
    window.renderPaletteList(fc);
    exitRefineMode();
  });

  // Discard
  refineDiscardBtn.addEventListener('click', () => {
    exitRefineMode();
  });

  // Regen
  refineRegenBtn.addEventListener('click', () => {
    if (!sel) return;
    mode = 'selected';
    prevCanvas.classList.add('hidden');
    refineActions.classList.add('hidden');
    canvasWrapper.classList.remove('previewing');
    regionGrid = null;
    generateRegion();
  });

  // Cancel selection
  refineCancelBtn.addEventListener('click', () => {
    exitRefineMode();
  });

  // ---- Expose hook so app.js can call after renderGrid ----
  window._refineExitOnNewGenerate = exitRefineMode;
})();
