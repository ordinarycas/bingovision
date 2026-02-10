// js/app.js - BingoVision: Full featured

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

let nextCardId = 0;
let tesseractWorker = null;
let tesseractReady = false;

// Per-card store: { corners, srcCanvas, imageDataUrl, isManual }
const cardStore = {};
let dragState = null;

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
    // Load saved data after tesseract is ready (or failed)
    loadFromStorage();
})();

// ============================================================
// 2. Camera Overlay
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
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, cw, gy); ctx.fillRect(0, gy + gs, cw, ch - gy - gs);
    ctx.fillRect(0, gy, gx, gs); ctx.fillRect(gx + gs, gy, cw - gx - gs, gs);
    ctx.strokeStyle = 'rgba(88,255,88,.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, gy, gs, gs);
    ctx.setLineDash([5, 3]); ctx.strokeStyle = 'rgba(88,255,88,.4)';
    for (let i = 1; i < 5; i++) {
        ctx.beginPath(); ctx.moveTo(gx + gs / 5 * i, gy); ctx.lineTo(gx + gs / 5 * i, gy + gs); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, gy + gs / 5 * i); ctx.lineTo(gx + gs, gy + gs / 5 * i); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '11px Arial'; ctx.textAlign = 'center';
    ctx.fillText('對齊 Bingo 卡', cw / 2, gy - 6);
}

// ============================================================
// 3. Capture / Upload / Manual
// ============================================================
captureBtn.addEventListener('click', () => {
    if (!video.srcObject) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    const url = c.toDataURL('image/jpeg', .8);
    const id = addCard({ imageDataUrl: url });
    if (tesseractReady) setTimeout(() => runOCR(id), 200);
});

uploadBtn.addEventListener('click', () => imageUpload.click());
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

addManualBtn.addEventListener('click', () => {
    addCard({ isManual: true });
});

clearAllBtn.addEventListener('click', () => {
    if (!confirm('確定清除全部卡片？')) return;
    cardList.innerHTML = '';
    Object.keys(cardStore).forEach(k => delete cardStore[k]);
    nextCardId = 0;
    localStorage.removeItem('bingo_cards');
    localStorage.removeItem('bingo_targets');
    statusText.innerText = '已清除'; statusText.style.color = '#8b949e';
});

// ============================================================
// 4. Add Card (from image or manual)
// ============================================================
function addCard(opts = {}) {
    const id = nextCardId++;
    const corners = opts.corners || { tl:{x:8,y:18}, tr:{x:92,y:18}, bl:{x:8,y:92}, br:{x:92,y:92} };
    const isManual = !!opts.isManual;
    const imageDataUrl = opts.imageDataUrl || null;
    const values = opts.values || null; // 5x5 array

    // Create srcCanvas from dataUrl
    let srcCanvas = null;
    if (imageDataUrl && !isManual) {
        srcCanvas = document.createElement('canvas');
        const img = new Image();
        img.src = imageDataUrl;
        // We'll set it once loaded
        cardStore[id] = { corners, srcCanvas: null, imageDataUrl, isManual: false };
        img.onload = () => {
            srcCanvas.width = img.width; srcCanvas.height = img.height;
            srcCanvas.getContext('2d').drawImage(img, 0, 0);
            cardStore[id].srcCanvas = srcCanvas;
        };
    } else {
        cardStore[id] = { corners, srcCanvas: null, imageDataUrl: null, isManual: true };
    }

    const card = document.createElement('div');
    card.className = 'bingo-card'; card.id = `card-${id}`;

    const imageContent = isManual
        ? `<canvas class="gen-card" id="genCanvas-${id}" width="300" height="300"></canvas>`
        : `<img src="${imageDataUrl}" id="img-${id}">`;

    const showOcr = !isManual;

    card.innerHTML = `
        <div class="card-header">
            <span>🎴 卡片 #${id + 1}</span>
            <div class="card-actions">
                ${showOcr ? `<button class="btn-ocr" id="ocrBtn-${id}" onclick="runOCR(${id})" ${!tesseractReady?'disabled':''}>🔍 辨識</button>` : ''}
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

    // Fill saved values
    if (values) {
        for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2) continue;
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                if (inp && values[r][c]) inp.value = values[r][c];
            }
    }

    // Bind input change → save + update generated card
    document.querySelectorAll(`#grid-${id} input`).forEach(inp => {
        inp.addEventListener('input', () => {
            saveToStorage();
            if (isManual) drawGeneratedCard(id);
        });
    });

    // Setup image-based card
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
    for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++)
            h += (r === 2 && c === 2)
                ? `<input type="text" class="free-cell" value="FREE" readonly id="c${cid}-${r}-${c}">`
                : `<input type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*"
                    id="c${cid}-${r}-${c}" placeholder="?" onfocus="this.select()">`;
    return h;
}

