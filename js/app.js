// js/app.js - BingoVision v1.1.0

const video = document.getElementById('cameraVideo');
const cameraOverlay = document.getElementById('cameraOverlay');
const captureBtn = document.getElementById('captureBtn');
const strikeAllBtn = document.getElementById('strikeAllBtn');
const statusText = document.getElementById('statusText');
const imageUpload = document.getElementById('imageUpload');
const uploadBtn = document.getElementById('uploadBtn');
const addManualBtn = document.getElementById('addManualBtn');
const cardList = document.getElementById('cardList');
const clearAllBtn = document.getElementById('clearAllBtn');
const saveIndicator = document.getElementById('saveIndicator');
const freeToggle = document.getElementById('freeToggle');
const debugToggle = document.getElementById('debugToggle');
const debugPanel = document.getElementById('debugPanel');
const debugContent = document.getElementById('debugContent');
const colorSwatches = document.getElementById('colorSwatches');
const customColorPicker = document.getElementById('customColorPicker');
const addColorBtn = document.getElementById('addColorBtn');
const colorToleranceSlider = document.getElementById('colorTolerance');
const toleranceValSpan = document.getElementById('toleranceVal');

let nextCardId = 0;
let tesseractWorker = null;
let tesseractReady = false;
const cardStore = {};
let dragState = null;

// ============================================================
// Background Color Removal System
// ============================================================
let removeColors = [
    { hex: '#CB797F', active: true },
    { hex: '#7FA470', active: true },
    { hex: '#C85C80', active: true },
    { hex: '#DE9E20', active: true },
    { hex: '#C49114', active: true },
    { hex: '#2A4A18', active: true },
    { hex: '#7A1C5A', active: true },
    { hex: '#63154F', active: true },
    { hex: '#539ED5', active: true },
];

function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function colorDistSq(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db; // weighted, green-sensitive
}

function getActiveColorRgbs() {
    return removeColors.filter(c => c.active).map(c => hexToRgb(c.hex));
}

function getTolerance() { return parseInt(colorToleranceSlider.value, 10); }

function renderSwatches() {
    colorSwatches.innerHTML = '';
    removeColors.forEach((c, i) => {
        const el = document.createElement('div');
        el.className = 'color-swatch' + (c.active ? '' : ' inactive');
        el.style.backgroundColor = c.hex;
        el.title = c.hex + (c.active ? ' ✓ 啟用' : ' ✗ 停用') + '\n點擊切換';
        el.innerHTML = `<span class="swatch-x">✕</span><span class="swatch-label">${c.hex}</span>`;
        // Toggle active on click
        el.addEventListener('click', e => {
            if (e.target.classList.contains('swatch-x')) {
                removeColors.splice(i, 1);
            } else {
                c.active = !c.active;
            }
            renderSwatches(); saveToStorage();
        });
        colorSwatches.appendChild(el);
    });
}

addColorBtn.addEventListener('click', () => {
    const hex = customColorPicker.value.toUpperCase();
    if (removeColors.some(c => c.hex.toUpperCase() === hex)) return;
    removeColors.push({ hex, active: true });
    renderSwatches(); saveToStorage();
});

colorToleranceSlider.addEventListener('input', () => {
    toleranceValSpan.textContent = colorToleranceSlider.value;
    saveToStorage();
});

renderSwatches();

// ============================================================
// 1. Tesseract
// ============================================================
(async () => {
    try {
        statusText.innerText = '載入 OCR 引擎...';
        tesseractWorker = await Tesseract.createWorker('eng', 1, { logger: () => {} });
        await tesseractWorker.setParameters({
            tessedit_char_whitelist: '0123456789',
            tessedit_pageseg_mode: '7',
        });
        tesseractReady = true;
        statusText.innerText = '就緒！';
        statusText.style.color = '#3ba55d';
    } catch (e) {
        statusText.innerText = 'OCR 載入失敗';
        statusText.style.color = 'red';
    }
    loadFromStorage();
})();

// ============================================================
// 2. FREE Toggle
// ============================================================
function isFreeEnabled() { return freeToggle.checked; }

freeToggle.addEventListener('change', () => {
    document.querySelectorAll('.bingo-card').forEach(card => {
        const id = card.id.replace('card-', '');
        const inp = document.getElementById(`c${id}-2-2`);
        if (!inp) return;
        if (isFreeEnabled()) {
            inp.value = 'FREE'; inp.readOnly = true;
            inp.classList.add('free-cell');
        } else {
            inp.value = ''; inp.readOnly = false;
            inp.classList.remove('free-cell');
            inp.placeholder = '?';
        }
    });
    saveToStorage();
});

// ============================================================
// 3. Debug Toggle
// ============================================================
debugToggle.addEventListener('change', () => {
    debugPanel.style.display = debugToggle.checked ? 'block' : 'none';
});

// ============================================================
// 4. Camera Overlay (thicker, bolder lines)
// ============================================================
(async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1920 } }
        });
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', drawCamOverlay);
        setInterval(drawCamOverlay, 600);
    } catch { document.getElementById('cameraSection').style.display = 'none'; }
})();

