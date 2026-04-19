import JSZip from 'jszip';
import * as UPNG from 'upng-js';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';
import { scope } from './binding';
import { long2tile, lat2tile, tile2long, tile2lat } from './tiles';

// see: https://www.taylorpetrick.com/blog/post/convolution-part3
const defaultWaterdepth = 40;

const meanKernel: number[][] = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1],
];

const sharpenKernel: number[][] = [
    [-0.00391, -0.01563, -0.02344, -0.01563, -0.00391],
    [-0.01563, -0.06250, -0.09375, -0.06250, -0.01563],
    [-0.02344, -0.09375, +1.85980, -0.09375, -0.02344],
    [-0.01563, -0.06250, -0.09375, -0.06250, -0.01563],
    [-0.00391, -0.01563, -0.02344, -0.01563, -0.00391],
];

let vmapSize = 18.144;
let mapSize = 17.28;
let tileSize = 1.92;

let grid = loadSettings();

let mapCanvas: HTMLElement;
let cache: Cache;

const panels = document.getElementsByClassName('panel');
const icons = document.getElementsByClassName('icon');
const iconClass: string[] = [];

for (let i = 0; i < panels.length; i++) {
    iconClass.push((icons[i] as HTMLElement).className);
}

const debug = !!new URL(window.location.href).searchParams.get('debug');
const debugElements = document.getElementsByClassName('debug');
if (debug) {
    while (debugElements.length > 0) {
        debugElements[0].classList.remove('debug');
    }
}

// Set the Mapbox API token
mapboxgl.accessToken = getApiToken();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const map: any = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/outdoors-v12',
    center: [grid.lng, grid.lat],
    zoom: grid.zoom,
    preserveDrawingBuffer: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const geocoder: any = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    marker: false,
});

const pbElement = document.getElementById('progress') as HTMLProgressElement;

(document.getElementById('geocoder') as HTMLElement).appendChild(geocoder.onAdd(map));

map.on('load', function () {
    mapCanvas = map.getCanvasContainer() as HTMLElement;

    scope['mapSize'] = mapSize;
    scope['baseLevel'] = 0;
    scope['heightScale'] = 100;

    caches.open('tiles').then((data) => { cache = data; });
});

