// js/worker.js - OpenCV: Upscale + Grid Detection
// Returns ORIGINAL grayscale image + grid rectangle
// Per-cell binarization happens on main thread

importScripts('https://docs.opencv.org/4.8.0/opencv.js');

let cvReady = false;

cv.onRuntimeInitialized = () => {
    cvReady = true;
    postMessage({ type: 'ready' });
    console.log('[Worker] OpenCV ready');
};

self.onmessage = async function (e) {
    if (!cvReady) {
        postMessage({ type: 'error', error: 'OpenCV not ready yet.' });
        return;
    }

    const { width, height, buffer, targetNumbers, id, scale } = e.data;
    if (!buffer || !width || !height) {
        postMessage({ type: 'error', error: 'Invalid image data.' });
        return;
    }

    console.log(`[Worker] Input ${id}: ${width}x${height}`);

    try {
        let src = new cv.Mat(height, width, cv.CV_8UC4);
        src.data.set(new Uint8Array(buffer));

        // --- 1. Upscale ---
        let upscaleFactor = 1;
        const minDim = Math.min(width, height);
        if (minDim < 1500) {
            upscaleFactor = Math.ceil(1500 / minDim);
            upscaleFactor = Math.min(upscaleFactor, 4);
        }

        let upscaled = new cv.Mat();
        if (upscaleFactor > 1) {
            cv.resize(src, upscaled, new cv.Size(width * upscaleFactor, height * upscaleFactor), 0, 0, cv.INTER_CUBIC);
            console.log(`[Worker] Upscaled ${upscaleFactor}x → ${upscaled.cols}x${upscaled.rows}`);
        } else {
            src.copyTo(upscaled);
        }

        const uw = upscaled.cols;
        const uh = upscaled.rows;

        // --- 2. Grayscale ---
        let gray = new cv.Mat();
        cv.cvtColor(upscaled, gray, cv.COLOR_RGBA2GRAY);

        // --- 3. Binary for contour detection only ---
        let binary = new cv.Mat();
        cv.threshold(gray, binary, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

        // --- 4. Find circle contours to detect grid ---
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        let circleRects = [];
        let minArea = (uw * uh) * 0.002;
        let maxArea = (uw * uh) * 0.035;

        for (let i = 0; i < contours.size(); i++) {
            let cnt = contours.get(i);
            let area = cv.contourArea(cnt);
            if (area > minArea && area < maxArea) {
                let rect = cv.boundingRect(cnt);
                let aspect = rect.width / rect.height;
                if (aspect > 0.6 && aspect < 1.6) {
                    circleRects.push(rect);
                }
            }
            cnt.delete();
        }

        console.log(`[Worker] Circle contours: ${circleRects.length}`);

        // Sort by area, take the most consistent-sized ones
        if (circleRects.length > 5) {
            const areas = circleRects.map(r => r.width * r.height);
            areas.sort((a, b) => a - b);
            const medianArea = areas[Math.floor(areas.length / 2)];
            // Keep only those within 50% of median size
            circleRects = circleRects.filter(r => {
                const a = r.width * r.height;
                return a > medianArea * 0.5 && a < medianArea * 1.5;
            });
            console.log(`[Worker] After size filter: ${circleRects.length} circles, median area=${medianArea}`);
        }

        let gridRect;
        if (circleRects.length >= 15) {
            // Good detection - use bounding box of circles
            let minX = Math.min(...circleRects.map(r => r.x));
            let minY = Math.min(...circleRects.map(r => r.y));
            let maxX = Math.max(...circleRects.map(r => r.x + r.width));
            let maxY = Math.max(...circleRects.map(r => r.y + r.height));
            gridRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
            console.log(`[Worker] Grid from ${circleRects.length} circles: [${minX},${minY}] ${maxX-minX}x${maxY-minY}`);
        } else {
            // Fallback estimate
            gridRect = {
                x: Math.floor(uw * 0.05),
                y: Math.floor(uh * 0.22),
                width: Math.floor(uw * 0.90),
                height: Math.floor(uh * 0.68)
            };
            console.log(`[Worker] Using fallback grid rect`);
        }

        contours.delete();
        hierarchy.delete();
        binary.delete();

        // --- 5. Send back ORIGINAL grayscale (not binary!) ---
        // Convert gray to RGBA for transfer
        let grayRGBA = new cv.Mat();
        cv.cvtColor(gray, grayRGBA, cv.COLOR_GRAY2RGBA);

        const resultBuffer = new Uint8ClampedArray(grayRGBA.data).buffer;

        postMessage({
            type: 'preprocessed',
            id: id,
            width: grayRGBA.cols,
            height: grayRGBA.rows,
            buffer: resultBuffer,
            targetNumbers: targetNumbers,
            scale: scale,
            gridRect: gridRect,
            upscaleFactor: upscaleFactor
        }, [resultBuffer]);

        src.delete(); upscaled.delete(); gray.delete(); grayRGBA.delete();

    } catch (err) {
        console.error('[Worker]', err);
        postMessage({ type: 'error', error: err.toString() });
    }
};