function drawCamOverlay() {
    const cw = video.clientWidth, ch = video.clientHeight;
    if (!cw || !ch) return;
    cameraOverlay.width = cw; cameraOverlay.height = ch;
    const ctx = cameraOverlay.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    const gs = Math.min(cw, ch) * .78, gx = (cw - gs) / 2, gy = (ch - gs) / 2;

    // Dim outside
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(0, 0, cw, gy); ctx.fillRect(0, gy + gs, cw, ch - gy - gs);
    ctx.fillRect(0, gy, gx, gs); ctx.fillRect(gx + gs, gy, cw - gx - gs, gs);

    // Outer border - thick
    ctx.strokeStyle = 'rgba(0,255,0,.85)'; ctx.lineWidth = 3;
    ctx.strokeRect(gx, gy, gs, gs);

    // Inner grid - visible dashes
    ctx.setLineDash([8, 4]); ctx.strokeStyle = 'rgba(0,255,0,.6)'; ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(gx + gs / 5 * i, gy); ctx.lineTo(gx + gs / 5 * i, gy + gs); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, gy + gs / 5 * i); ctx.lineTo(gx + gs, gy + gs / 5 * i); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center';
    ctx.fillText('對齊 Bingo 卡', cw / 2, gy - 8);
    if (isFreeEnabled()) {
        const cs = gs / 5;
        ctx.fillText('FREE', gx + cs * 2.5, gy + cs * 2.5 + 4);
    }
}

// ============================================================
// 5. Upload Tip Modal
// ============================================================
const uploadTipModal = document.getElementById('uploadTipModal');
const uploadTipDismiss = document.getElementById('uploadTipDismiss');
const uploadTipOk = document.getElementById('uploadTipOk');
let _pendingUploadAction = null;

function shouldShowUploadTip() {
    return localStorage.getItem('bingo_hide_upload_tip') !== '1';
}

function showUploadTip(onConfirm) {
    if (!shouldShowUploadTip()) { onConfirm(); return; }
    _pendingUploadAction = onConfirm;
    uploadTipDismiss.checked = false;
    uploadTipModal.style.display = 'flex';
}

uploadTipOk.addEventListener('click', () => {
    if (uploadTipDismiss.checked) {
        localStorage.setItem('bingo_hide_upload_tip', '1');
    }
    uploadTipModal.style.display = 'none';
    if (_pendingUploadAction) { _pendingUploadAction(); _pendingUploadAction = null; }
});

// Close modal on overlay click
uploadTipModal.addEventListener('click', e => {
    if (e.target === uploadTipModal) {
        uploadTipModal.style.display = 'none';
        _pendingUploadAction = null;
    }
});

// ============================================================
// 6. Capture / Upload / Manual
// ============================================================
captureBtn.addEventListener('click', () => {
    showUploadTip(() => {
        if (!video.srcObject) return;
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        const url = c.toDataURL('image/jpeg', .8);
        const id = addCard({ imageDataUrl: url });
        if (tesseractReady) setTimeout(() => runOCR(id), 200);
    });
});

uploadBtn.addEventListener('click', () => {
    showUploadTip(() => imageUpload.click());
});
imageUpload.addEventListener('change', e => {
    Array.from(e.target.files).forEach(file => {
        const r = new FileReader();
        r.onload = ev => {
            const id = addCard({ imageDataUrl: ev.target.result });
            if (tesseractReady) setTimeout(() => runOCR(id), 200);
        };
        r.readAsDataURL(file);
    });
    imageUpload.value = '';
});

addManualBtn.addEventListener('click', () => addCard({ isManual: true }));

clearAllBtn.addEventListener('click', () => {
    if (!confirm('確定清除全部卡片？')) return;
    cardList.innerHTML = '';
    Object.keys(cardStore).forEach(k => delete cardStore[k]);
    nextCardId = 0;
    debugContent.innerHTML = '';
    localStorage.removeItem('bingo_cards');
    localStorage.removeItem('bingo_targets');
    statusText.innerText = '已清除'; statusText.style.color = '#8b949e';
});

