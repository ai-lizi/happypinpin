/* ==========================================================
   crop.js — 图片裁剪模块
   提供 openCropModal(file, onConfirm) 全局接口
   ========================================================== */

(function () {
  // ---- DOM ----
  const modal      = document.getElementById('cropModal');
  const backdrop   = document.getElementById('cropBackdrop');
  const closeBtn   = document.getElementById('cropClose');
  const resetBtn   = document.getElementById('cropReset');
  const confirmBtn = document.getElementById('cropConfirm');
  const cropCanvas = document.getElementById('cropCanvas');
  const cropBox    = document.getElementById('cropBox');
  const stage      = document.getElementById('cropStage');
  const ratioBtns  = document.querySelectorAll('.ratio-btn');

  // ---- State ----
  let sourceImage  = null;   // HTMLImageElement (original)
  let onConfirmCb  = null;   // callback(croppedCanvas)
  let displayScale = 1;      // canvas display size / original image size
  let currentRatio = 'free'; // 'free' | number (w/h)

  // Box in display-px coordinates (relative to cropCanvas top-left)
  let box = { x: 0, y: 0, w: 100, h: 100 };

  // Drag state
  let drag = null;
  // drag = { type: 'move'|handle_dir, startX, startY, startBox }

  // ---- Public API ----
  window.openCropModal = function (imgEl, callback) {
    onConfirmCb = callback;
    currentRatio = 'free';
    ratioBtns.forEach(b => b.classList.toggle('active', b.dataset.ratio === 'free'));
    modal.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    initCanvas(imgEl);
  };

  // ---- Init canvas with source image ----
  function initCanvas(imgEl) {
    // Ensure image is ready: if incomplete, draw white and wait
    const isReady = imgEl.complete && imgEl.naturalWidth > 0;

    const maxW = stage.parentElement.clientWidth  - 0;
    const maxH = Math.min(window.innerHeight - 280, 520);

    const imgW = imgEl.naturalWidth  || imgEl.width  || 100;
    const imgH = imgEl.naturalHeight || imgEl.height || 100;

    displayScale = Math.min(maxW / imgW, maxH / imgH, 1);

    const dW = Math.max(100, Math.round(imgW * displayScale));
    const dH = Math.max(100, Math.round(imgH * displayScale));

    cropCanvas.width  = dW;
    cropCanvas.height = dH;
    cropCanvas.style.width  = dW + 'px';
    cropCanvas.style.height = dH + 'px';

    const ctx = cropCanvas.getContext('2d');

    if (!isReady) {
      // Image not ready yet: show white placeholder and wait
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, dW, dH);
      ctx.fillStyle = '#fff';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('加载中...', dW/2, dH/2);

      imgEl.onload = () => {
        sourceImage = imgEl;
        initCanvas(imgEl); // re-init once ready
      };
      // Initial box
      box = { x: 0, y: 0, w: dW, h: dH };
      updateBoxDOM();
      return;
    }

    // Image is ready
    sourceImage = imgEl;
    ctx.drawImage(sourceImage, 0, 0, dW, dH);

    // Default box: full image
    box = { x: 0, y: 0, w: dW, h: dH };
    applyRatio(currentRatio === 'free' ? null : parseFloat(currentRatio));
    updateBoxDOM();
  }

  // ---- Ratio change ----
  ratioBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ratioBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentRatio = btn.dataset.ratio;
      if (currentRatio === 'free') {
        applyRatio(null);
      } else {
        applyRatio(parseFloat(currentRatio));
      }
      updateBoxDOM();
    });
  });

  function applyRatio(ratio) {
    if (!ratio) return; // free — do nothing
    const cW = cropCanvas.width;
    const cH = cropCanvas.height;
    // Fit the ratio box maximally inside the canvas
    let bw = cW, bh = bw / ratio;
    if (bh > cH) { bh = cH; bw = bh * ratio; }
    bw = Math.round(bw); bh = Math.round(bh);
    box.w = bw; box.h = bh;
    // Center
    box.x = Math.round((cW - bw) / 2);
    box.y = Math.round((cH - bh) / 2);
  }

  // ---- Reset ----
  resetBtn.addEventListener('click', () => {
    box = { x: 0, y: 0, w: cropCanvas.width, h: cropCanvas.height };
    if (currentRatio !== 'free') applyRatio(parseFloat(currentRatio));
    updateBoxDOM();
  });

  // ---- Close ----
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  function closeModal() {
    modal.classList.add('hidden');
    backdrop.classList.add('hidden');
  }

  // ---- Confirm ----
  confirmBtn.addEventListener('click', () => {
    // Draw cropped region at original resolution
    const scaleBack = 1 / displayScale;
    const sx = Math.round(box.x * scaleBack);
    const sy = Math.round(box.y * scaleBack);
    const sw = Math.round(box.w * scaleBack);
    const sh = Math.round(box.h * scaleBack);

    const out = document.createElement('canvas');
    out.width  = sw;
    out.height = sh;
    out.getContext('2d').drawImage(
      sourceImage,
      sx, sy, sw, sh,
      0,  0,  sw, sh
    );
    closeModal();
    if (onConfirmCb) onConfirmCb(out);
  });

  // ---- DOM: position the cropBox ----
  function updateBoxDOM() {
    clampBox();
    cropBox.style.left   = box.x + 'px';
    cropBox.style.top    = box.y + 'px';
    cropBox.style.width  = box.w + 'px';
    cropBox.style.height = box.h + 'px';
  }

  function clampBox() {
    const cW = cropCanvas.width, cH = cropCanvas.height;
    const MIN = 20;
    box.w = Math.max(MIN, Math.min(box.w, cW));
    box.h = Math.max(MIN, Math.min(box.h, cH));
    box.x = Math.max(0, Math.min(box.x, cW - box.w));
    box.y = Math.max(0, Math.min(box.y, cH - box.h));
  }

  // ---- Drag interaction ----
  function getPos(e) {
    const rect = cropCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  // Move (drag crop box)
  cropBox.addEventListener('mousedown',  startDrag);
  cropBox.addEventListener('touchstart', startDrag, { passive: false });

  // Handles
  cropBox.querySelectorAll('.crop-handle').forEach(h => {
    h.addEventListener('mousedown',  e => startResize(e, h.dataset.dir));
    h.addEventListener('touchstart', e => startResize(e, h.dataset.dir), { passive: false });
  });

  function startDrag(e) {
    if (e.target.classList.contains('crop-handle')) return;
    e.preventDefault();
    const pos = getPos(e);
    drag = { type: 'move', startX: pos.x, startY: pos.y, startBox: { ...box } };
  }

  function startResize(e, dir) {
    e.preventDefault();
    e.stopPropagation();
    const pos = getPos(e);
    drag = { type: dir, startX: pos.x, startY: pos.y, startBox: { ...box } };
  }

  document.addEventListener('mousemove',  onDrag);
  document.addEventListener('touchmove',  onDrag, { passive: false });
  document.addEventListener('mouseup',    endDrag);
  document.addEventListener('touchend',   endDrag);

  function onDrag(e) {
    if (!drag) return;
    e.preventDefault();
    const pos = getPos(e);
    const dx = pos.x - drag.startX;
    const dy = pos.y - drag.startY;
    const sb = drag.startBox;
    const ratio = currentRatio === 'free' ? null : parseFloat(currentRatio);

    if (drag.type === 'move') {
      box.x = sb.x + dx;
      box.y = sb.y + dy;
    } else {
      const dir = drag.type;
      let nx = sb.x, ny = sb.y, nw = sb.w, nh = sb.h;

      if (dir.includes('l')) { nx = sb.x + dx; nw = sb.w - dx; }
      if (dir.includes('r')) { nw = sb.w + dx; }
      if (dir.includes('t')) { ny = sb.y + dy; nh = sb.h - dy; }
      if (dir.includes('b')) { nh = sb.h + dy; }

      // Enforce ratio if locked
      if (ratio) {
        if (dir === 'l' || dir === 'r') { nh = nw / ratio; }
        else if (dir === 't' || dir === 'b') { nw = nh * ratio; }
        else {
          // Corner: keep aspect by adjusting both
          const dMax = Math.max(Math.abs(nw - sb.w), Math.abs(nh - sb.h));
          if (dir === 'br') { nw = sb.w + dMax; nh = nw / ratio; }
          if (dir === 'bl') { nw = sb.w - dMax; nh = nw / ratio; nx = sb.x + (sb.w - nw); }
          if (dir === 'tr') { nw = sb.w + dMax; nh = nw / ratio; ny = sb.y + (sb.h - nh); }
          if (dir === 'tl') { nw = sb.w - dMax; nh = nw / ratio; nx = sb.x + (sb.w - nw); ny = sb.y + (sb.h - nh); }
        }
      }

      if (nw > 20 && nh > 20) {
        box.x = nx; box.y = ny; box.w = nw; box.h = nh;
      }
    }

    updateBoxDOM();
  }

  function endDrag() { drag = null; }
})();
