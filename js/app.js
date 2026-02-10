// js/app.js - BingoVision: Per-card grid alignment + editable inputs

const video = document.getElementById('cameraVideo');
const cameraOverlay = document.getElementById('cameraOverlay');
const captureBtn = document.getElementById('captureBtn');
const strikeAllBtn = document.getElementById('strikeAllBtn');
const statusText = document.getElementById('statusText');
const imageUpload = document.getElementById('imageUpload');
const uploadBtn = document.getElementById('uploadBtn');
const cardList = document.getElementById('cardList');

let nextCardId = 0;
let tesseractWorker = null;
let tesseractReady = false;

// Store per-card data: { corners, srcCanvas }
const cardStore = {};

// Currently dragged handle
let dragState = null; // { cardId, corner, box }

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
        statusText.innerText = '就緒！拍照或上傳 Bingo 卡';
        statusText.style.color = '#3ba55d';
    } catch (e) {
        statusText.innerText = 'OCR 載入失敗: ' + e.message;
        statusText.style.color = 'red';
    }
})();

// ============================================================
// 2. Camera Overlay
// ============================================================
(async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 1920 } }
        });
        video.srcObject = stream;
        video.addEventListener('loadedmetadata', drawCamOverlay);
        setInterval(drawCamOverlay, 600);
    } catch (e) {
        document.getElementById('cameraSection').style.display = 'none';
    }
})();

function drawCamOverlay() {
    const cw = video.clientWidth, ch = video.clientHeight;
    if (!cw || !ch) return;
    cameraOverlay.width = cw; cameraOverlay.height = ch;
    const ctx = cameraOverlay.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    const gs = Math.min(cw, ch) * .78;
    const gx = (cw - gs) / 2, gy = (ch - gs) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, cw, gy);
    ctx.fillRect(0, gy + gs, cw, ch - gy - gs);
    ctx.fillRect(0, gy, gx, gs);
    ctx.fillRect(gx + gs, gy, cw - gx - gs, gs);
    ctx.strokeStyle = 'rgba(88,255,88,.7)'; ctx.lineWidth = 1.5;
    ctx.strokeRect(gx, gy, gs, gs);
    ctx.setLineDash([5, 3]); ctx.strokeStyle = 'rgba(88,255,88,.4)';
    for (let i = 1; i < 5; i++) {
        const x = gx + gs / 5 * i, y = gy + gs / 5 * i;
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy + gs); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx + gs, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '11px Arial'; ctx.textAlign = 'center';
    ctx.fillText('對齊 Bingo 卡拍照', cw / 2, gy - 6);
    const cs = gs / 5;
    ctx.fillText('FREE', gx + cs * 2.5, gy + cs * 2.5 + 4);
}

// ============================================================
// 3. Capture / Upload
// ============================================================
captureBtn.addEventListener('click', () => {
    if (!video.srcObject) return;
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    addCard(c.toDataURL('image/jpeg', .85), c);
});

uploadBtn.addEventListener('click', () => imageUpload.click());
imageUpload.addEventListener('change', e => {
    Array.from(e.target.files).forEach(file => {
        const r = new FileReader();
        r.onload = ev => {
            const img = new Image();
            img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                addCard(ev.target.result, c);
            };
            img.src = ev.target.result;
        };
        r.readAsDataURL(file);
    });
    imageUpload.value = '';
});