// ============================================================
// 6. Add Card
// ============================================================
function addCard(opts = {}) {
    const id = nextCardId++;
    const corners = opts.corners || { tl:{x:8,y:18}, tr:{x:92,y:18}, bl:{x:8,y:92}, br:{x:92,y:92} };
    const isManual = !!opts.isManual;
    const imageDataUrl = opts.imageDataUrl || null;
    const values = opts.values || null;

    cardStore[id] = { corners, srcCanvas: null, imageDataUrl, isManual };

    if (imageDataUrl && !isManual) {
        const img = new Image();
        img.src = imageDataUrl;
        img.onload = () => {
            // Auto-upscale small images for better OCR
            const minDim = Math.min(img.width, img.height);
            const OCR_MIN = 800;
            let scale = 1;
            if (minDim < OCR_MIN) {
                scale = Math.ceil(OCR_MIN / minDim);
                scale = Math.min(scale, 6); // cap at 6x
            }
            const c = document.createElement('canvas');
            c.width = img.width * scale; c.height = img.height * scale;
            const ctx = c.getContext('2d');
            // Use bicubic-like smoothing for upscale
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, c.width, c.height);
            cardStore[id].srcCanvas = c;
            if (scale > 1) console.log(`[OCR] Upscaled ${img.width}x${img.height} → ${c.width}x${c.height} (${scale}x)`);
        };
    }

    const card = document.createElement('div');
    card.className = 'bingo-card'; card.id = `card-${id}`;

    const imageContent = isManual
        ? `<canvas class="gen-card" id="genCanvas-${id}" width="300" height="300"></canvas>`
        : `<img src="${imageDataUrl}" id="img-${id}">`;

    card.innerHTML = `
        <div class="card-header">
            <span>🎴 卡片 #${id + 1}</span>
            <div class="card-actions">
                ${!isManual ? `<button class="btn-ocr" id="ocrBtn-${id}" onclick="runOCR(${id})" ${!tesseractReady?'disabled':''}>🔍 辨識</button>` : ''}
                <button class="btn-delete" onclick="deleteCard(${id})">✕</button>
            </div>
        </div>
        <div class="card-body">
            <div class="card-image-box" id="imgBox-${id}">
                ${imageContent}
                <canvas class="strike-canvas" id="strikeC-${id}"></canvas>
                ${!isManual ? `
                <svg class="grid-overlay" id="svg-${id}"></svg>
                <div class="handle" data-card="${id}" data-corner="tl"></div>
                <div class="handle" data-card="${id}" data-corner="tr"></div>
                <div class="handle" data-card="${id}" data-corner="bl"></div>
                <div class="handle" data-card="${id}" data-corner="br"></div>` : ''}
            </div>
            <div class="card-grid-wrap">
                <div class="bingo-grid" id="grid-${id}">${buildInputs(id)}</div>
            </div>
        </div>
        <div class="card-result" id="result-${id}" style="display:none;">
            <span class="lines-badge no-lines" id="badge-${id}">0 條線</span>
            <span class="line-detail" id="detail-${id}"></span>
        </div>`;

    cardList.appendChild(card);

    if (values) {
        for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2 && isFreeEnabled()) continue;
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                if (inp && values[r][c] && values[r][c] !== 'FREE') inp.value = values[r][c];
            }
    }

    document.querySelectorAll(`#grid-${id} input`).forEach(inp => {
        inp.addEventListener('input', () => {
            saveToStorage();
            if (isManual) drawGeneratedCard(id);
        });
    });

    if (!isManual) {
        const imgEl = document.getElementById(`img-${id}`);
        const setup = () => { updateCardGrid(id); positionHandles(id); };
        imgEl.addEventListener('load', setup);
        if (imgEl.complete) setup();
    } else {
        drawGeneratedCard(id);
    }

    saveToStorage();
    return id;
}

function buildInputs(cid) {
    let h = '';
    const free = isFreeEnabled();
    for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++) {
            if (r === 2 && c === 2 && free) {
                h += `<input type="text" class="free-cell" value="FREE" readonly id="c${cid}-${r}-${c}">`;
            } else {
                h += `<input type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*"
                    id="c${cid}-${r}-${c}" placeholder="?" onfocus="this.select()">`;
            }
        }
    return h;
}

function deleteCard(id) {
    document.getElementById(`card-${id}`)?.remove();
    delete cardStore[id];
    saveToStorage();
}
window.runOCR = runOCR;
window.deleteCard = deleteCard;