function deleteCard(id) {
    document.getElementById(`card-${id}`)?.remove();
    delete cardStore[id];
    saveToStorage();
}
// Expose globally for onclick
window.runOCR = runOCR;
window.deleteCard = deleteCard;

// ============================================================
// 5. Generate Visual Card (for manual cards)
// ============================================================
function drawGeneratedCard(id) {
    const cv = document.getElementById(`genCanvas-${id}`);
    if (!cv) return;
    const size = 300;
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    const cs = size / 5;

    // Background
    ctx.fillStyle = '#f5f5f0';
    ctx.fillRect(0, 0, size, size);

    // Colors for circles (rotating)
    const colors = ['#ff9800','#2196f3','#e91e63','#9c27b0','#4caf50',
                     '#ff5722','#00bcd4','#f44336','#3f51b5','#8bc34a'];

    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            const cx = c * cs + cs / 2;
            const cy = r * cs + cs / 2;
            const radius = cs * .42;

            // Circle
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fillStyle = colors[(r * 5 + c) % colors.length] + '33';
            ctx.fill();
            ctx.strokeStyle = colors[(r * 5 + c) % colors.length];
            ctx.lineWidth = 2;
            ctx.stroke();

            // Number text
            let val = 'FREE';
            if (!(r === 2 && c === 2)) {
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                val = inp?.value.trim() || '';
            }

            ctx.fillStyle = '#000';
            ctx.font = `bold ${val === 'FREE' ? 12 : 18}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(val, cx, cy);
        }
    }
}

// ============================================================
// 6. Grid Overlay SVG + Handle Positioning
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
    const cn = cardStore[id]?.corners;
    if (!cn) return;

    const tl = {x:cn.tl.x/100*w, y:cn.tl.y/100*h};
    const tr = {x:cn.tr.x/100*w, y:cn.tr.y/100*h};
    const bl = {x:cn.bl.x/100*w, y:cn.bl.y/100*h};
    const br = {x:cn.br.x/100*w, y:cn.br.y/100*h};

    const gc = 'rgba(88,255,88,';
    let s = `<polygon points="${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}"
        fill="none" stroke="${gc}.7)" stroke-width="1.5"/>`;
    for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const l = gridPt(tl,tr,bl,br,0,t), r2 = gridPt(tl,tr,bl,br,1,t);
        s += `<line x1="${l.x}" y1="${l.y}" x2="${r2.x}" y2="${r2.y}" stroke="${gc}.35)" stroke-width="1" stroke-dasharray="4,3"/>`;
        const t2 = gridPt(tl,tr,bl,br,t,0), b2 = gridPt(tl,tr,bl,br,t,1);
        s += `<line x1="${t2.x}" y1="${t2.y}" x2="${b2.x}" y2="${b2.y}" stroke="${gc}.35)" stroke-width="1" stroke-dasharray="4,3"/>`;
    }
    const ct = gridPt(tl,tr,bl,br,.5,.5);
    s += `<text x="${ct.x}" y="${ct.y}" fill="rgba(255,255,255,.4)" font-size="10"
        text-anchor="middle" dominant-baseline="middle">FREE</text>`;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = s;
}

function positionHandles(id) {
    const box = document.getElementById(`imgBox-${id}`);
    if (!box) return;
    const cn = cardStore[id]?.corners;
    if (!cn) return;
    box.querySelectorAll('.handle').forEach(h => {
        const c = h.dataset.corner;
        h.style.left = cn[c].x + '%'; h.style.top = cn[c].y + '%';
    });
}

// Global drag
document.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    e.preventDefault();
    dragState = { cardId: parseInt(h.dataset.card), corner: h.dataset.corner, box: h.closest('.card-image-box') };
    h.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
    if (!dragState) return; e.preventDefault();
    const rect = dragState.box.getBoundingClientRect();
    let px = ((e.clientX - rect.left) / rect.width) * 100;
    let py = ((e.clientY - rect.top) / rect.height) * 100;
    px = Math.max(1, Math.min(99, px)); py = Math.max(1, Math.min(99, py));
    cardStore[dragState.cardId].corners[dragState.corner] = {x:px, y:py};
    positionHandles(dragState.cardId);
    updateCardGrid(dragState.cardId);
});
document.addEventListener('pointerup', () => {
    if (dragState) { saveToStorage(); dragState = null; }
});

// ============================================================
// 7. OCR
// ============================================================
async function runOCR(id) {
    if (!tesseractReady) return;
    const store = cardStore[id];
    if (!store || !store.srcCanvas) {
        // srcCanvas might not be loaded yet, retry
        setTimeout(() => runOCR(id), 500);
        return;
    }

    const btn = document.getElementById(`ocrBtn-${id}`);
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳'; }

    const src = store.srcCanvas;
    const sw = src.width, sh = src.height;
    const cn = store.corners;
    const tl = {x:cn.tl.x/100*sw, y:cn.tl.y/100*sh};
    const tr = {x:cn.tr.x/100*sw, y:cn.tr.y/100*sh};
    const bl = {x:cn.bl.x/100*sw, y:cn.bl.y/100*sh};
    const br = {x:cn.br.x/100*sw, y:cn.br.y/100*sh};

    let detected = 0;
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            if (row === 2 && col === 2) continue;
            const inp = document.getElementById(`c${id}-${row}-${col}`);
            if (!inp) continue;
            const existing = inp.value.trim();
            if (/^\d{1,2}$/.test(existing) && !inp.classList.contains('ocr-fail')) continue;

            const inset = .20;
            const p1 = gridPt(tl,tr,bl,br,(col+inset)/5,(row+inset)/5);
            const p2 = gridPt(tl,tr,bl,br,(col+1-inset)/5,(row+1-inset)/5);
            const cw = p2.x - p1.x, ch = p2.y - p1.y;
            if (cw < 5 || ch < 5) continue;

            const cellCv = prepareCell(src, p1.x, p1.y, cw, ch);
            try {
                const ret = await tesseractWorker.recognize(cellCv.toDataURL('image/png'));
                const raw = ret.data.text.trim(), conf = ret.data.confidence;
                const num = parseInt(raw, 10);
                inp.classList.remove('ocr-low', 'ocr-fail');
                if (!isNaN(num) && num >= 1 && num <= 75 && raw.length <= 2 && conf > 15) {
                    inp.value = num; detected++;
                    if (conf < 50) inp.classList.add('ocr-low');
                } else { inp.value = ''; inp.placeholder = raw || '?'; inp.classList.add('ocr-fail'); }
            } catch { inp.classList.add('ocr-fail'); }
        }
        statusText.innerText = `卡 #${id+1} 辨識 ${(row+1)*5}/25`;
        statusText.style.color = '#ffcc00';
    }

    if (btn) { btn.disabled = false; btn.innerHTML = '🔍 辨識'; }
    statusText.innerText = `卡 #${id+1}：${detected}/24 數字`;
    statusText.style.color = detected >= 18 ? '#3ba55d' : '#ffcc00';
    saveToStorage();
}