// ============================================================
// 4. Add Card
// ============================================================
function addCard(dataUrl, srcCanvas) {
    const id = nextCardId++;

    // Default corners (%)
    const corners = { tl:{x:8,y:18}, tr:{x:92,y:18}, bl:{x:8,y:92}, br:{x:92,y:92} };
    cardStore[id] = { corners, srcCanvas };

    const card = document.createElement('div');
    card.className = 'bingo-card';
    card.id = `card-${id}`;
    card.innerHTML = `
        <div class="card-header">
            <span>🎴 卡片 #${id + 1}</span>
            <div class="card-actions">
                <button class="btn-ocr" id="ocrBtn-${id}" onclick="window._runOCR(${id})"
                    ${!tesseractReady ? 'disabled' : ''}>🔍 辨識</button>
                <button class="btn-delete" onclick="window._deleteCard(${id})">✕</button>
            </div>
        </div>
        <div class="card-body">
            <div class="card-image-box" id="imgBox-${id}">
                <img src="${dataUrl}" id="img-${id}">
                <svg class="grid-overlay" id="svg-${id}"></svg>
                <div class="handle" data-card="${id}" data-corner="tl"></div>
                <div class="handle" data-card="${id}" data-corner="tr"></div>
                <div class="handle" data-card="${id}" data-corner="bl"></div>
                <div class="handle" data-card="${id}" data-corner="br"></div>
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

    // Position handles after image loads
    const img = document.getElementById(`img-${id}`);
    img.addEventListener('load', () => {
        updateCardGrid(id);
        positionHandles(id);
    });
    // Also try immediately (cached images)
    if (img.complete) { updateCardGrid(id); positionHandles(id); }

    // Auto OCR
    if (tesseractReady) setTimeout(() => window._runOCR(id), 200);
}

function buildInputs(cid) {
    let h = '';
    for (let r = 0; r < 5; r++)
        for (let c = 0; c < 5; c++)
            h += (r === 2 && c === 2)
                ? `<input type="text" class="free-cell" value="FREE" readonly id="c${cid}-${r}-${c}" data-r="${r}" data-c="${c}">`
                : `<input type="text" maxlength="2" inputmode="numeric" pattern="[0-9]*"
                    id="c${cid}-${r}-${c}" data-r="${r}" data-c="${c}" placeholder="?" onfocus="this.select()">`;
    return h;
}

window._deleteCard = id => {
    document.getElementById(`card-${id}`)?.remove();
    delete cardStore[id];
};

// ============================================================
// 5. Grid Overlay SVG + Handle Positioning
// ============================================================
function lerp(a, b, t) { return a + (b - a) * t; }

function gridPt(tl, tr, bl, br, u, v) {
    const tx = lerp(tl.x, tr.x, u), ty = lerp(tl.y, tr.y, u);
    const bx = lerp(bl.x, br.x, u), by = lerp(bl.y, br.y, u);
    return { x: lerp(tx, bx, v), y: lerp(ty, by, v) };
}

function updateCardGrid(id) {
    const box = document.getElementById(`imgBox-${id}`);
    const svg = document.getElementById(`svg-${id}`);
    if (!box || !svg) return;
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;

    const cn = cardStore[id]?.corners;
    if (!cn) return;

    const tl = { x: cn.tl.x / 100 * w, y: cn.tl.y / 100 * h };
    const tr = { x: cn.tr.x / 100 * w, y: cn.tr.y / 100 * h };
    const bl = { x: cn.bl.x / 100 * w, y: cn.bl.y / 100 * h };
    const br = { x: cn.br.x / 100 * w, y: cn.br.y / 100 * h };

    const gc = 'rgba(88,255,88,';
    let s = `<polygon points="${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}"
        fill="none" stroke="${gc}.7)" stroke-width="1.5"/>`;

    for (let i = 1; i < 5; i++) {
        const t = i / 5;
        const l = gridPt(tl, tr, bl, br, 0, t), r2 = gridPt(tl, tr, bl, br, 1, t);
        s += `<line x1="${l.x}" y1="${l.y}" x2="${r2.x}" y2="${r2.y}" stroke="${gc}.35)" stroke-width="1" stroke-dasharray="4,3"/>`;
        const t2 = gridPt(tl, tr, bl, br, t, 0), b2 = gridPt(tl, tr, bl, br, t, 1);
        s += `<line x1="${t2.x}" y1="${t2.y}" x2="${b2.x}" y2="${b2.y}" stroke="${gc}.35)" stroke-width="1" stroke-dasharray="4,3"/>`;
    }

    // FREE label
    const ct = gridPt(tl, tr, bl, br, .5, .5);
    s += `<text x="${ct.x}" y="${ct.y}" fill="rgba(255,255,255,.45)" font-size="10"
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
        h.style.left = cn[c].x + '%';
        h.style.top = cn[c].y + '%';
    });
}