// ============================================================
// 7. Generated Visual Card (manual)
// ============================================================
function drawGeneratedCard(id) {
    const cv = document.getElementById(`genCanvas-${id}`);
    if (!cv) return;
    const size = 300; cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    const cs = size / 5;
    ctx.fillStyle = '#f5f5f0'; ctx.fillRect(0, 0, size, size);

    const colors = ['#ff9800','#2196f3','#e91e63','#9c27b0','#4caf50',
                     '#ff5722','#00bcd4','#f44336','#3f51b5','#8bc34a'];

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cx = c * cs + cs / 2, cy = r * cs + cs / 2;
            const rad = cs * .42;
            ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
            ctx.fillStyle = colors[(r * 5 + c) % colors.length] + '33'; ctx.fill();
            ctx.strokeStyle = colors[(r * 5 + c) % colors.length];
            ctx.lineWidth = 2; ctx.stroke();

            let val = '';
            if (r === 2 && c === 2 && isFreeEnabled()) { val = 'FREE'; }
            else {
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                val = inp?.value.trim() || '';
            }
            ctx.fillStyle = '#000';
            ctx.font = `bold ${val === 'FREE' ? 12 : 18}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(val, cx, cy);
        }
    }
}

// ============================================================
// 8. Grid Overlay SVG — THICK & BOLD
// ============================================================
function lerp(a, b, t) { return a + (b - a) * t; }
function gridPt(tl, tr, bl, br, u, v) {
    return {
        x: lerp(lerp(tl.x, tr.x, u), lerp(bl.x, br.x, u), v),
        y: lerp(lerp(tl.y, tr.y, u), lerp(bl.y, br.y, u), v)
    };
}

function updateCardGrid(id) {
    const box = document.getElementById(`imgBox-${id}`);
    const svg = document.getElementById(`svg-${id}`);
    if (!box || !svg) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    const cn = cardStore[id]?.corners; if (!cn) return;

    const tl = {x:cn.tl.x/100*w, y:cn.tl.y/100*h};
    const tr = {x:cn.tr.x/100*w, y:cn.tr.y/100*h};
    const bl = {x:cn.bl.x/100*w, y:cn.bl.y/100*h};
    const br = {x:cn.br.x/100*w, y:cn.br.y/100*h};

    // Outer: thick solid bright green
    let s = `<polygon points="${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}"
        fill="none" stroke="rgba(0,255,0,.85)" stroke-width="3"/>`;

    // Inner: thick dashed
    for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const l = gridPt(tl,tr,bl,br,0,t), r2 = gridPt(tl,tr,bl,br,1,t);
        s += `<line x1="${l.x}" y1="${l.y}" x2="${r2.x}" y2="${r2.y}"
            stroke="rgba(0,255,0,.6)" stroke-width="2" stroke-dasharray="6,3"/>`;
        const t2 = gridPt(tl,tr,bl,br,t,0), b2 = gridPt(tl,tr,bl,br,t,1);
        s += `<line x1="${t2.x}" y1="${t2.y}" x2="${b2.x}" y2="${b2.y}"
            stroke="rgba(0,255,0,.6)" stroke-width="2" stroke-dasharray="6,3"/>`;
    }

    // FREE label if enabled
    if (isFreeEnabled()) {
        const ct = gridPt(tl,tr,bl,br,.5,.5);
        s += `<text x="${ct.x}" y="${ct.y}" fill="rgba(255,255,255,.5)" font-size="11" font-weight="bold"
            text-anchor="middle" dominant-baseline="middle">FREE</text>`;
    }

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = s;
}

function positionHandles(id) {
    const box = document.getElementById(`imgBox-${id}`); if (!box) return;
    const cn = cardStore[id]?.corners; if (!cn) return;
    box.querySelectorAll('.handle').forEach(h => {
        h.style.left = cn[h.dataset.corner].x + '%';
        h.style.top = cn[h.dataset.corner].y + '%';
    });
}

// Global drag
document.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle'); if (!h) return;
    e.preventDefault();
    dragState = { cardId: parseInt(h.dataset.card), corner: h.dataset.corner, box: h.closest('.card-image-box') };
    h.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
    if (!dragState) return; e.preventDefault();
    const rect = dragState.box.getBoundingClientRect();
    let px = Math.max(1, Math.min(99, ((e.clientX - rect.left) / rect.width) * 100));
    let py = Math.max(1, Math.min(99, ((e.clientY - rect.top) / rect.height) * 100));
    cardStore[dragState.cardId].corners[dragState.corner] = {x:px, y:py};
    positionHandles(dragState.cardId);
    updateCardGrid(dragState.cardId);
});
document.addEventListener('pointerup', () => { if (dragState) { saveToStorage(); dragState = null; } });

// ============================================================
// 9. OCR — Enhanced for patterned/colored backgrounds
// ============================================================
async function runOCR(id) {
    if (!tesseractReady) return;
    const store = cardStore[id];
    if (!store?.srcCanvas) { setTimeout(() => runOCR(id), 500); return; }

    const btn = document.getElementById(`ocrBtn-${id}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }

    const src = store.srcCanvas;
    const sw = src.width, sh = src.height;
    const cn = store.corners;
    const tl = {x:cn.tl.x/100*sw, y:cn.tl.y/100*sh};
    const tr = {x:cn.tr.x/100*sw, y:cn.tr.y/100*sh};
    const bl = {x:cn.bl.x/100*sw, y:cn.bl.y/100*sh};
    const br = {x:cn.br.x/100*sw, y:cn.br.y/100*sh};

    // Debug: prepare grid canvas
    const isDebug = debugToggle.checked;
    const dbgSize = 80;
    let dbgCv, dbgCtx;
    if (isDebug) {
        dbgCv = document.createElement('canvas');
        dbgCv.width = dbgSize * 5 + 6; dbgCv.height = dbgSize * 5 + 6;
        dbgCtx = dbgCv.getContext('2d');
        dbgCtx.fillStyle = '#111'; dbgCtx.fillRect(0, 0, dbgCv.width, dbgCv.height);
    }

    let detected = 0;
    const skipCenter = isFreeEnabled();

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            const dbgX = col * (dbgSize + 1) + 1;
            const dbgY = row * (dbgSize + 1) + 1;

            if (row === 2 && col === 2 && skipCenter) {
                if (isDebug) {
                    dbgCtx.fillStyle = '#333'; dbgCtx.fillRect(dbgX, dbgY, dbgSize, dbgSize);
                    dbgCtx.fillStyle = '#fff'; dbgCtx.font = 'bold 12px Arial'; dbgCtx.textAlign = 'center';
                    dbgCtx.fillText('FREE', dbgX + dbgSize/2, dbgY + dbgSize/2 + 4);
                }
                continue;
            }

            const inp = document.getElementById(`c${id}-${row}-${col}`);
            if (!inp) continue;
            const existing = inp.value.trim();
            if (/^\d{1,2}$/.test(existing) && !inp.classList.contains('ocr-fail')) {
                if (isDebug) {
                    dbgCtx.fillStyle = '#1a1a2e'; dbgCtx.fillRect(dbgX, dbgY, dbgSize, dbgSize);
                    dbgCtx.fillStyle = '#3ba55d'; dbgCtx.font = 'bold 16px Arial'; dbgCtx.textAlign = 'center';
                    dbgCtx.fillText(existing, dbgX + dbgSize/2, dbgY + dbgSize/2 + 5);
                }
                detected++;
                continue;
            }

            // Cell bounds with 12% inset (lighter to preserve digits in small images)
            const inset = .12;
            const p1 = gridPt(tl,tr,bl,br,(col+inset)/5,(row+inset)/5);
            const p2 = gridPt(tl,tr,bl,br,(col+1-inset)/5,(row+1-inset)/5);
            const cw = p2.x - p1.x, ch = p2.y - p1.y;
            if (cw < 5 || ch < 5) continue;

            const cellCv = prepareCell(src, p1.x, p1.y, cw, ch);

            // Debug: draw processed cell
            if (isDebug) {
                dbgCtx.drawImage(cellCv, 0, 0, cellCv.width, cellCv.height, dbgX, dbgY, dbgSize, dbgSize);
            }

            try {
                const ret = await tesseractWorker.recognize(cellCv.toDataURL('image/png'));
                const raw = ret.data.text.trim(), conf = ret.data.confidence;
                const num = parseInt(raw, 10);
                inp.classList.remove('ocr-low', 'ocr-fail');
                if (!isNaN(num) && num >= 1 && num <= 75 && raw.length <= 2 && conf > 15) {
                    inp.value = num; detected++;
                    if (conf < 50) inp.classList.add('ocr-low');
                    if (isDebug) {
                        dbgCtx.fillStyle = '#44ff44'; dbgCtx.font = 'bold 11px Arial'; dbgCtx.textAlign = 'center';
                        dbgCtx.fillText(`${num} (${conf.toFixed(0)}%)`, dbgX + dbgSize/2, dbgY + dbgSize - 3);
                    }
                } else {
                    inp.value = ''; inp.placeholder = raw || '?'; inp.classList.add('ocr-fail');
                    if (isDebug) {
                        dbgCtx.fillStyle = '#ff4444'; dbgCtx.font = '10px Arial'; dbgCtx.textAlign = 'center';
                        dbgCtx.fillText(`"${raw}" ${conf.toFixed(0)}%`, dbgX + dbgSize/2, dbgY + dbgSize - 3);
                    }
                }
            } catch { inp.classList.add('ocr-fail'); }
        }
        statusText.innerText = `卡 #${id+1} 辨識 ${(row+1)*5}/25`;
        statusText.style.color = '#ffcc00';
    }

    // Show debug
    if (isDebug && dbgCv) {
        let section = document.getElementById(`dbg-${id}`);
        if (!section) {
            section = document.createElement('div');
            section.className = 'debug-card-section'; section.id = `dbg-${id}`;
            debugContent.appendChild(section);
        }
        section.innerHTML = `<p>卡片 #${id+1} — ${detected}/24 辨識</p>`;
        dbgCv.className = 'debug-grid-canvas';
        section.appendChild(dbgCv);
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '🔍 辨識'; }
    statusText.innerText = `卡 #${id+1}：${detected}/24 數字`;
    statusText.style.color = detected >= 18 ? '#3ba55d' : '#ffcc00';
    saveToStorage();
}