function prepareCell(src, cx, cy, cw, ch) {
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(cw)); crop.height = Math.max(1, Math.round(ch));
    const ctx = crop.getContext('2d');
    ctx.drawImage(src, Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch), 0, 0, crop.width, crop.height);
    const imgData = ctx.getImageData(0, 0, crop.width, crop.height);
    const px = imgData.data, gv = [];
    for (let i = 0; i < px.length; i += 4) {
        const g = Math.round(.299*px[i]+.587*px[i+1]+.114*px[i+2]);
        gv.push(g); px[i]=g; px[i+1]=g; px[i+2]=g;
    }
    const t = otsu(gv);
    for (let i = 0; i < px.length; i += 4) {
        const v = px[i] < t ? 0 : 255;
        px[i]=v; px[i+1]=v; px[i+2]=v; px[i+3]=255;
    }
    ctx.putImageData(imgData, 0, 0);
    const sc = Math.max(1, 150/crop.height);
    const sw = Math.round(crop.width*sc), sh = Math.round(crop.height*sc), pad = 20;
    const fin = document.createElement('canvas');
    fin.width = sw+pad*2; fin.height = sh+pad*2;
    const fc = fin.getContext('2d');
    fc.imageSmoothingEnabled = false;
    fc.fillStyle = '#fff'; fc.fillRect(0,0,fin.width,fin.height);
    fc.drawImage(crop,0,0,crop.width,crop.height,pad,pad,sw,sh);
    return fin;
}