map.on('style.load', function () {
    addSource();
    addLayer();
    setDebug();
    setMouse();
    showWaterLayer();
    showHeightLayer();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
map.on('click', function (e: any) {
    grid.lng = e.lngLat.lng as number;
    grid.lat = e.lngLat.lat as number;

    setGrid(grid.lng, grid.lat, vmapSize);
    map.panTo(new mapboxgl.LngLat(grid.lng, grid.lat));
    saveSettings();
    hideDebugLayer();
    updateInfopanel();
});

map.on('idle', function () {
    scope['waterDepth'] = parseInt(String(grid.waterDepth)) || 50;
    scope['gravityCenter'] = parseInt(String(grid.gravityCenter)) || 0;
    scope['levelCorrection'] = parseInt(String(grid.levelCorrection)) || 0;

    saveSettings();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
geocoder.on('result', function (query: any) {
    grid.lng = query.result.center[0] as number;
    grid.lat = query.result.center[1] as number;

    setGrid(grid.lng, grid.lat, vmapSize);
    map.setZoom(10.2);

    saveSettings();
    hideDebugLayer();
    updateInfopanel();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onMove(e: any) {
    grid.lng = e.lngLat.lng as number;
    grid.lat = e.lngLat.lat as number;
    setGrid(e.lngLat.lng as number, e.lngLat.lat as number, vmapSize);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onUp(e: any) {
    grid.lng = e.lngLat.lng as number;
    grid.lat = e.lngLat.lat as number;
    setGrid(e.lngLat.lng as number, e.lngLat.lat as number, vmapSize);

    map.off('mousemove', onMove);
    map.off('touchmove', onMove);

    hideDebugLayer();
    updateInfopanel();
}

function addSource() {
    map.addSource('grid', { type: 'geojson', data: getGrid(grid.lng, grid.lat, vmapSize) });
    map.addSource('playable', { type: 'geojson', data: getGrid(grid.lng, grid.lat, vmapSize / 9 * 5) });
    map.addSource('start', { type: 'geojson', data: getGrid(grid.lng, grid.lat, vmapSize / 9) });
    map.addSource('mapbox-streets', { type: 'vector', url: 'mapbox://mapbox.mapbox-streets-v12' });
    map.addSource('contours', { type: 'vector', url: 'mapbox://mapbox.mapbox-terrain-v2' });
}

function addLayer() {
    map.addLayer({ id: 'gridlines', type: 'fill', source: 'grid',
        paint: { 'fill-color': 'gray', 'fill-outline-color': 'gray', 'fill-opacity': 0.25 } });
    map.addLayer({ id: 'playablesquare', type: 'fill', source: 'playable',
        paint: { 'fill-color': 'green', 'fill-outline-color': 'green', 'fill-opacity': 0.3 } });
    map.addLayer({ id: 'startsquare', type: 'fill', source: 'start',
        paint: { 'fill-color': 'blue', 'fill-outline-color': 'blue', 'fill-opacity': 0.1 } });
    map.addLayer({
        id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contour',
        layout: { visibility: 'visible', 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#877b59', 'line-width': 0.25 },
    });
    map.addLayer({
        id: 'water-streets', source: 'mapbox-streets', 'source-layer': 'water', type: 'fill',
        paint: { 'fill-color': 'rgba(66,100,225, 0.3)', 'fill-outline-color': 'rgba(33,33,255, 1)' },
    });
}

function setDebug() {
    if (debug) {
        map.addSource('debug', {
            type: 'geojson',
            data: turf.bboxPolygon(turf.bbox(turf.lineString([0, 0], [0, 0]))),
        });
        map.addLayer({
            id: 'debugLayer', type: 'line', source: 'debug',
            paint: { 'line-color': 'orangered', 'line-width': 1 },
            layout: { visibility: 'none' },
        });
        (document.getElementById('wMap-canvas') as HTMLElement).style.visibility = 'visible';
        (document.getElementById('dcBox') as HTMLElement).style.display = 'block';
    }
}

function setMouse() {
    map.on('mouseenter', 'startsquare', function () {
        map.setPaintProperty('startsquare', 'fill-opacity', 0.3);
        map.setPaintProperty('startsquare', 'fill-color', 'blue');
        mapCanvas.style.cursor = 'move';
        hideDebugLayer();
    });
    map.on('mouseleave', 'startsquare', function () {
        map.setPaintProperty('startsquare', 'fill-color', 'blue');
        map.setPaintProperty('startsquare', 'fill-opacity', 0.1);
        mapCanvas.style.cursor = '';
        saveSettings();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('mousedown', 'startsquare', function (e: any) {
        e.preventDefault();
        mapCanvas.style.cursor = 'grab';
        map.on('mousemove', onMove);
        map.once('mouseup', onUp);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map.on('touchstart', 'startsquare', function (e: any) {
        if (e.points.length !== 1) return;
        e.preventDefault();
        map.on('touchmove', onMove);
        map.once('touchend', onUp);
    });
}

function showHeightContours(el: HTMLElement) {
    grid.heightContours = !grid.heightContours;
    el.classList.toggle('active', grid.heightContours);
    showHeightLayer();
}

function showHeightLayer() {
    const el = document.getElementById('showHeightContours') as HTMLElement;
    el.classList.toggle('active', grid.heightContours);
    map.setLayoutProperty('contours', 'visibility', grid.heightContours ? 'visible' : 'none');
}

function showWaterContours(el: HTMLElement) {
    grid.waterContours = !grid.waterContours;
    el.classList.toggle('active', grid.waterContours);
    showWaterLayer();
}

function showWaterLayer() {
    const el = document.getElementById('showWaterContours') as HTMLElement;
    el.classList.toggle('active', grid.waterContours);
    map.setLayoutProperty('water-streets', 'visibility', grid.waterContours ? 'visible' : 'none');
}

function deleteCaches() {
    if (confirm('Delete the caches.\nIs that okay?')) {
        caches.delete('tiles').then(() => {
            caches.open('tiles').then((data) => { cache = data; });
        });
    }
}

function setMapStyle(el: HTMLInputElement) {
    map.setStyle('mapbox://styles/mapbox/' + el.id);
}

function setLngLat(mode: number) {
    const lngInput = document.getElementById('lngInput') as HTMLInputElement;
    const latInput = document.getElementById('latInput') as HTMLInputElement;

    switch (mode) {
        case 0:
            lngInput.value = String(grid.lng);
            latInput.value = String(grid.lat);
            break;
        case 1:
            lngInput.value = '';
            latInput.value = '';
            break;
        case 2:
            if (lngInput.value && latInput.value) {
                grid.lng = parseFloat(lngInput.value);
                grid.lat = parseFloat(latInput.value);
                setGrid(grid.lng, grid.lat, vmapSize);
                map.panTo(new mapboxgl.LngLat(grid.lng, grid.lat));
                saveSettings();
                hideDebugLayer();
                updateInfopanel();
            }
            break;
    }
}

function hideDebugLayer() {
    if (debug) map.setLayoutProperty('debugLayer', 'visibility', 'none');
    grid.minHeight = null;
    grid.maxHeight = null;
}

function setGrid(lng: number, lat: number, size: number) {
    map.getSource('grid').setData(getGrid(lng, lat, size));
    map.getSource('start').setData(getGrid(lng, lat, size / 9));
    map.getSource('playable').setData(getGrid(lng, lat, size / 9 * 5));
    grid.zoom = map.getZoom() as number;
}

function getExtent(lng: number, lat: number, size = vmapSize) {
    const dist = Math.sqrt(2 * Math.pow(size / 2, 2));
    const point = turf.point([lng, lat]);
    const topleft = turf.destination(point, dist, -45, { units: 'kilometers' }).geometry.coordinates as number[];
    const bottomright = turf.destination(point, dist, 135, { units: 'kilometers' }).geometry.coordinates as number[];
    return { topleft, bottomright };
}

function getGrid(lng: number, lat: number, size: number) {
    const extent = getExtent(lng, lat, size);
    return turf.squareGrid(
        [extent.topleft[0], extent.topleft[1], extent.bottomright[0], extent.bottomright[1]],
        tileSize, { units: 'kilometers' }
    );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GridSettings {
    lng: number;
    lat: number;
    zoom: number;
    minHeight: number | null;
    maxHeight: number | null;
    heightContours: boolean;
    waterContours: boolean;
    waterDepth: number;
    tiltHeight: number;
    drawGrid: boolean;
    drawStreams: boolean;
    drawMarker: boolean;
    blurPasses: number;
    blurPostPasses: number;
    plainsHeight: number;
    streamDepth: number;
    gravityCenter: number;
    levelCorrection: number;
    [key: string]: unknown;
}

function loadSettings(): GridSettings {
    const stored = (JSON.parse(localStorage.getItem('grid') ?? 'null') ?? {}) as Partial<GridSettings>;

    const wd = parseInt(String(stored.waterDepth)) || defaultWaterdepth;
    const grid: GridSettings = {
        lng: parseFloat(String(stored.lng)) || -122.43877,
        lat: parseFloat(String(stored.lat)) || 37.75152,
        zoom: parseFloat(String(stored.zoom)) || 11.0,
        minHeight: typeof stored.minHeight === 'number' ? stored.minHeight : 0,
        maxHeight: typeof stored.maxHeight === 'number' ? stored.maxHeight : 0,
        heightContours: stored.heightContours ?? false,
        waterContours: stored.waterContours ?? false,
        waterDepth: wd,
        tiltHeight: parseInt(String(stored.tiltHeight)) || Math.floor(wd / 2),
        drawGrid: stored.drawGrid ?? false,
        drawStreams: stored.drawStreams ?? false,
        drawMarker: stored.drawMarker ?? false,
        blurPasses: parseInt(String(stored.blurPasses)) || 7,
        blurPostPasses: parseInt(String(stored.blurPostPasses)) || 3,
        plainsHeight: parseInt(String(stored.plainsHeight)) || 140,
        streamDepth: parseInt(String(stored.streamDepth)) || 140,
        gravityCenter: parseInt(String(stored.gravityCenter)) || 0,
        levelCorrection: parseInt(String(stored.levelCorrection)) || 0,
    };

    // TODO: do not set global vars!
    (document.getElementById('waterDepth') as HTMLInputElement).value = String(grid.waterDepth);
    (document.getElementById('tiltHeight') as HTMLInputElement).value = String(grid.tiltHeight);
    (document.getElementById('drawGrid') as HTMLInputElement).checked = grid.drawGrid;
    (document.getElementById('drawStrm') as HTMLInputElement).checked = grid.drawStreams;
    (document.getElementById('drawMarker') as HTMLInputElement).checked = grid.drawMarker;
    (document.getElementById('blurPasses') as HTMLInputElement).value = String(grid.blurPasses);
    (document.getElementById('blurPostPasses') as HTMLInputElement).value = String(grid.blurPostPasses);
    (document.getElementById('plainsHeight') as HTMLInputElement).value = String(grid.plainsHeight);
    (document.getElementById('streamDepth') as HTMLInputElement).value = String(grid.streamDepth);

    return grid;
}

function saveSettings() {
    grid.zoom = map.getZoom() as number;
    grid.drawGrid = (document.getElementById('drawGrid') as HTMLInputElement).checked;
    grid.waterDepth = parseInt((document.getElementById('waterDepth') as HTMLInputElement).value);
    grid.drawStreams = (document.getElementById('drawStrm') as HTMLInputElement).checked;
    grid.drawMarker = (document.getElementById('drawMarker') as HTMLInputElement).checked;
    grid.plainsHeight = parseInt((document.getElementById('plainsHeight') as HTMLInputElement).value);
    grid.blurPasses = parseInt((document.getElementById('blurPasses') as HTMLInputElement).value);
    grid.blurPostPasses = parseInt((document.getElementById('blurPostPasses') as HTMLInputElement).value);
    grid.streamDepth = parseInt((document.getElementById('streamDepth') as HTMLInputElement).value);
    grid.gravityCenter = parseInt(String(scope['gravityCenter'])) || 0;
    grid.tiltHeight = parseInt((document.getElementById('tiltHeight') as HTMLInputElement).value);
    grid.levelCorrection = parseInt(String(scope['levelCorrection'])) || 0;
    localStorage.setItem('grid', JSON.stringify(grid));
}

function Create2DArray<T>(rows: number, def: T | null = null): (T | null)[][] {
    const arr: (T | null)[][] = new Array(rows) as (T | null)[][];
    for (let i = 0; i < rows; i++) {
        arr[i] = new Array(rows).fill(def) as (T | null)[];
    }
    return arr;
}

// for debugging maps (2 dimensional array), and 1 dimensional arrays
// use a format that is understood by excel (comma delimited)
// and locale of the browser (and thus excel presumably)
function exportToCSV(mapData: (number | number[] | null)[] | number[][]) {
    const csvRows: string[] = [];
    function isNumber(n: unknown): n is number { return !isNaN(parseFloat(String(n))) && !isNaN(Number(n) - 0); }

    for (let i = 0, l = mapData.length; i < l; ++i) {
        const val = mapData[i];
        if (Array.isArray(val)) {
            if (isNumber(val[0])) {
                csvRows.push((val as number[]).map(x => x.toLocaleString(undefined)).join('\t'));
            } else {
                csvRows.push(val.join('\t'));
            }
        } else {
            if (isNumber(val)) {
                csvRows.push(val.toLocaleString(undefined));
            } else {
                csvRows.push(String(val));
            }
        }
    }

    const csvString = csvRows.join('\r\n');
    const a = document.createElement('a');
    a.href = 'data:attachment/csv,' + encodeURIComponent(csvString);
    a.target = '_blank';
    a.download = 'myFile.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// suppress unused-variable warning for exportToCSV (available for debug console use)
void exportToCSV;

function togglePanel(index: number) {
    const isOpens: boolean[] = [];
    for (let i = 0; i < panels.length; i++) {
        isOpens.push((panels[i] as HTMLElement).classList.contains('slide-in'));
    }
    for (let i = 0; i < panels.length; i++) {
        if (isOpens[i] && i !== index) {
            (panels[i] as HTMLElement).setAttribute('class', 'panel slide-out');
            (icons[i] as HTMLElement).setAttribute('class', iconClass[i]);
        }
    }
    (panels[index] as HTMLElement).setAttribute('class', isOpens[index] ? 'panel slide-out' : 'panel slide-in');
    (icons[index] as HTMLElement).setAttribute('class', isOpens[index] ? iconClass[index] : 'icon ti ti-info-circle');

    switch (index) {
        case 0:
            if (!isOpens[0]) { getHeightmap(2); }
            break;
        case 1:
            if (!isOpens[1]) {
                const styleName = ((map.getStyle().metadata as Record<string, string>)['mapbox:origin']) || 'satellite-v9';
                (document.getElementById(styleName) as HTMLInputElement).checked = true;
            }
            break;
        case 2:
            // none
            break;
    }
}

function sanatizeMap(heightmap: (number | null)[][], xOffset: number, yOffset: number): number[][] {
    const citiesmapSize = 1081;
    const sanatizedMap = Create2DArray<number>(citiesmapSize, 0) as number[][];
    let lowestPositive = 100000;

    for (let y = yOffset; y < yOffset + citiesmapSize; y++) {
        for (let x = xOffset; x < xOffset + citiesmapSize; x++) {
            const h = heightmap[y][x] ?? 0;
            if (h >= 0 && h < lowestPositive) { lowestPositive = h; }
            sanatizedMap[y - yOffset][x - xOffset] = h;
        }
    }
    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            if (sanatizedMap[y][x] < 0) { sanatizedMap[y][x] = lowestPositive; }
        }
    }
    return sanatizedMap;
}

function sanatizeWatermap(watermap: (number | null)[][], xOffset: number, yOffset: number): number[][] {
    const citiesmapSize = 1081;
    const result = Create2DArray<number>(citiesmapSize, 0) as number[][];
    for (let y = yOffset; y < yOffset + citiesmapSize; y++) {
        for (let x = xOffset; x < xOffset + citiesmapSize; x++) {
            result[y - yOffset][x - xOffset] = watermap[y][x] ?? 0;
        }
    }
    return result;
}

function calcMinMaxHeight(heightmap: number[][]): { min: number; max: number } {
    const maxY = heightmap.length;
    const maxX = heightmap[0].length;
    const heights = { min: 100000, max: -100000 };
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            const h = heightmap[y][x];
            if (h > heights.max) heights.max = h;
            if (h < heights.min) heights.min = h;
        }
    }
    heights.min = heights.min / 10;
    heights.max = heights.max / 10;
    return heights;
}

function updateInfopanel() {
    const rhs = 17.28 / mapSize * 100;
    (document.getElementById('rHeightscale') as HTMLElement).innerHTML = rhs.toFixed(1);
    (document.getElementById('lng') as HTMLElement).innerHTML = grid.lng.toFixed(5);
    (document.getElementById('lat') as HTMLElement).innerHTML = grid.lat.toFixed(5);
    (document.getElementById('minh') as HTMLElement).innerHTML = String(grid.minHeight);
    (document.getElementById('maxh') as HTMLElement).innerHTML = String(grid.maxHeight);
}

function zoomIn() { map.zoomIn(); }
function zoomOut() { map.zoomOut(); }

function changeMapsize(el: HTMLInputElement) {
    mapSize = el.valueAsNumber;
    vmapSize = mapSize * 1.05;
    tileSize = mapSize / 9;
    setGrid(grid.lng, grid.lat, vmapSize);
    grid.minHeight = null;
    grid.maxHeight = null;
    updateInfopanel();
}

function setBaseLevel() {
    if (grid.minHeight === null) {
        new Promise<void>((resolve) => { getHeightmap(2, resolve); })
            .then(() => { scope['baseLevel'] = grid.minHeight; });
    } else {
        scope['baseLevel'] = grid.minHeight;
    }
    saveSettings();
}

function setHeightScale() {
    const computeScale = () =>
        Math.min(250, Math.floor((1024 - Number(scope['waterDepth'])) / ((grid.maxHeight ?? 0) - Number(scope['baseLevel'])) * 100));
    if (grid.maxHeight === null) {
        new Promise<void>((resolve) => { getHeightmap(2, resolve); })
            .then(() => { scope['heightScale'] = computeScale(); });
    } else {
        scope['heightScale'] = computeScale();
    }
    saveSettings();
}

function incPb(el: HTMLProgressElement, value = 1) {
    el.value = el.value + value;
}

function getHeightmap(mode = 0, callback?: () => void) {
    pbElement.value = 0;
    pbElement.style.visibility = 'visible';

    saveSettings();

    const extent = getExtent(grid.lng, grid.lat, mapSize / 1080 * 1081);

    let zoom = 13;
    incPb(pbElement);

    let x = long2tile(extent.topleft[0], zoom);
    let y = lat2tile(extent.topleft[1], zoom);
    const x2 = long2tile(extent.bottomright[0], zoom);
    const y2 = lat2tile(extent.bottomright[1], zoom);

    let tileCnt = Math.max(x2 - x + 1, y2 - y + 1);

    incPb(pbElement);
    if (tileCnt > 6) {
        let z = zoom;
        let tx: number, ty: number, tc: number;
        do {
            z--;
            tx = long2tile(extent.topleft[0], z);
            ty = lat2tile(extent.topleft[1], z);
            const tx2 = long2tile(extent.bottomright[0], z);
            const ty2 = lat2tile(extent.bottomright[1], z);
            tc = Math.max(tx2 - tx + 1, ty2 - ty + 1);
            incPb(pbElement);
        } while (tc > 6);
        x = tx;
        y = ty;
        zoom = z;
        tileCnt = tc;
    }

    const tileLng = tile2long(x, zoom);
    const tileLat = tile2lat(y, zoom);
    const tileLng2 = tile2long(x + tileCnt, zoom);
    const tileLat2 = tile2lat(y + tileCnt, zoom);

    const distance = (turf.distance(turf.point([tileLng, tileLat]), turf.point([tileLng2, tileLat2]), { units: 'kilometers' }) as number) / Math.SQRT2;
    const topDistance = turf.distance(turf.point([tileLng, tileLat]), turf.point([tileLng, extent.topleft[1]]), { units: 'kilometers' }) as number;
    const leftDistance = turf.distance(turf.point([tileLng, tileLat]), turf.point([extent.topleft[0], tileLat]), { units: 'kilometers' }) as number;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tiles = Create2DArray<any>(tileCnt);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vTiles = Create2DArray<any>(tileCnt);

    if (debug) {
        map.setLayoutProperty('debugLayer', 'visibility', 'visible');
        const line = turf.lineString([[tileLng, tileLat], [tileLng2, tileLat2]]);
        map.getSource('debug').setData(turf.bboxPolygon(turf.bbox(line)));
    }

    for (let i = 0; i < tileCnt; i++) {
        for (let j = 0; j < tileCnt; j++) {
            incPb(pbElement);
            const url = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/' + zoom + '/' + (x + j) + '/' + (y + i) + '@2x.pngraw?access_token=' + mapboxgl.accessToken;
            const woQUrl = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/' + zoom + '/' + (x + j) + '/' + (y + i) + '@2x.pngraw';
            downloadPngToTile(url, woQUrl).then((png) => { tiles[i][j] = png; });
        }
    }

    for (let i = 0; i < tileCnt; i++) {
        for (let j = 0; j < tileCnt; j++) {
            incPb(pbElement);
            const url = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/' + zoom + '/' + (x + j) + '/' + (y + i) + '.vector.pbf?access_token=' + mapboxgl.accessToken;
            const woQUrl = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/' + zoom + '/' + (x + j) + '/' + (y + i) + '.vector.pbf';
            downloadPbfToTile(url, woQUrl).then((data) => { vTiles[i][j] = data; });
        }
    }

    let ticks = 0;
    const timer = window.setInterval(function () {
        ticks++;
        incPb(pbElement);

        if (isDownloadComplete(tiles, vTiles)) {
            console.log('download ok');
            clearInterval(timer);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const heightmap = toHeightmap(tiles as any[][], distance);
            const xOffset = Math.round(leftDistance / distance * heightmap.length);
            const yOffset = Math.round(topDistance / distance * heightmap.length);
            const sanatizedMap = sanatizeMap(heightmap, xOffset, yOffset);
            const heights = calcMinMaxHeight(sanatizedMap);
            grid.minHeight = heights.min;
            grid.maxHeight = heights.max;

            pbElement.value = 500;
            if (typeof callback === 'function') callback();

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const watermap = sanatizeWatermap(toWatermap(vTiles as any[][], heightmap.length), xOffset, yOffset);

            switch (mode) {
                case 0: {
                    const savedDrawGrid = (document.getElementById('drawGrid') as HTMLInputElement).checked;
                    (document.getElementById('drawGrid') as HTMLInputElement).checked = false;
                    const citiesmap0 = toCitiesmap(sanatizedMap, watermap);
                    download('heightmap.raw', new Uint8Array(citiesmap0.buffer as ArrayBuffer));
                    (document.getElementById('drawGrid') as HTMLInputElement).checked = savedDrawGrid;
                    break;
                }
                case 1: {
                    const citiesmap1 = toCitiesmap(sanatizedMap, watermap);
                    const png1 = UPNG.encodeLL([citiesmap1.buffer as ArrayBuffer], 1081, 1081, 1, 0, 16);
                    download('heightmap.png', png1);
                    break;
                }
                case 2:
                    updateInfopanel();
                    break;
                case 3: {
                    const citiesmap3 = toCitiesmap(sanatizedMap, watermap);
                    const png3 = UPNG.encodeLL([citiesmap3.buffer as ArrayBuffer], 1081, 1081, 1, 0, 16);
                    downloadAsZip(png3, 1);
                    break;
                }
                case 255: {
                    const canvas255 = toTerrainRGB(heightmap);
                    const url255 = canvas255.toDataURL('image/png').replace('image/png', 'image/octet-stream');
                    download('tiles.png', null, url255);
                    break;
                }
            }
            console.log('complete in ', ticks * 10, ' ms');
            pbElement.style.visibility = 'hidden';
            pbElement.value = 0;
        }

        if (ticks >= 4096) {
            clearInterval(timer);
            console.error('timeout!');
            pbElement.value = 0;
        }
    }, 10);
}

async function getOSMData() {
    const bounds = getExtent(grid.lng, grid.lat, mapSize);
    const minLng = Math.min(bounds.topleft[0], bounds.bottomright[0]);
    const minLat = Math.min(bounds.topleft[1], bounds.bottomright[1]);
    const maxLng = Math.max(bounds.topleft[0], bounds.bottomright[0]);
    const maxLat = Math.max(bounds.topleft[1], bounds.bottomright[1]);
    const url = 'https://overpass-api.de/api/map?bbox=' + minLng + ',' + minLat + ',' + maxLng + ',' + maxLat;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const osm = await response.blob();
            download('map.osm', osm);
        } else {
            throw new Error('download map error: ' + String(response.status));
        }
    } catch (e) { console.log((e as Error).message); }
}

async function getMapImage() {
    const bounds = getExtent(grid.lng, grid.lat, mapSize);
    const minLng = Math.min(bounds.topleft[0], bounds.bottomright[0]);
    const minLat = Math.min(bounds.topleft[1], bounds.bottomright[1]);
    const maxLng = Math.max(bounds.topleft[0], bounds.bottomright[0]);
    const maxLat = Math.max(bounds.topleft[1], bounds.bottomright[1]);
    const url = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/[' + minLng + ',' + minLat + ',' + maxLng + ',' + maxLat + ']/1280x1280@2x?access_token=' + mapboxgl.accessToken;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const png = await response.blob();
            download('map.png', png);
        } else {
            throw new Error('download map error: ' + String(response.status));
        }
    } catch (e) { console.log((e as Error).message); }
}

function autoSettings(withMap = true) {
    scope['mapSize'] = 17.28;
    scope['waterDepth'] = defaultWaterdepth;
    mapSize = Number(scope['mapSize']);
    vmapSize = mapSize * 1.05;
    tileSize = mapSize / 9;

    if (withMap) {
        new Promise<void>((resolve) => { getHeightmap(2, resolve); }).then(() => {
            scope['baseLevel'] = grid.minHeight;
            scope['heightScale'] = Math.min(250, Math.floor((1024 - Number(scope['waterDepth'])) / ((grid.maxHeight ?? 0) - Number(scope['baseLevel'])) * 100));
        });
    }

    setGrid(grid.lng, grid.lat, vmapSize);
    (document.getElementById('drawStrm') as HTMLInputElement).checked = true;
    (document.getElementById('drawMarker') as HTMLInputElement).checked = true;
    (document.getElementById('drawGrid') as HTMLInputElement).checked = true;
    (document.getElementById('plainsHeight') as HTMLInputElement).value = '140';
    (document.getElementById('blurPasses') as HTMLInputElement).value = '10';
    (document.getElementById('blurPostPasses') as HTMLInputElement).value = '2';
    (document.getElementById('streamDepth') as HTMLInputElement).value = '7';
}

function isDownloadComplete(tiles: (unknown | null)[][], vTiles: (unknown | null)[][]) {
    const tileNum = tiles.length;
    for (let i = 0; i < tileNum; i++) {
        for (let j = 0; j < tileNum; j++) {
            if (!tiles[i][j] || !vTiles[i][j]) return false;
        }
    }
    return true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toWatermap(vTiles: any[][], length: number): (number | null)[][] {
    const tileCnt = vTiles.length;
    const canvas = document.getElementById('wMap-canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

    canvas.width = length;
    canvas.height = length;

    const coef = length / (tileCnt * 4096);

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, length, length);
    ctx.fillStyle = '#000000';
    ctx.beginPath();

    for (let ty = 0; ty < tileCnt; ty++) {
        for (let tx = 0; tx < tileCnt; tx++) {
            if (typeof vTiles[ty][tx] !== 'boolean') {
                if (vTiles[ty][tx].layers.water) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const geo = vTiles[ty][tx].layers.water.feature(0).loadGeometry() as any[][];
                    for (let i = 0; i < geo.length; i++) {
                        ctx.moveTo(Math.round(geo[i][0].x * coef + (tx * length / tileCnt)), Math.round(geo[i][0].y * coef + (ty * length / tileCnt)));
                        for (let j = 1; j < geo[i].length; j++) {
                            ctx.lineTo(Math.round(geo[i][j].x * coef + (tx * length / tileCnt)), Math.round(geo[i][j].y * coef + (ty * length / tileCnt)));
                        }
                    }
                }
            }
        }
    }
    ctx.closePath();
    ctx.fill();

    if ((document.getElementById('drawStrm') as HTMLInputElement).checked) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let ty = 0; ty < tileCnt; ty++) {
            for (let tx = 0; tx < tileCnt; tx++) {
                if (typeof vTiles[ty][tx] !== 'boolean') {
                    if (vTiles[ty][tx].layers.waterway) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const geo = vTiles[ty][tx].layers.waterway.feature(0).loadGeometry() as any[][];
                        for (let i = 0; i < geo.length; i++) {
                            ctx.moveTo(Math.round(geo[i][0].x * coef + (tx * length / tileCnt)), Math.round(geo[i][0].y * coef + (ty * length / tileCnt)));
                            for (let j = 1; j < geo[i].length; j++) {
                                ctx.lineTo(Math.round(geo[i][j].x * coef + (tx * length / tileCnt)), Math.round(geo[i][j].y * coef + (ty * length / tileCnt)));
                            }
                        }
                    }
                }
            }
        }
        ctx.stroke();
    }

    const watermap = Create2DArray<number>(length, 1) as (number | null)[][];
    const img = ctx.getImageData(0, 0, length, length);
    for (let i = 0; i < length; i++) {
        for (let j = 0; j < length; j++) {
            watermap[i][j] = img.data[i * length * 4 + j * 4] / 255;
        }
    }
    return watermap;
}

function filterMap(mapData: number[][], fromLevel: number, toLevel: number, kernel: number[][]): number[][] {
    const maxY = mapData.length;
    const maxX = mapData[0].length;
    const kernelDist = Math.floor((kernel.length - 1) / 2);
    const filteredMap = Create2DArray<number>(maxY, 0) as number[][];

    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = mapData[y][x];
            if (h >= fromLevel && h < fromLevel + toLevel) {
                let sum = 0;
                let cnt = 0;
                for (let i = -kernelDist; i <= kernelDist; i++) {
                    for (let j = -kernelDist; j <= kernelDist; j++) {
                        if (y + i >= 0 && y + i < maxY && x + j >= 0 && x + j < maxX) {
                            cnt += kernel[i + kernelDist][j + kernelDist];
                            sum += mapData[y + i][x + j] * kernel[i + kernelDist][j + kernelDist];
                        }
                    }
                }
                if (cnt) h = sum / cnt;
            }
            filteredMap[y][x] = h;
        }
    }
    return filteredMap;
}

interface GravityPoint { x?: number; y?: number; }

function tiltMap(mapData: number[][], gravityCenter: number, waterDepth: number): number[][] {
    const maxY = mapData.length;
    const maxX = mapData[0].length;
    const tiltedMap = Create2DArray<number>(maxY, 0) as number[][];
    const gravityPoint: GravityPoint = {};

    switch (gravityCenter) {
        case 1: gravityPoint.x = Math.floor(maxX / 2); gravityPoint.y = Math.floor(maxY / 2); break;
        case 2: gravityPoint.x = Math.floor(maxX / 2); gravityPoint.y = 0; break;
        case 3: gravityPoint.x = maxX; gravityPoint.y = 0; break;
        case 4: gravityPoint.x = maxX; gravityPoint.y = Math.floor(maxY / 2); break;
        case 5: gravityPoint.x = maxX; gravityPoint.y = maxY; break;
        case 6: gravityPoint.x = Math.floor(maxX / 2); gravityPoint.y = maxY; break;
        case 7: gravityPoint.x = 0; gravityPoint.y = maxY; break;
        case 8: gravityPoint.x = 0; gravityPoint.y = Math.floor(maxY / 2); break;
        case 9: gravityPoint.x = 0; gravityPoint.y = 0; break;
        case 10: gravityPoint.y = 0; break;
        case 11: gravityPoint.x = maxX; break;
        case 12: gravityPoint.y = maxY; break;
        case 13: gravityPoint.x = 0; break;
    }

    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            const h = mapData[y][x];
            let relDistance = 0;
            switch (gravityCenter) {
                case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9:
                    relDistance = Math.sqrt(Math.pow((gravityPoint.x ?? 0) - x, 2) + Math.pow((gravityPoint.y ?? 0) - y, 2)) / maxY;
                    break;
                case 10: case 12:
                    relDistance = Math.abs((gravityPoint.y ?? 0) - y) / maxY;
                    break;
                case 11: case 13:
                    relDistance = Math.abs((gravityPoint.x ?? 0) - x) / maxX;
                    break;
            }
            tiltedMap[y][x] = h + Math.round(waterDepth * relDistance * 100) / 100;
        }
    }

    if (gravityCenter === 0) {
        console.log('no map tilting');
    } else {
        console.log(`tilted map in direction ${gravityCenter} with ${waterDepth} m`);
    }
    return tiltedMap;
}