// ============================================================
// 10. Cell Preparation — Enhanced for patterned backgrounds
// ============================================================
// Strategy: Extract dark pixels regardless of background color
// 1. Convert to grayscale using min-channel (darkest component)
// 2. High-contrast stretch (spread histogram)
// 3. Otsu threshold
// 4. Morphological clean (remove thin noise)
// 5. Center crop (remove residual border)
// 6. Scale up with padding

function prepareCell(src, cx, cy, cw, ch) {
    const cropW = Math.max(1, Math.round(cw));
    const cropH = Math.max(1, Math.round(ch));

    const crop = document.createElement('canvas');
    crop.width = cropW; crop.height = cropH;
    const ctx = crop.getContext('2d');
    ctx.drawImage(src, Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch), 0, 0, cropW, cropH);

    const imgData = ctx.getImageData(0, 0, cropW, cropH);
    const px = imgData.data;

    // --- Step 0: Remove background colors (paint matching pixels white) ---
    const activeRgbs = getActiveColorRgbs();
    if (activeRgbs.length > 0) {
        const tol = getTolerance();
        const tolSq = tol * tol * 9; // scale for weighted distance
        for (let i = 0; i < px.length; i += 4) {
            const r = px[i], g = px[i+1], b = px[i+2];
            // Skip already-dark pixels (likely text) — keep anything with luminance < 60
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum < 60) continue;
            for (let k = 0; k < activeRgbs.length; k++) {
                const [cr, cg, cb] = activeRgbs[k];
                if (colorDistSq(r, g, b, cr, cg, cb) < tolSq) {
                    px[i] = 255; px[i+1] = 255; px[i+2] = 255;
                    break;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }

    // --- Step 1: Min-channel grayscale ---
    // Re-read after color removal
    const imgData2 = ctx.getImageData(0, 0, cropW, cropH);
    const px2 = imgData2.data;
    const gv = new Uint8Array(cropW * cropH);
    for (let i = 0, j = 0; i < px2.length; i += 4, j++) {
        const minVal = Math.min(px2[i], px2[i+1], px2[i+2]);
        gv[j] = minVal;
    }

    // --- Step 2: Contrast stretch ---
    let lo = 255, hi = 0;
    for (let i = 0; i < gv.length; i++) {
        if (gv[i] < lo) lo = gv[i];
        if (gv[i] > hi) hi = gv[i];
    }
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < gv.length; i++) {
        gv[i] = Math.round(((gv[i] - lo) / range) * 255);
    }

    // --- Step 3: Otsu threshold ---
    const th = otsu(gv);

    // --- Step 4: Apply threshold → black text on white ---
    for (let i = 0, j = 0; i < px2.length; i += 4, j++) {
        const v = gv[j] < th ? 0 : 255;
        px2[i] = v; px2[i+1] = v; px2[i+2] = v; px2[i+3] = 255;
    }
    ctx.putImageData(imgData2, 0, 0);

    // --- Step 4.5: Remove grid lines (thin black edges) ---
    // Scan outer rows/cols: if >50% black, it's a grid line → paint white
    const edgeData = ctx.getImageData(0, 0, cropW, cropH);
    const ep = edgeData.data;
    const edgeScan = Math.max(2, Math.round(Math.min(cropW, cropH) * 0.12));

    // Horizontal lines (top & bottom edges)
    for (let y = 0; y < cropH; y++) {
        if (y >= edgeScan && y < cropH - edgeScan) continue;
        let darkCount = 0;
        for (let x = 0; x < cropW; x++) {
            if (ep[(y * cropW + x) * 4] === 0) darkCount++;
        }
        if (darkCount > cropW * 0.5) {
            for (let x = 0; x < cropW; x++) {
                const idx = (y * cropW + x) * 4;
                ep[idx] = 255; ep[idx+1] = 255; ep[idx+2] = 255;
            }
        }
    }
    // Vertical lines (left & right edges)
    for (let x = 0; x < cropW; x++) {
        if (x >= edgeScan && x < cropW - edgeScan) continue;
        let darkCount = 0;
        for (let y = 0; y < cropH; y++) {
            if (ep[(y * cropW + x) * 4] === 0) darkCount++;
        }
        if (darkCount > cropH * 0.5) {
            for (let y = 0; y < cropH; y++) {
                const idx = (y * cropW + x) * 4;
                ep[idx] = 255; ep[idx+1] = 255; ep[idx+2] = 255;
            }
        }
    }
    ctx.putImageData(edgeData, 0, 0);

    // --- Step 5: Morphological open (remove thin noise) ---
    // Simple 1-pass: if a black pixel has < 3 black neighbors, make it white
    const cleaned = ctx.getImageData(0, 0, cropW, cropH);
    const cp = cleaned.data;
    for (let y = 1; y < cropH - 1; y++) {
        for (let x = 1; x < cropW - 1; x++) {
            const idx = (y * cropW + x) * 4;
            if (cp[idx] === 0) { // black pixel
                let neighbors = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dy === 0 && dx === 0) continue;
                        if (cp[((y+dy)*cropW+(x+dx))*4] === 0) neighbors++;
                    }
                if (neighbors < 2) { cp[idx] = 255; cp[idx+1] = 255; cp[idx+2] = 255; }
            }
        }
    }
    ctx.putImageData(cleaned, 0, 0);

    // --- Step 6: Center crop (remove 8% border residual) ---
    const trim = 0.08;
    const tx = Math.round(cropW * trim), ty = Math.round(cropH * trim);
    const tw = cropW - tx * 2, th2 = cropH - ty * 2;

    // --- Step 7: Scale up + pad ---
    const targetH = 150;
    const sc = Math.max(1, targetH / th2);
    const sw = Math.round(tw * sc), sh = Math.round(th2 * sc);
    const pad = 25;
    const fin = document.createElement('canvas');
    fin.width = sw + pad * 2; fin.height = sh + pad * 2;
    const fc = fin.getContext('2d');
    fc.imageSmoothingEnabled = false;
    fc.fillStyle = '#fff'; fc.fillRect(0, 0, fin.width, fin.height);
    fc.drawImage(crop, tx, ty, tw, th2, pad, pad, sw, sh);
    return fin;
}