// ============================================================
// 6. Global Drag Handling (mouse + touch)
// ============================================================
document.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    e.preventDefault();
    const cid = parseInt(h.dataset.card);
    const corner = h.dataset.corner;
    const box = document.getElementById(`imgBox-${cid}`);
    dragState = { cardId: cid, corner, box };
    h.setPointerCapture(e.pointerId);
});

document.addEventListener('pointermove', e => {
    if (!dragState) return;
    e.preventDefault();
    const rect = dragState.box.getBoundingClientRect();
    let px = ((e.clientX - rect.left) / rect.width) * 100;
    let py = ((e.clientY - rect.top) / rect.height) * 100;
    px = Math.max(1, Math.min(99, px));
    py = Math.max(1, Math.min(99, py));
    const cn = cardStore[dragState.cardId].corners;
    cn[dragState.corner] = { x: px, y: py };
    positionHandles(dragState.cardId);
    updateCardGrid(dragState.cardId);
});

document.addEventListener('pointerup', () => { dragState = null; });

// ============================================================
// 7. OCR per card (uses corner positions)
// ============================================================
window._runOCR = async function(id) {
    if (!tesseractReady) return;
    const store = cardStore[id];
    if (!store) return;

    const btn = document.getElementById(`ocrBtn-${id}`);
    btn.disabled = true;
    btn.innerHTML = '⏳';

    const src = store.srcCanvas;
    const sw = src.width, sh = src.height;
    const cn = store.corners;

    // Convert corners % → source image px
    const tl = { x: cn.tl.x / 100 * sw, y: cn.tl.y / 100 * sh };
    const tr = { x: cn.tr.x / 100 * sw, y: cn.tr.y / 100 * sh };
    const bl = { x: cn.bl.x / 100 * sw, y: cn.bl.y / 100 * sh };
    const br = { x: cn.br.x / 100 * sw, y: cn.br.y / 100 * sh };

    let detected = 0;

    for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
            if (row === 2 && col === 2) continue;
            const input = document.getElementById(`c${id}-${row}-${col}`);
            if (!input) continue;
            // Skip if user already typed a valid number
            const existing = input.value.trim();
            if (/^\d{1,2}$/.test(existing) && !input.classList.contains('ocr-fail')) continue;

            // Bilinear cell bounds with 20% inset
            const inset = 0.20;
            const c0 = (col + inset) / 5, c1 = (col + 1 - inset) / 5;
            const r0 = (row + inset) / 5, r1 = (row + 1 - inset) / 5;
            const cellTL = gridPt(tl, tr, bl, br, c0, r0);
            const cellBR = gridPt(tl, tr, bl, br, c1, r1);
            const cx = cellTL.x, cy = cellTL.y;
            const cw = cellBR.x - cellTL.x, ch = cellBR.y - cellTL.y;

            if (cw < 5 || ch < 5) continue;

            const cellCanvas = prepareCell(src, cx, cy, cw, ch);

            try {
                const ret = await tesseractWorker.recognize(cellCanvas.toDataURL('image/png'));
                const raw = ret.data.text.trim();
                const conf = ret.data.confidence;
                const num = parseInt(raw, 10);

                input.classList.remove('ocr-low', 'ocr-fail');

                if (!isNaN(num) && num >= 1 && num <= 75 && raw.length <= 2 && conf > 15) {
                    input.value = num;
                    detected++;
                    if (conf < 50) input.classList.add('ocr-low');
                } else {
                    input.value = '';
                    input.placeholder = raw || '?';
                    input.classList.add('ocr-fail');
                }
            } catch {
                input.classList.add('ocr-fail');
            }
        }
        // Update status per row
        statusText.innerText = `卡 #${id + 1} 辨識中... (${(row + 1) * 5}/25)`;
    }

    btn.disabled = false;
    btn.innerHTML = '🔍 辨識';
    statusText.innerText = `卡 #${id + 1}：辨識 ${detected}/24 個數字`;
    statusText.style.color = detected >= 18 ? '#3ba55d' : '#ffcc00';
};