function interpolateArray(data: number[], fitCount: number): number[] {
    const linearInterpolate = (before: number, after: number, atPoint: number) => before + (after - before) * atPoint;
    const newData: number[] = new Array(fitCount) as number[];
    const springFactor = (data.length - 1) / (fitCount - 1);
    newData[0] = data[0];
    for (let i = 1; i < fitCount - 1; i++) {
        const tmp = i * springFactor;
        const before = Math.floor(tmp);
        const after = Math.ceil(tmp);
        newData[i] = linearInterpolate(data[before], data[after], tmp - before);
    }
    newData[fitCount - 1] = data[data.length - 1];
    return newData;
}

function levelMap(mapData: number[][], min: number, max: number, style: number): number[][] {
    let curve: number[];
    switch (style) {
        case 1: curve = [0.1, 1, 1.9]; break;
        case 2: curve = [0.15, 0.45, 0.75, 1.1, 1.4, 1.7, 1.9, 1.9]; break;
        case 3: curve = [0.1, 0.2, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]; break;
        case 9: curve = [0.1, 0.2, 0.5, 1, 1.3, 1.7, 2.5]; break;
        default: console.log('no map leveling'); return mapData;
    }

    const interpolatedCurve = interpolateArray(curve, 256);
    const maxY = mapData.length;
    const maxX = mapData[0].length;
    const elevationStep = Math.round((max - min) / interpolatedCurve.length);
    const levels: number[] = [min];
    let lastLevel = min;
    for (let i = 0; i < interpolatedCurve.length; i++) {
        levels.push(Math.round((lastLevel + elevationStep * interpolatedCurve[i]) * 10) / 10);
        lastLevel = levels[i + 1];
    }

    const leveledMap = Create2DArray<number>(maxY, 0) as number[][];
    let highestHeight = 0;
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = mapData[y][x];
            if (h - min > 0) {
                const idx = Math.min(interpolatedCurve.length - 1, Math.floor((h - min) / elevationStep));
                h = levels[idx] + ((h - levels[idx]) * interpolatedCurve[idx]);
                h = Math.round(h * 10) / 10;
            }
            leveledMap[y][x] = h;
            if (h > highestHeight) highestHeight = h;
        }
    }

    console.log(`min ${min} max ${max} highest height ${highestHeight}`);
    let rescale = 10;
    if (highestHeight > max) {
        rescale = Math.floor((max - min) / highestHeight * 100) / 10;
        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < maxX; x++) {
                const h = leveledMap[y][x];
                if (h - min > 0) { leveledMap[y][x] = Math.round(h * rescale) / 10; }
            }
        }
    }
    console.log(`leveled map with style ${style}, rescale ${rescale / 10}`);
    return leveledMap;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toHeightmap(tiles: any[][], distance: number): number[][] {
    const tileNum = tiles.length;
    const srcMap = Create2DArray<number>(tileNum * 512, 0) as number[][];
    const heightmap = Create2DArray<number>(Math.ceil(1080 * (distance / mapSize)), 0) as number[][];
    const smSize = srcMap.length;
    const hmSize = heightmap.length;
    const r = (hmSize - 1) / (smSize - 1);

    for (let i = 0; i < tileNum; i++) {
        for (let j = 0; j < tileNum; j++) {
            const tile = new Uint8Array(UPNG.toRGBA8(tiles[i][j])[0] as ArrayBuffer);
            for (let y = 0; y < 512; y++) {
                for (let x = 0; x < 512; x++) {
                    const tileIndex = y * 512 * 4 + x * 4;
                    srcMap[i * 512 + y][j * 512 + x] = -100000 + (tile[tileIndex] * 256 * 256 + tile[tileIndex + 1] * 256 + tile[tileIndex + 2]);
                }
            }
        }
    }

    const hmIndex: number[] = Array(hmSize) as number[];
    for (let i = 0; i < hmSize; i++) { hmIndex[i] = i / r; }
    for (let i = 0; i < hmSize - 1; i++) {
        for (let j = 0; j < hmSize - 1; j++) {
            const y0 = Math.floor(hmIndex[i]);
            const x0 = Math.floor(hmIndex[j]);
            const y1 = y0 + 1;
            const x1 = x0 + 1;
            const dy = hmIndex[i] - y0;
            const dx = hmIndex[j] - x0;
            heightmap[i][j] = Math.round((1 - dx) * (1 - dy) * srcMap[y0][x0] + dx * (1 - dy) * srcMap[y0][x1] + (1 - dx) * dy * srcMap[y1][x0] + dx * dy * srcMap[y1][x1]);
        }
    }
    for (let i = 0; i < hmSize; i++) { heightmap[i][hmSize - 1] = srcMap[i][hmSize - 1]; }
    for (let j = 0; j < hmSize; j++) { heightmap[hmSize - 1][j] = srcMap[hmSize - 1][j]; }
    return heightmap;
}