function otsu(vals) {
    const hist = new Array(256).fill(0);
    for (let i = 0; i < vals.length; i++) hist[vals[i]]++;
    const n = vals.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue;
        const wF = n - wB; if (!wF) break;
        sB += t * hist[t];
        const d = sB / wB - (sum - sB) / wF;
        if (wB * wF * d * d > best) { best = wB * wF * d * d; th = t; }
    }
    return th;
}

// ============================================================
// 11. Strike All
// ============================================================
strikeAllBtn.addEventListener('click', () => {
    const targets = document.getElementById('targetNumbers').value
        .split(',').map(n => n.trim()).filter(n => n.length > 0);
    if (!targets.length) return alert('請輸入已開出號碼');

    const cards = document.querySelectorAll('.bingo-card');
    if (!cards.length) return alert('請先新增卡片');

    let totalLines = 0, cardIdx = 0;
    const summaryParts = [];

    cards.forEach(card => {
        cardIdx++;
        const id = card.id.replace('card-', '');
        const store = cardStore[id]; if (!store) return;

        const grid = Array.from({length:5}, () => Array(5).fill(false));
        if (isFreeEnabled()) grid[2][2] = true;

        for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2 && isFreeEnabled()) continue;
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                if (!inp) continue;
                inp.classList.remove('hit');
                if (targets.includes(inp.value.trim())) {
                    grid[r][c] = true;
                    inp.classList.add('hit');
                }
            }

        let lines = 0;
        const completedLines = [];
        for (let r = 0; r < 5; r++) if (grid[r].every(v => v)) { lines++; completedLines.push({type:'row', index:r}); }
        for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every(r => grid[r][c])) { lines++; completedLines.push({type:'col', index:c}); }
        if ([0,1,2,3,4].every(i => grid[i][i])) { lines++; completedLines.push({type:'diag', index:0}); }
        if ([0,1,2,3,4].every(i => grid[i][4-i])) { lines++; completedLines.push({type:'diag', index:1}); }

        drawStrikesOnImage(id, grid, completedLines);

        const details = completedLines.map(l =>
            l.type === 'row' ? `橫${l.index+1}` : l.type === 'col' ? `直${l.index+1}` : l.index === 0 ? '↘斜' : '↙斜'
        );
        const res = document.getElementById(`result-${id}`);
        const badge = document.getElementById(`badge-${id}`);
        const detail = document.getElementById(`detail-${id}`);
        res.style.display = 'flex';
        badge.textContent = `${lines} 條線`;
        badge.className = 'lines-badge ' + (lines > 0 ? 'has-lines' : 'no-lines');
        detail.textContent = lines > 0 ? details.join('、') : '尚未連線';
        totalLines += lines;

        const lineInfo = lines > 0 ? `（${details.join('、')}）` : '';
        summaryParts.push(`卡片 #${cardIdx}，共 ${lines} 條${lineInfo}`);

        if (store.isManual) drawGeneratedCard(parseInt(id));
    });

    statusText.innerHTML = summaryParts.map(s => {
        const has = !s.includes('共 0 條');
        return `<span style="color:${has ? '#ff4d4d' : '#8b949e'}">${s}</span>`;
    }).join('<br>');
    saveToStorage();
});