function otsu(vals) {
    const hist = new Array(256).fill(0);
    for (const v of vals) hist[v]++;
    const n = vals.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB=0, wB=0, best=0, th=128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue;
        const wF = n - wB; if (!wF) break;
        sB += t * hist[t];
        const d = sB/wB - (sum-sB)/wF;
        if (wB * wF * d * d > best) { best = wB * wF * d * d; th = t; }
    }
    return th;
}

// ============================================================
// 8. Strike All: compare inputs, draw on image
// ============================================================
strikeAllBtn.addEventListener('click', () => {
    const targets = document.getElementById('targetNumbers').value
        .split(',').map(n => n.trim()).filter(n => n.length > 0);
    if (!targets.length) return alert('請輸入已開出號碼');

    const cards = document.querySelectorAll('.bingo-card');
    if (!cards.length) return alert('請先新增卡片');

    let totalLines = 0;

    cards.forEach(card => {
        const id = card.id.replace('card-', '');
        const store = cardStore[id];
        if (!store) return;

        const grid = Array.from({length:5}, () => Array(5).fill(false));
        grid[2][2] = true;

        for (let r = 0; r < 5; r++)
            for (let c = 0; c < 5; c++) {
                if (r === 2 && c === 2) continue;
                const inp = document.getElementById(`c${id}-${r}-${c}`);
                if (!inp) continue;
                inp.classList.remove('hit');
                if (targets.includes(inp.value.trim())) {
                    grid[r][c] = true;
                    inp.classList.add('hit');
                }
            }

        // Count lines + track which ones
        let lines = 0;
        const completedLines = []; // [{type, index}]
        for (let r = 0; r < 5; r++) if (grid[r].every(v => v)) { lines++; completedLines.push({type:'row', index:r}); }
        for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every(r => grid[r][c])) { lines++; completedLines.push({type:'col', index:c}); }
        if ([0,1,2,3,4].every(i => grid[i][i])) { lines++; completedLines.push({type:'diag', index:0}); }
        if ([0,1,2,3,4].every(i => grid[i][4-i])) { lines++; completedLines.push({type:'diag', index:1}); }

        // Draw strikes on image
        drawStrikesOnImage(id, grid, completedLines);

        // Update result badge
        const details = completedLines.map(l => {
            if (l.type === 'row') return `橫${l.index+1}`;
            if (l.type === 'col') return `直${l.index+1}`;
            return l.index === 0 ? '↘斜' : '↙斜';
        });
        const res = document.getElementById(`result-${id}`);
        const badge = document.getElementById(`badge-${id}`);
        const detail = document.getElementById(`detail-${id}`);
        res.style.display = 'flex';
        badge.textContent = `${lines} 條線`;
        badge.className = 'lines-badge ' + (lines > 0 ? 'has-lines' : 'no-lines');
        detail.textContent = lines > 0 ? details.join('、') : '尚未連線';
        totalLines += lines;

        // Update generated card if manual
        if (store.isManual) drawGeneratedCard(parseInt(id));
    });

    statusText.innerText = `比對完成！${cards.length} 張卡，共 ${totalLines} 條線`;
    statusText.style.color = totalLines > 0 ? '#ff4d4d' : '#3ba55d';
    saveToStorage();
});