function toTerrainRGB(heightmap: number[][]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    canvas.width = heightmap.length;
    canvas.height = heightmap.length;
    const img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const index = y * canvas.width * 4 + x * 4;
            img.data[index + 0] = Math.floor(Math.floor((heightmap[y][x] + 100000) / 256) / 256);
            img.data[index + 1] = Math.floor((heightmap[y][x] + 100000) / 256) % 256;
            img.data[index + 2] = (heightmap[y][x] + 100000) % 256;
            img.data[index + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

function toCitiesmap(heightmap: number[][], watermap: number[][]): Uint8ClampedArray {
    const citiesmapSize = 1081;
    const citiesmap = new Uint8ClampedArray(2 * citiesmapSize * citiesmapSize);
    let workingmap = Create2DArray<number>(citiesmapSize, 0) as number[][];

    const waterDepth = Math.round(Number(scope['waterDepth']) / parseFloat(String(scope['heightScale'])) * 100 * 10) / 10;

    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            const height = heightmap[y][x] - Number(scope['baseLevel']) * 10;
            const calcHeight = (height + Math.round(waterDepth * 10 * watermap[y][x])) / 10;
            workingmap[y][x] = Math.max(0, calcHeight);
        }
    }

    workingmap = levelMap(workingmap, (grid.minHeight ?? 0) + waterDepth, grid.maxHeight ?? 0, Number(scope['levelCorrection']));

    const passes = parseInt((document.getElementById('blurPasses') as HTMLInputElement).value);
    const postPasses = parseInt((document.getElementById('blurPostPasses') as HTMLInputElement).value);
    const plainsHeight = parseInt((document.getElementById('plainsHeight') as HTMLInputElement).value);
    for (let l = 0; l < passes; l++) { workingmap = filterMap(workingmap, 0, plainsHeight + waterDepth, meanKernel); }
    for (let l = 0; l < postPasses; l++) { workingmap = filterMap(workingmap, plainsHeight + waterDepth, grid.maxHeight ?? 0, sharpenKernel); }

    const streamDepth = parseInt((document.getElementById('streamDepth') as HTMLInputElement).value);
    let highestWaterHeight = 0;
    if ((document.getElementById('drawStrm') as HTMLInputElement).checked) {
        for (let y = 0; y < citiesmapSize; y++) {
            for (let x = 0; x < citiesmapSize; x++) {
                const height = workingmap[y][x];
                if (height > highestWaterHeight) { highestWaterHeight = height; }
                if (height > streamDepth) { workingmap[y][x] = height - (1 - watermap[y][x]) * streamDepth; }
            }
        }
    }

    let tiltHeight = parseInt((document.getElementById('tiltHeight') as HTMLInputElement).value);
    tiltHeight = Math.round(tiltHeight / parseFloat(String(scope['heightScale'])) * 100 * 10) / 10;
    workingmap = tiltMap(workingmap, Number(scope['gravityCenter']), tiltHeight);

    for (let l = 0; l < postPasses; l++) { workingmap = filterMap(workingmap, 0, highestWaterHeight, meanKernel); }

    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            let h = Math.round(workingmap[y][x] / 100 * parseFloat(String(scope['heightScale'])) / 0.015625);
            if (h > 65535) h = 65535;
            const index = y * citiesmapSize * 2 + x * 2;
            citiesmap[index + 0] = h >> 8;
            citiesmap[index + 1] = h & 255;
        }
    }

    if ((document.getElementById('drawGrid') as HTMLInputElement).checked) {
        for (let y = 0; y < citiesmapSize; y++) {
            for (let x = 0; x < citiesmapSize; x++) {
                if (y % 120 === 0 || x % 120 === 0) {
                    const index = y * citiesmapSize * 2 + x * 2;
                    citiesmap[index + 0] = 127;
                    citiesmap[index + 1] = 255;
                }
            }
        }
    }

    if ((document.getElementById('drawMarker') as HTMLInputElement).checked) {
        citiesmap[0] = 255; citiesmap[1] = 255; citiesmap[2] = 0; citiesmap[3] = 0;
    }

    const bounds = getExtent(grid.lng, grid.lat, mapSize);
    console.log(bounds.topleft[0], bounds.topleft[1], bounds.bottomright[0], bounds.bottomright[1]);
    return citiesmap;
}