// ============================================================
// 12. Draw Strikes & Lines on Image
// ============================================================
function drawStrikesOnImage(id, grid, completedLines) {
    const box = document.getElementById(`imgBox-${id}`);
    const strikeC = document.getElementById(`strikeC-${id}`);
    if (!box || !strikeC) return;

    const w = box.clientWidth, h = box.clientHeight;
    strikeC.width = w; strikeC.height = h;
    const ctx = strikeC.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const store = cardStore[id];
    let tl, tr, bl, br;
    if (store && !store.isManual) {
        const cn = store.corners;
        tl = {x:cn.tl.x/100*w, y:cn.tl.y/100*h}; tr = {x:cn.tr.x/100*w, y:cn.tr.y/100*h};
        bl = {x:cn.bl.x/100*w, y:cn.bl.y/100*h}; br = {x:cn.br.x/100*w, y:cn.br.y/100*h};
    } else {
        tl = {x:0,y:0}; tr = {x:w,y:0}; bl = {x:0,y:h}; br = {x:w,y:h};
    }

    // X marks
    for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++) {
            if (!grid[r][c] || (r === 2 && c === 2 && isFreeEnabled())) continue;
            const center = gridPt(tl,tr,bl,br,(c+.5)/5,(r+.5)/5);
            const c1 = gridPt(tl,tr,bl,br,c/5,r/5);
            const c2 = gridPt(tl,tr,bl,br,(c+1)/5,(r+1)/5);
            const sz = Math.min(c2.x-c1.x, c2.y-c1.y);
            const arm = sz * .28;
            ctx.save();
            ctx.strokeStyle = 'rgba(255,60,60,.88)';
            ctx.lineWidth = Math.max(2, sz * .08);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(center.x-arm, center.y-arm); ctx.lineTo(center.x+arm, center.y+arm);
            ctx.moveTo(center.x+arm, center.y-arm); ctx.lineTo(center.x-arm, center.y+arm);
            ctx.stroke(); ctx.restore();
        }

    // Bingo lines
    const lineColors = ['#ffe600','#00ff88','#ff00ff','#00ccff','#ff8800'];
    completedLines.forEach((line, idx) => {
        const color = lineColors[idx % lineColors.length];
        ctx.save();
        ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.globalAlpha = .85;

        let s, e;
        if (line.type === 'row') {
            s = gridPt(tl,tr,bl,br,.02,(line.index+.5)/5);
            e = gridPt(tl,tr,bl,br,.98,(line.index+.5)/5);
        } else if (line.type === 'col') {
            s = gridPt(tl,tr,bl,br,(line.index+.5)/5,.02);
            e = gridPt(tl,tr,bl,br,(line.index+.5)/5,.98);
        } else if (line.index === 0) {
            s = gridPt(tl,tr,bl,br,.02,.02); e = gridPt(tl,tr,bl,br,.98,.98);
        } else {
            s = gridPt(tl,tr,bl,br,.98,.02); e = gridPt(tl,tr,bl,br,.02,.98);
        }
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
        ctx.restore();
    });
}