// ============================================================
// 8. Cell image preparation (grayscale, Otsu, scale)
// ============================================================
function prepareCell(src, cx, cy, cw, ch) {
    const crop = document.createElement('canvas');
    crop.width = Math.max(1, Math.round(cw));
    crop.height = Math.max(1, Math.round(ch));
    const ctx = crop.getContext('2d');
    ctx.drawImage(src, Math.round(cx), Math.round(cy), Math.round(cw), Math.round(ch), 0, 0, crop.width, crop.height);

    const imgData = ctx.getImageData(0, 0, crop.width, crop.height);
    const px = imgData.data;
    const gv = [];
    for (let i = 0; i < px.length; i += 4) {
        const g = Math.round(.299 * px[i] + .587 * px[i+1] + .114 * px[i+2]);
        gv.push(g); px[i] = g; px[i+1] = g; px[i+2] = g;
    }
    const t = otsu(gv);
    for (let i = 0; i < px.length; i += 4) {
        const v = px[i] < t ? 0 : 255;
        px[i] = v; px[i+1] = v; px[i+2] = v; px[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Scale up + pad
    const sc = Math.max(1, 150 / crop.height);
    const sw = Math.round(crop.width * sc), sh = Math.round(crop.height * sc);
    const pad = 20;
    const fin = document.createElement('canvas');
    fin.width = sw + pad * 2; fin.height = sh + pad * 2;
    const fc = fin.getContext('2d');
    fc.imageSmoothingEnabled = false;
    fc.fillStyle = '#fff'; fc.fillRect(0, 0, fin.width, fin.height);
    fc.drawImage(crop, 0, 0, crop.width, crop.height, pad, pad, sw, sh);
    return fin;
}

function otsu(vals) {
    const hist = new Array(256).fill(0);
    for (const v of vals) hist[v]++;
    const n = vals.length;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue;
        const wF = n - wB; if (!wF) break;
        sB += t * hist[t];
        const d = sB / wB - (sum - sB) / wF;
        const v = wB * wF * d * d;
        if (v > best) { best = v; th = t; }
    }
    return th;
}

// ============================================================
// 9. Strike All: compare INPUT values vs target numbers
// ============================================================
strikeAllBtn.addEventListener('click', () => {
    const targets = document.getElementById('targetNumbers').value
        .split(',').map(n => n.trim()).filter(n => n.length > 0);
    if (!targets.length) return alert('請輸入已開出號碼');

    const cards = document.querySelectorAll('.bingo-card');
    if (!cards.length) return alert('請先新增 Bingo 卡');

    let total = 0;

    cards.forEach(card => {
        const id = card.id.replace('card-', '');
        const grid = Array.from({ length: 5 }, () => Array(5).fill(false));
        grid[2][2] = true; // FREE

        for (let r = 0; r < 5; r++) {
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
        }

        let lines = 0; const details = [];
        for (let r = 0; r < 5; r++) if (grid[r].every(v => v)) { lines++; details.push(`橫${r+1}`); }
        for (let c = 0; c < 5; c++) if ([0,1,2,3,4].every(r => grid[r][c])) { lines++; details.push(`直${c+1}`); }
        if ([0,1,2,3,4].every(i => grid[i][i])) { lines++; details.push('↘斜'); }
        if ([0,1,2,3,4].every(i => grid[i][4-i])) { lines++; details.push('↙斜'); }

        const res = document.getElementById(`result-${id}`);
        const badge = document.getElementById(`badge-${id}`);
        const detail = document.getElementById(`detail-${id}`);
        res.style.display = 'flex';
        badge.textContent = `${lines} 條線`;
        badge.className = 'lines-badge ' + (lines > 0 ? 'has-lines' : 'no-lines');
        detail.textContent = lines > 0 ? details.join('、') : '尚未連線';
        total += lines;
    });

    statusText.innerText = `比對完成！${cards.length} 張卡，共 ${total} 條線`;
    statusText.style.color = total > 0 ? '#ff4d4d' : '#3ba55d';
});