function download(filename: string, data: BlobPart | null, url: string | false = false) {
    const a = window.document.createElement('a');
    if (url) {
        a.href = url;
    } else if (data !== null) {
        a.href = window.URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function downloadPngToTile(url: string, withoutQueryUrl = url) {
    const cachedRes = await caches.match(url, { ignoreSearch: true });
    if (cachedRes && cachedRes.ok) {
        console.log('terrain-rgb: load from cache');
        return UPNG.decode(await cachedRes.arrayBuffer());
    } else {
        console.log('terrain-rgb: load by fetch, cache downloaded file');
        try {
            const response = await fetch(url);
            if (response.ok) {
                const pngData = await response.arrayBuffer();
                const png = UPNG.decode(pngData);
                cache.put(withoutQueryUrl, response.clone());
                return png;
            } else {
                throw new Error('download terrain-rgb error: ' + String(response.status));
            }
        } catch (e) { console.log((e as Error).message); }
    }
}

async function downloadPbfToTile(url: string, withoutQueryUrl = url) {
    const cachedRes = await caches.match(url, { ignoreSearch: true });
    if (cachedRes && cachedRes.ok) {
        console.log('pbf: load from cache');
        return new VectorTile(new Protobuf(new Uint8Array(await cachedRes.arrayBuffer())));
    } else {
        console.log('pbf: load by fetch, cache downloaded file');
        try {
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.arrayBuffer();
                const tile = new VectorTile(new Protobuf(new Uint8Array(data)));
                cache.put(withoutQueryUrl, response.clone());
                return tile;
            } else {
                throw new Error('download Pbf error: ' + String(response.status));
            }
        } catch (e) {
            console.log((e as Error).message);
            return true;
        }
    }
}

function downloadAsZip(data: BlobPart, mode: number) {
    const filename = prompt('Please enter your map name', 'HeightMap');
    if (filename == null) { return; }
    const zip = new JSZip();
    zip.file('info.txt', getInfo(filename));
    const imageName = mode === 0 ? filename + '.raw' : (mode === 1 ? filename + '.png' : filename + '-tiles.png');
    zip.file(imageName, data, { binary: true });
    zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 1 } })
        .then((content) => { download(filename + '.zip', content); });
}