// ============================================================
// 13. LocalStorage
// ============================================================
function saveToStorage() {
    try {
        const data = [];
        document.querySelectorAll('.bingo-card').forEach(card => {
            const id = card.id.replace('card-', '');
            const store = cardStore[id]; if (!store) return;
            const values = [];
            for (let r = 0; r < 5; r++) {
                const row = [];
                for (let c = 0; c < 5; c++) {
                    if (r === 2 && c === 2 && isFreeEnabled()) { row.push('FREE'); continue; }
                    const inp = document.getElementById(`c${id}-${r}-${c}`);
                    row.push(inp ? inp.value.trim() : '');
                }
                values.push(row);
            }
            data.push({
                corners: store.corners, isManual: store.isManual,
                imageDataUrl: store.imageDataUrl, values
            });
        });
        localStorage.setItem('bingo_cards', JSON.stringify(data));
        localStorage.setItem('bingo_targets', document.getElementById('targetNumbers').value);
        localStorage.setItem('bingo_free', isFreeEnabled() ? '1' : '0');
        localStorage.setItem('bingo_colors', JSON.stringify(removeColors));
        localStorage.setItem('bingo_tolerance', colorToleranceSlider.value);
        saveIndicator.classList.add('show');
        setTimeout(() => saveIndicator.classList.remove('show'), 1500);
    } catch (e) { console.warn('Save failed:', e); }
}

function loadFromStorage() {
    try {
        const targets = localStorage.getItem('bingo_targets');
        if (targets) document.getElementById('targetNumbers').value = targets;

        const free = localStorage.getItem('bingo_free');
        if (free !== null) freeToggle.checked = free === '1';

        // Load color settings — merge saved state with code defaults
        const savedColors = localStorage.getItem('bingo_colors');
        if (savedColors) {
            try {
                const parsed = JSON.parse(savedColors);
                if (Array.isArray(parsed)) {
                    // Build a map of saved hex → active state
                    const savedMap = {};
                    parsed.forEach(c => { savedMap[c.hex.toUpperCase()] = c.active; });
                    // Apply saved active state to code defaults, keep new ones
                    removeColors.forEach(c => {
                        const key = c.hex.toUpperCase();
                        if (key in savedMap) c.active = savedMap[key];
                    });
                    // Also add any user-added colors not in code defaults
                    const defaultHexes = new Set(removeColors.map(c => c.hex.toUpperCase()));
                    parsed.forEach(c => {
                        if (!defaultHexes.has(c.hex.toUpperCase())) {
                            removeColors.push({ hex: c.hex, active: c.active });
                        }
                    });
                    renderSwatches();
                }
            } catch {}
        }
        const savedTol = localStorage.getItem('bingo_tolerance');
        if (savedTol) {
            colorToleranceSlider.value = savedTol;
            toleranceValSpan.textContent = savedTol;
        }

        const raw = localStorage.getItem('bingo_cards');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return;
        data.forEach(item => addCard({
            corners: item.corners, isManual: item.isManual,
            imageDataUrl: item.imageDataUrl, values: item.values
        }));
        if (data.length > 0) {
            statusText.innerText = `已載入 ${data.length} 張卡片`;
            statusText.style.color = '#3ba55d';
        }
    } catch (e) { console.warn('Load failed:', e); }
}

document.getElementById('targetNumbers').addEventListener('input', () => saveToStorage());