// ============================================================
// 9. Draw X marks and bingo lines on image canvas
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
        tl = {x:cn.tl.x/100*w, y:cn.tl.y/100*h};
        tr = {x:cn.tr.x/100*w, y:cn.tr.y/100*h};
        bl = {x:cn.bl.x/100*w, y:cn.bl.y/100*h};
        br = {x:cn.br.x/100*w, y:cn.br.y/100*h};
    } else {
        // Manual card: grid covers entire image
        tl = {x:0, y:0}; tr = {x:w, y:0};
        bl = {x:0, y:h}; br = {x:w, y:h};
    }

    // Draw X on each hit cell
    for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
            if (!grid[r][c]) continue;
            if (r === 2 && c === 2) continue; // Skip FREE visual

            const center = gridPt(tl, tr, bl, br, (c + .5) / 5, (r + .5) / 5);
            const tl2 = gridPt(tl, tr, bl, br, c / 5, r / 5);
            const br2 = gridPt(tl, tr, bl, br, (c+1) / 5, (r+1) / 5);
            const cellSize = Math.min(br2.x - tl2.x, br2.y - tl2.y);
            const arm = cellSize * .28;

            ctx.save();
            ctx.strokeStyle = 'rgba(255, 60, 60, 0.85)';
            ctx.lineWidth = Math.max(2, cellSize * .08);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(center.x - arm, center.y - arm);
            ctx.lineTo(center.x + arm, center.y + arm);
            ctx.moveTo(center.x + arm, center.y - arm);
            ctx.lineTo(center.x - arm, center.y + arm);
            ctx.stroke();
            ctx.restore();
        }
    }

    // Draw bingo lines
    const lineColors = ['#ffe600', '#00ff88', '#ff00ff', '#00ccff', '#ff8800'];
    completedLines.forEach((line, idx) => {
        const color = lineColors[idx % lineColors.length];
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.globalAlpha = 0.8;

        let startPt, endPt;

        if (line.type === 'row') {
            const r = line.index;
            startPt = gridPt(tl, tr, bl, br, 0.02, (r + .5) / 5);
            endPt = gridPt(tl, tr, bl, br, 0.98, (r + .5) / 5);
        } else if (line.type === 'col') {
            const c = line.index;
            startPt = gridPt(tl, tr, bl, br, (c + .5) / 5, 0.02);
            endPt = gridPt(tl, tr, bl, br, (c + .5) / 5, 0.98);
        } else if (line.index === 0) {
            // Diagonal ↘
            startPt = gridPt(tl, tr, bl, br, 0.02, 0.02);
            endPt = gridPt(tl, tr, bl, br, 0.98, 0.98);
        } else {
            // Diagonal ↙
            startPt = gridPt(tl, tr, bl, br, 0.98, 0.02);
            endPt = gridPt(tl, tr, bl, br, 0.02, 0.98);
        }

        ctx.beginPath();
        ctx.moveTo(startPt.x, startPt.y);
        ctx.lineTo(endPt.x, endPt.y);
        ctx.stroke();
        ctx.restore();
    });
}

// ============================================================
// 10. LocalStorage Save/Load
// ============================================================
function saveToStorage() {
    try {
        const data = [];
        document.querySelectorAll('.bingo-card').forEach(card => {
            const id = card.id.replace('card-', '');
            const store = cardStore[id];
            if (!store) return;

            const values = [];
            for (let r = 0; r < 5; r++) {
                const row = [];
                for (let c = 0; c < 5; c++) {
                    if (r === 2 && c === 2) { row.push('FREE'); continue; }
                    const inp = document.getElementById(`c${id}-${r}-${c}`);
                    row.push(inp ? inp.value.trim() : '');
                }
                values.push(row);
            }

            data.push({
                corners: store.corners,
                isManual: store.isManual,
                imageDataUrl: store.imageDataUrl,
                values: values
            });
        });

        localStorage.setItem('bingo_cards', JSON.stringify(data));
        localStorage.setItem('bingo_targets', document.getElementById('targetNumbers').value);

        // Flash save indicator
        saveIndicator.classList.add('show');
        setTimeout(() => saveIndicator.classList.remove('show'), 1500);
    } catch (e) {
        console.warn('Storage save failed:', e);
    }
}

function loadFromStorage() {
    try {
        const targets = localStorage.getItem('bingo_targets');
        if (targets) document.getElementById('targetNumbers').value = targets;

        const raw = localStorage.getItem('bingo_cards');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) return;

        data.forEach(item => {
            addCard({
                corners: item.corners,
                isManual: item.isManual,
                imageDataUrl: item.imageDataUrl,
                values: item.values
            });
        });

        if (data.length > 0) {
            statusText.innerText = `已載入 ${data.length} 張卡片`;
            statusText.style.color = '#3ba55d';
        }
    } catch (e) {
        console.warn('Storage load failed:', e);
    }
}

// Also save when target numbers change
document.getElementById('targetNumbers').addEventListener('input', () => saveToStorage());