function getInfo(fileName: string): string {
    return 'Heightmap name: ' + fileName + '\n\n' +
        '/* Generated by Cities: Skylines online heightmap generator */\n\n' +
        'Longitude: ' + grid.lng.toFixed(5) + '\n' +
        'Latitude: ' + grid.lat.toFixed(5) + '\n' +
        'Min Height: ' + String(grid.minHeight) + '\n' +
        'Max Height: ' + String(grid.maxHeight) + '\n' +
        'Water contours: ' + String(grid.waterContours) + '\n' +
        'Height contours: ' + String(grid.heightContours) + '\n' +
        'Zoom: ' + String(grid.zoom) + '\n';
}

function getApiToken(): string {
    return localStorage.getItem('mapboxApiToken') ?? 'null';
}

function saveApiToken() {
    const token = (document.getElementById('mapboxApiToken') as HTMLInputElement).value;
    if (token) {
        localStorage.setItem('mapboxApiToken', token);
        alert('API token saved! Refresh the page to apply the changes.');
    } else {
        alert('Please enter a valid API token.');
    }
}

function showAlert() {
    if ((localStorage.getItem('mapboxApiToken') ?? 'null') === 'null') {
        alert('Set MAPBOX API TOKEN in the settings panel (expand \'I\' icon) and refresh page!\n\n' +
            'You can get it for free at https://www.mapbox.com/\n\n' +
            'This is required for this app to work properly!');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('mapboxApiToken');
    if (savedToken) {
        (document.getElementById('mapboxApiToken') as HTMLInputElement).value = savedToken;
    }
});

// ── Expose functions needed by HTML onclick / onmouseup / onkeyup attrs ───────

declare global {
    interface Window {
        togglePanel: typeof togglePanel;
        getHeightmap: typeof getHeightmap;
        getOSMData: typeof getOSMData;
        getMapImage: typeof getMapImage;
        autoSettings: typeof autoSettings;
        showHeightContours: typeof showHeightContours;
        showWaterContours: typeof showWaterContours;
        zoomIn: typeof zoomIn;
        zoomOut: typeof zoomOut;
        setMapStyle: typeof setMapStyle;
        setLngLat: typeof setLngLat;
        changeMapsize: typeof changeMapsize;
        setBaseLevel: typeof setBaseLevel;
        setHeightScale: typeof setHeightScale;
        deleteCaches: typeof deleteCaches;
        saveApiToken: typeof saveApiToken;
        showAlert: typeof showAlert;
    }
}

Object.assign(window, {
    togglePanel, getHeightmap, getOSMData, getMapImage, autoSettings,
    showHeightContours, showWaterContours, zoomIn, zoomOut, setMapStyle,
    setLngLat, changeMapsize, setBaseLevel, setHeightScale, deleteCaches,
    saveApiToken, showAlert,
});
