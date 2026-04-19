// @ts-nocheck
'use strict';
const defaultWaterdepth = 40;
// see: https://www.taylorpetrick.com/blog/post/convolution-part3
const meanKernel = [
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 1]
];
const sharpenKernel = [
    [-0.00391, -0.01563, -0.02344, -0.01563, -0.00391],
    [-0.01563, -0.06250, -0.09375, -0.06250, -0.01563],
    [-0.02344, -0.09375, +1.85980, -0.09375, -0.02344],
    [-0.01563, -0.06250, -0.09375, -0.06250, -0.01563],
    [-0.00391, -0.01563, -0.02344, -0.01563, -0.00391]
];
var vmapSize = 18.144;
var mapSize = 17.28;
var tileSize = 1.92;
var grid = loadSettings();
var mapCanvas;
var cache;
var panels = document.getElementsByClassName('panel');
var icons = document.getElementsByClassName('icon');
var iconClass = [];
for (let i = 0; i < panels.length; i++) {
    iconClass.push(icons[i].className);
}
let debug = !!new URL(window.location.href).searchParams.get('debug');
let debugElements = document.getElementsByClassName('debug');
if (debug)
    while (debugElements.length > 0) {
        debugElements[0].classList.remove('debug');
    }
// Set the Mapbox API token
mapboxgl.accessToken = getApiToken();
var map = new mapboxgl.Map({
    container: 'map', // Specify the container ID
    style: 'mapbox://styles/mapbox/outdoors-v12', // Specify which map style to use
    //style: 'mapbox://styles/mapbox/streets-v11',  // Specify which map style to use
    center: [grid.lng, grid.lat], // Specify the starting position [lng, lat]
    zoom: grid.zoom, // Specify the starting zoom
    preserveDrawingBuffer: true
});
var geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    marker: false
});
const pbElement = document.getElementById('progress');
document.getElementById('geocoder').appendChild(geocoder.onAdd(map));
map.on('load', function () {
    mapCanvas = map.getCanvasContainer();
    scope.mapSize = mapSize;
    scope.baseLevel = 0;
    scope.heightScale = 100;
    caches.open('tiles').then((data) => cache = data);
});
map.on('style.load', function () {
    addSource();
    addLayer();
    setDebug();
    setMouse();
    showWaterLayer();
    showHeightLayer();
});
map.on('click', function (e) {
    grid.lng = e.lngLat.lng;
    grid.lat = e.lngLat.lat;
    setGrid(grid.lng, grid.lat, vmapSize);
    map.panTo(new mapboxgl.LngLat(grid.lng, grid.lat));
    saveSettings();
    hideDebugLayer();
    updateInfopanel();
});
map.on('idle', function () {
    // scope can be set if bindings.js is loaded (because of docReady) 
    scope.waterDepth = parseInt(grid.waterDepth) || 50;
    scope.gravityCenter = parseInt(grid.gravityCenter) || 0;
    scope.levelCorrection = parseInt(grid.levelCorrection) || 0;
    saveSettings();
});
geocoder.on('result', function (query) {
    grid.lng = query.result.center[0];
    grid.lat = query.result.center[1];
    setGrid(grid.lng, grid.lat, vmapSize);
    map.setZoom(10.2);
    saveSettings();
    hideDebugLayer();
    updateInfopanel();
});
function onMove(e) {
    grid.lng = e.lngLat.lng;
    grid.lat = e.lngLat.lat;
    setGrid(e.lngLat.lng, e.lngLat.lat, vmapSize);
}
function onUp(e) {
    grid.lng = e.lngLat.lng;
    grid.lat = e.lngLat.lat;
    setGrid(e.lngLat.lng, e.lngLat.lat, vmapSize);
    // Unbind mouse/touch events
    map.off('mousemove', onMove);
    map.off('touchmove', onMove);
    hideDebugLayer();
    updateInfopanel();
}
function addSource() {
    map.addSource('grid', {
        'type': 'geojson',
        'data': getGrid(grid.lng, grid.lat, vmapSize)
    });
    map.addSource('playable', {
        'type': 'geojson',
        'data': getGrid(grid.lng, grid.lat, vmapSize / 9 * 5)
    });
    map.addSource('start', {
        'type': 'geojson',
        'data': getGrid(grid.lng, grid.lat, vmapSize / 9)
    });
    map.addSource('mapbox-streets', {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-streets-v12'
    });
    map.addSource('contours', {
        type: 'vector',
        url: 'mapbox://mapbox.mapbox-terrain-v2'
    });
}
function addLayer() {
    map.addLayer({
        'id': 'gridlines',
        'type': 'fill',
        'source': 'grid',
        'paint': {
            'fill-color': 'gray',
            'fill-outline-color': 'gray',
            'fill-opacity': 0.25
        }
    });
    map.addLayer({
        'id': 'playablesquare',
        'type': 'fill',
        'source': 'playable',
        'paint': {
            'fill-color': 'green',
            'fill-outline-color': 'green',
            'fill-opacity': 0.3
        }
    });
    map.addLayer({
        'id': 'startsquare',
        'type': 'fill',
        'source': 'start',
        'paint': {
            'fill-color': 'blue',
            'fill-outline-color': 'blue',
            'fill-opacity': 0.1
        }
    });
    map.addLayer({
        'id': 'contours',
        'type': 'line',
        'source': 'contours',
        'source-layer': 'contour',
        'layout': {
            'visibility': 'visible',
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': '#877b59',
            'line-width': 0.25
        }
    });
    map.addLayer({
        'id': 'water-streets',
        'source': 'mapbox-streets',
        'source-layer': 'water',
        'type': 'fill',
        'paint': {
            'fill-color': 'rgba(66,100,225, 0.3)',
            'fill-outline-color': 'rgba(33,33,255, 1)'
        }
    });
}
function setDebug() {
    // debug: area that is downloaded
    if (debug) {
        map.addSource('debug', {
            'type': 'geojson',
            // 'data': turf.squareGrid([0, 0, 0, 0], tileSize, { units: 'kilometers' })
            'data': turf.bboxPolygon(turf.bbox(turf.lineString([0, 0], [0, 0])))
        });
        map.addLayer({
            'id': 'debugLayer',
            'type': 'line',
            'source': 'debug',
            'paint': {
                'line-color': 'orangered',
                'line-width': 1
            },
            'layout': {
                'visibility': 'none'
            },
        });
        document.getElementById('wMap-canvas').style.visibility = 'visible';
        document.getElementById('dcBox').style.display = 'block';
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
    map.on('mousedown', 'startsquare', function (e) {
        // Prevent the default map drag behavior.
        e.preventDefault();
        mapCanvas.style.cursor = 'grab';
        map.on('mousemove', onMove);
        map.once('mouseup', onUp);
    });
    map.on('touchstart', 'startsquare', function (e) {
        if (e.points.length !== 1)
            return;
        // Prevent the default map drag behavior.
        e.preventDefault();
        map.on('touchmove', onMove);
        map.once('touchend', onUp);
    });
}
function showHeightContours(el) {
    grid.heightContours = !grid.heightContours;
    if (grid.heightContours) {
        el.classList.add('active');
    }
    else {
        el.classList.remove('active');
    }
    showHeightLayer();
}
function showHeightLayer() {
    let el = document.getElementById('showHeightContours');
    if (grid.heightContours) {
        if (!el.classList.contains('active'))
            el.classList.add('active');
        map.setLayoutProperty('contours', 'visibility', 'visible');
    }
    else {
        if (el.classList.contains('active'))
            el.classList.remove('active');
        map.setLayoutProperty('contours', 'visibility', 'none');
    }
}
function showWaterContours(el) {
    grid.waterContours = !grid.waterContours;
    if (grid.waterContours) {
        el.classList.add('active');
    }
    else {
        el.classList.remove('active');
    }
    showWaterLayer();
}
function showWaterLayer() {
    let el = document.getElementById('showWaterContours');
    if (grid.waterContours) {
        if (!el.classList.contains('active'))
            el.classList.add('active');
        map.setLayoutProperty('water-streets', 'visibility', 'visible');
    }
    else {
        if (el.classList.contains('active'))
            el.classList.remove('active');
        map.setLayoutProperty('water-streets', 'visibility', 'none');
    }
}
function deleteCaches() {
    if (confirm('Delete the caches.\nIs that okay?')) {
        caches.delete('tiles').then(() => {
            caches.open('tiles').then((data) => cache = data);
        });
    }
}
function setMapStyle(el) {
    const layerId = el.id;
    map.setStyle('mapbox://styles/mapbox/' + layerId);
}
function setLngLat(mode) {
    let lngInput = document.getElementById('lngInput');
    let latInput = document.getElementById('latInput');
    switch (mode) {
        case 0:
            lngInput.value = grid.lng;
            latInput.value = grid.lat;
            break;
        case 1:
            lngInput.value = '';
            latInput.value = '';
            break;
        case 2:
            if ((lngInput.value) && (latInput.value)) {
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
    if (debug)
        map.setLayoutProperty('debugLayer', 'visibility', 'none');
    grid.minHeight = null;
    grid.maxHeight = null;
}
function setGrid(lng, lat, size) {
    map.getSource('grid').setData(getGrid(lng, lat, size));
    map.getSource('start').setData(getGrid(lng, lat, size / 9));
    map.getSource('playable').setData(getGrid(lng, lat, size / 9 * 5));
    grid.zoom = map.getZoom();
}
function getExtent(lng, lat, size = vmapSize) {
    let dist = Math.sqrt(2 * Math.pow(size / 2, 2));
    let point = turf.point([lng, lat]);
    let topleft = turf.destination(point, dist, -45, { units: 'kilometers' }).geometry.coordinates;
    let bottomright = turf.destination(point, dist, 135, { units: 'kilometers' }).geometry.coordinates;
    return { 'topleft': topleft, 'bottomright': bottomright };
}
function getGrid(lng, lat, size) {
    let extent = getExtent(lng, lat, size);
    return turf.squareGrid([extent.topleft[0], extent.topleft[1], extent.bottomright[0], extent.bottomright[1]], tileSize, { units: 'kilometers' });
}
function loadSettings() {
    let stored = JSON.parse(localStorage.getItem('grid')) || {};
    // San Francisco
    stored.lng = parseFloat(stored.lng) || -122.43877;
    stored.lat = parseFloat(stored.lat) || 37.75152;
    stored.zoom = parseFloat(stored.zoom) || 11.0;
    stored.minHeight = parseFloat(stored.minHeight) || 0;
    stored.maxHeight = parseFloat(stored.maxHeight) || 0;
    stored.heightContours = stored.heightContours || false;
    stored.waterContours = stored.waterContours || false;
    // TODO: do not set global vars!
    document.getElementById('waterDepth').value = parseInt(stored.waterDepth) || defaultWaterdepth;
    document.getElementById('tiltHeight').value = parseInt(stored.tiltHeight) || parseInt(stored.waterDepth / 2);
    document.getElementById('drawGrid').checked = stored.drawGrid || false;
    document.getElementById('drawStrm').checked = stored.drawStreams || false;
    document.getElementById('drawMarker').checked = stored.drawMarker || false;
    document.getElementById('blurPasses').value = parseInt(stored.blurPasses) || 7;
    document.getElementById('blurPostPasses').value = parseInt(stored.blurPostPasses) || 3;
    document.getElementById('plainsHeight').value = parseInt(stored.plainsHeight) || 140;
    document.getElementById('streamDepth').value = parseInt(stored.streamDepth) || 140;
    return stored;
}
function saveSettings() {
    grid.zoom = map.getZoom();
    grid.drawGrid = document.getElementById('drawGrid').checked;
    grid.waterDepth = parseInt(document.getElementById('waterDepth').value);
    grid.drawStreams = document.getElementById('drawStrm').checked;
    grid.drawMarker = document.getElementById('drawMarker').checked;
    grid.plainsHeight = parseInt(document.getElementById('plainsHeight').value);
    grid.blurPasses = parseInt(document.getElementById('blurPasses').value);
    grid.blurPostPasses = parseInt(document.getElementById('blurPostPasses').value);
    grid.streamDepth = parseInt(document.getElementById('streamDepth').value);
    grid.gravityCenter = scope.gravityCenter;
    grid.tiltHeight = parseInt(document.getElementById('tiltHeight').value);
    grid.levelCorrection = scope.levelCorrection;
    localStorage.setItem('grid', JSON.stringify(grid));
}
/**
 * @template T
 * @param {number} rows
 * @param {T} [def]
 */
function Create2DArray(rows, def = null) {
    let arr = new Array(rows);
    for (let i = 0; i < rows; i++) {
        arr[i] = new Array(rows).fill(def);
    }
    return arr;
}
// for debugging maps (2 dimensinal array), and 1 dimensional arrays
// use a format that is understood by excel (comma delimeted)
// and locale of the browser (and thus excel i presume)
function exportToCSV(mapData) {
    let csvRows = [];
    function isNumber(n) { return !isNaN(parseFloat(n)) && !isNaN(n - 0); }
    for (var i = 0, l = mapData.length; i < l; ++i) {
        let val = mapData[i];
        // test for array dimension
        if (Array.isArray(val)) {
            if (isNumber(val[0])) {
                csvRows.push(val.map(x => x.toLocaleString(undefined)).join('\t'));
            }
            else {
                csvRows.push(val.join('\t'));
            }
        }
        else { // 1 dimensional array
            if (isNumber(val)) {
                csvRows.push(val.toLocaleString(undefined));
            }
            else {
                csvRows.push(val);
            }
        }
    }
    let csvString = csvRows.join('\r\n');
    let a = document.createElement('a');
    a.href = 'data:attachment/csv,' + encodeURIComponent(csvString);
    a.target = '_blank';
    a.download = 'myFile.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
function togglePanel(index) {
    let isOpens = [];
    for (let i = 0; i < panels.length; i++) {
        isOpens.push(panels[i].classList.contains('slide-in'));
    }
    for (let i = 0; i < panels.length; i++) {
        if (isOpens[i] && (i != index)) {
            panels[i].setAttribute('class', 'panel slide-out');
            icons[i].setAttribute('class', iconClass[i]);
        }
    }
    panels[index].setAttribute('class', isOpens[index] ? 'panel slide-out' : 'panel slide-in');
    icons[index].setAttribute('class', isOpens[index] ? iconClass[index] : 'icon ti ti-info-circle');
    // initial settings when each panel is opened
    switch (index) {
        case 0:
            if (!isOpens[0]) {
                getHeightmap(2);
            }
            break;
        case 1:
            if (!isOpens[1]) {
                let styleName = map.getStyle().metadata['mapbox:origin'];
                if (!(styleName)) {
                    styleName = 'satellite-v9';
                }
                document.getElementById(styleName).checked = true;
            }
            break;
        case 2:
            // none
            break;
    }
}
function sanatizeMap(map, xOffset, yOffset) {
    const citiesmapSize = 1081;
    let sanatizedMap = Create2DArray(citiesmapSize, 0);
    let lowestPositve = 100000;
    // pass 1: normalize the map, and determine the lowestPositve
    for (let y = yOffset; y < yOffset + citiesmapSize; y++) {
        for (let x = xOffset; x < xOffset + citiesmapSize; x++) {
            let h = map[y][x];
            if (h >= 0 && h < lowestPositve) {
                lowestPositve = h;
            }
            sanatizedMap[y - yOffset][x - xOffset] = h;
        }
    }
    // pass 2: fix negative heights artifact in mapbox maps
    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            let h = sanatizedMap[y][x];
            if (h < 0) {
                sanatizedMap[y][x] = lowestPositve;
            }
        }
    }
    return sanatizedMap;
}
function sanatizeWatermap(map, xOffset, yOffset) {
    const citiesmapSize = 1081;
    let watermap = Create2DArray(citiesmapSize, 0);
    for (let y = yOffset; y < yOffset + citiesmapSize; y++) {
        for (let x = xOffset; x < yOffset + citiesmapSize; x++) {
            let h = map[y][x];
            watermap[y - yOffset][x - xOffset] = h;
        }
    }
    return watermap;
}
function calcMinMaxHeight(map) {
    const maxY = map.length;
    const maxX = map[0].length;
    const heights = { min: 100000, max: -100000 };
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = map[y][x];
            if (h > heights.max)
                heights.max = h;
            if (h < heights.min)
                heights.min = h;
        }
    }
    heights.min = heights.min / 10;
    heights.max = heights.max / 10;
    return heights;
}
function updateInfopanel() {
    let rhs = 17.28 / mapSize * 100;
    document.getElementById('rHeightscale').innerHTML = rhs.toFixed(1);
    document.getElementById('lng').innerHTML = grid.lng.toFixed(5);
    document.getElementById('lat').innerHTML = grid.lat.toFixed(5);
    document.getElementById('minh').innerHTML = grid.minHeight;
    document.getElementById('maxh').innerHTML = grid.maxHeight;
}
function zoomIn() {
    map.zoomIn();
}
function zoomOut() {
    map.zoomOut();
}
function changeMapsize(el) {
    mapSize = el.value / 1;
    vmapSize = mapSize * 1.05;
    tileSize = mapSize / 9;
    setGrid(grid.lng, grid.lat, vmapSize);
    grid.minHeight = null;
    grid.maxHeight = null;
    updateInfopanel();
}
function setBaseLevel() {
    if (grid.minHeight === null) {
        new Promise((resolve) => {
            getHeightmap(2, resolve);
        }).then(() => {
            scope.baseLevel = grid.minHeight;
        });
    }
    else {
        scope.baseLevel = grid.minHeight;
    }
    saveSettings();
}
function setHeightScale() {
    if (grid.maxHeight === null) {
        new Promise((resolve) => {
            getHeightmap(2, resolve);
        }).then(() => {
            scope.heightScale = Math.min(250, Math.floor((1024 - scope.waterDepth) / (grid.maxHeight - scope.baseLevel) * 100));
        });
    }
    else {
        scope.heightScale = Math.min(250, Math.floor((1024 - scope.waterDepth) / (grid.maxHeight - scope.baseLevel) * 100));
    }
    saveSettings();
}
function incPb(el, value = 1) {
    let v = el.value + value;
    el.value = v;
}
function getHeightmap(mode = 0, callback) {
    pbElement.value = 0;
    pbElement.style.visibility = 'visible';
    saveSettings(false);
    // get the extent of the current map
    // in heightmap, each pixel is treated as vertex data, and 1081px represents 1080 faces
    // therefore, "1px = 16m" when the map size is 17.28km
    let extent = getExtent(grid.lng, grid.lat, mapSize / 1080 * 1081);
    // zoom is 13 in principle
    let zoom = 13;
    incPb(pbElement);
    // get a tile that covers the top left and bottom right (for the tile count calculation)
    let x = long2tile(extent.topleft[0], zoom);
    let y = lat2tile(extent.topleft[1], zoom);
    let x2 = long2tile(extent.bottomright[0], zoom);
    let y2 = lat2tile(extent.bottomright[1], zoom);
    // get the required tile count in Zoom 13
    let tileCnt = Math.max(x2 - x + 1, y2 - y + 1);
    // fixed in high latitudes: adjusted the tile count to 6 or less
    // because Terrain RGB tile distance depends on latitude
    // don't need too many tiles
    incPb(pbElement);
    if (tileCnt > 6) {
        let z = zoom;
        let tx, ty, tx2, ty2, tc;
        do {
            z--;
            tx = long2tile(extent.topleft[0], z);
            ty = lat2tile(extent.topleft[1], z);
            tx2 = long2tile(extent.bottomright[0], z);
            ty2 = lat2tile(extent.bottomright[1], z);
            tc = Math.max(tx2 - tx + 1, ty2 - ty + 1);
            incPb(pbElement);
        } while (tc > 6);
        // reflect the fixed result
        x = tx;
        y = ty;
        zoom = z;
        tileCnt = tc;
    }
    let tileLng = tile2long(x, zoom);
    let tileLat = tile2lat(y, zoom);
    let tileLng2 = tile2long(x + tileCnt, zoom);
    let tileLat2 = tile2lat(y + tileCnt, zoom);
    // get the length of one side of the tiles extent
    let distance = turf.distance(turf.point([tileLng, tileLat]), turf.point([tileLng2, tileLat2]), { units: 'kilometers' }) / Math.SQRT2;
    // find out the center position of the area we want inside the tiles
    let topDistance = turf.distance(turf.point([tileLng, tileLat]), turf.point([tileLng, extent.topleft[1]]), { units: 'kilometers' });
    let leftDistance = turf.distance(turf.point([tileLng, tileLat]), turf.point([extent.topleft[0], tileLat]), { units: 'kilometers' });
    // create the tiles empty array
    let tiles = Create2DArray(tileCnt);
    if (debug) {
        map.setLayoutProperty('debugLayer', 'visibility', 'visible');
        let line = turf.lineString([[tileLng, tileLat], [tileLng2, tileLat2]]);
        map.getSource('debug').setData(turf.bboxPolygon(turf.bbox(line)));
    }
    // download the tiles
    for (let i = 0; i < tileCnt; i++) {
        for (let j = 0; j < tileCnt; j++) {
            incPb(pbElement);
            let url = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/' + zoom + '/' + (x + j) + '/' + (y + i) + '@2x.pngraw?access_token=' + mapboxgl.accessToken;
            let woQUrl = 'https://api.mapbox.com/v4/mapbox.terrain-rgb/' + zoom + '/' + (x + j) + '/' + (y + i) + '@2x.pngraw';
            downloadPngToTile(url, woQUrl).then((png) => tiles[i][j] = png);
        }
    }
    // download pbf to vTiles
    var vTiles = Create2DArray(tileCnt);
    for (let i = 0; i < tileCnt; i++) {
        for (let j = 0; j < tileCnt; j++) {
            incPb(pbElement);
            let url = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/' + zoom + '/' + (x + j) + '/' + (y + i) + '.vector.pbf?access_token=' + mapboxgl.accessToken;
            let woQUrl = 'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/' + zoom + '/' + (x + j) + '/' + (y + i) + '.vector.pbf';
            downloadPbfToTile(url, woQUrl).then((data) => vTiles[i][j] = data);
        }
    }
    // wait for the download to complete
    let ticks = 0;
    let timer = window.setInterval(function () {
        ticks++;
        incPb(pbElement);
        if (isDownloadComplete(tiles, vTiles)) {
            console.log('download ok');
            clearInterval(timer);
            let citiesmap, png, canvas, url;
            // heightmap size corresponds to 1081px map size
            let heightmap = toHeightmap(tiles, distance);
            // heightmap edge to map edge distance
            let xOffset = Math.round(leftDistance / distance * heightmap.length);
            let yOffset = Math.round(topDistance / distance * heightmap.length);
            let sanatizedMap = sanatizeMap(heightmap, xOffset, yOffset);
            let heights = calcMinMaxHeight(sanatizedMap);
            grid.minHeight = heights.min;
            grid.maxHeight = heights.max;
            pbElement.value = 500;
            // callback after height calculation is completed
            if (typeof callback === 'function')
                callback();
            let watermap = sanatizeWatermap(toWatermap(vTiles, heightmap.length), xOffset, yOffset);
            switch (mode) {
                case 0:
                    // never draw a grid on a raw heightmap
                    let savedDrawGrid = document.getElementById('drawGrid').checked;
                    document.getElementById('drawGrid').checked = false;
                    citiesmap = toCitiesmap(sanatizedMap, watermap);
                    download('heightmap.raw', citiesmap);
                    document.getElementById('drawGrid').checked = savedDrawGrid;
                    break;
                case 1:
                    citiesmap = toCitiesmap(sanatizedMap, watermap);
                    png = UPNG.encodeLL([citiesmap], 1081, 1081, 1, 0, 16);
                    download('heightmap.png', png);
                    break;
                case 2:
                    updateInfopanel();
                    break;
                case 3:
                    citiesmap = toCitiesmap(sanatizedMap, watermap);
                    png = UPNG.encodeLL([citiesmap], 1081, 1081, 1, 0, 16);
                    downloadAsZip(png, 1);
                    break;
                case 255:
                    canvas = toTerrainRGB(heightmap);
                    url = canvas.toDataURL('image/png').replace('image/png', 'image/octet-stream');
                    download('tiles.png', null, url);
                    break;
            }
            console.log('complete in ', ticks * 10, ' ms');
            pbElement.style.visibility = 'hidden';
            pbElement.value = 0;
        }
        // timeout!
        if (ticks >= 4096) {
            clearInterval(timer);
            console.error('timeout!');
            pbElement.value = 0;
        }
    }, 10);
}
async function getOSMData() {
    let bounds = getExtent(grid.lng, grid.lat, mapSize);
    let minLng = Math.min(bounds.topleft[0], bounds.bottomright[0]);
    let minLat = Math.min(bounds.topleft[1], bounds.bottomright[1]);
    let maxLng = Math.max(bounds.topleft[0], bounds.bottomright[0]);
    let maxLat = Math.max(bounds.topleft[1], bounds.bottomright[1]);
    let url = 'https://overpass-api.de/api/map?bbox='
        + minLng + ','
        + minLat + ','
        + maxLng + ','
        + maxLat;
    try {
        const response = await fetch(url);
        if (response.ok) {
            let osm = await response.blob();
            download('map.osm', osm);
            console.log(bounds.topleft[0], bounds.topleft[1], bounds.bottomright[0], bounds.bottomright[1]);
        }
        else {
            throw new Error('download map error:', response.status);
        }
    }
    catch (e) {
        console.log(e.message);
    }
}
async function getMapImage() {
    let bounds = getExtent(grid.lng, grid.lat, mapSize);
    let minLng = Math.min(bounds.topleft[0], bounds.bottomright[0]);
    let minLat = Math.min(bounds.topleft[1], bounds.bottomright[1]);
    let maxLng = Math.max(bounds.topleft[0], bounds.bottomright[0]);
    let maxLat = Math.max(bounds.topleft[1], bounds.bottomright[1]);
    let styleName = 'satellite-v9';
    let url = 'https://api.mapbox.com/styles/v1/mapbox/'
        + styleName + '/static/['
        + minLng + ','
        + minLat + ','
        + maxLng + ','
        + maxLat + ']/1280x1280@2x?access_token='
        + mapboxgl.accessToken;
    try {
        const response = await fetch(url);
        if (response.ok) {
            let png = await response.blob();
            download('map.png', png);
            console.log(bounds.topleft[0], bounds.topleft[1], bounds.bottomright[0], bounds.bottomright[1]);
        }
        else {
            throw new Error('download map error:', response.status);
        }
    }
    catch (e) {
        console.log(e.message);
    }
}
function autoSettings(withMap = true) {
    scope.mapSize = 17.28;
    scope.waterDepth = defaultWaterdepth;
    mapSize = scope.mapSize / 1;
    vmapSize = mapSize * 1.05;
    tileSize = mapSize / 9;
    if (withMap) {
        new Promise((resolve) => {
            getHeightmap(2, resolve);
        }).then(() => {
            scope.baseLevel = grid.minHeight;
            scope.heightScale = Math.min(250, Math.floor((1024 - scope.waterDepth) / (grid.maxHeight - scope.baseLevel) * 100));
        });
    }
    setGrid(grid.lng, grid.lat, vmapSize);
    document.getElementById('drawStrm').checked = true;
    document.getElementById('drawMarker').checked = true;
    document.getElementById('drawGrid').checked = true;
    document.getElementById('plainsHeight').value = 140;
    document.getElementById('blurPasses').value = 10;
    document.getElementById('blurPostPasses').value = 2;
    document.getElementById('streamDepth').value = 7;
}
function isDownloadComplete(tiles, vTiles) {
    let tileNum = tiles.length;
    for (let i = 0; i < tileNum; i++) {
        for (let j = 0; j < tileNum; j++) {
            if (!(tiles[i][j]) || !(vTiles[i][j]))
                return false;
        }
    }
    return true;
}
function toWatermap(vTiles, length) {
    // extract feature geometry from VectorTileFeature in VectorTile.
    // draw the polygons of the water area from the feature geometries and return as a water area map.
    let tileCnt = vTiles.length;
    let canvas = document.getElementById('wMap-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = length;
    canvas.height = length;
    let coef = length / (tileCnt * 4096); // vTiles[][].layers.water.feature(0).extent = 4096 (default)
    // water
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, length, length);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    for (let ty = 0; ty < tileCnt; ty++) {
        for (let tx = 0; tx < tileCnt; tx++) {
            if (typeof vTiles[ty][tx] !== "boolean") {
                if (vTiles[ty][tx].layers.water) {
                    let geo = vTiles[ty][tx].layers.water.feature(0).loadGeometry();
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
    if (document.getElementById('drawStrm').checked) {
        // waterway
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let ty = 0; ty < tileCnt; ty++) {
            for (let tx = 0; tx < tileCnt; tx++) {
                if (typeof vTiles[ty][tx] !== "boolean") {
                    if (vTiles[ty][tx].layers.waterway) {
                        let geo = vTiles[ty][tx].layers.waterway.feature(0).loadGeometry();
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
    let watermap = Create2DArray(length, 1);
    let img = ctx.getImageData(0, 0, length, length);
    for (let i = 0; i < length; i++) {
        for (let j = 0; j < length; j++) {
            let index = i * length * 4 + j * 4;
            watermap[i][j] = img.data[index] / 255; // 0 => 255 : 0 => 1    0 = water, 1 = land
        }
    }
    return watermap;
}
// map filtering, for example smoothing the pixels in the plains, but leaving mountains and sea untouched
// or enhance mountain edges
// pas a kernel for filtering
// see: https://en.wikipedia.org/wiki/Kernel_(image_processing) 
function filterMap(map, fromLevel, toLevel, kernel) {
    const maxY = map.length;
    const maxX = map[0].length;
    // kernel size must be uneven!
    const kernelDist = parseInt((kernel.length - 1) / 2);
    const filteredMap = Create2DArray(maxY, 0);
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = map[y][x];
            if (h >= fromLevel && h < fromLevel + toLevel) {
                let sum = 0;
                let cnt = 0;
                for (let i = -kernelDist; i <= kernelDist; i++) {
                    for (let j = -kernelDist; j <= kernelDist; j++) {
                        if (y + i >= 0 && y + i < maxY && x + j >= 0 && x + j < maxX) {
                            cnt += kernel[i + kernelDist][j + kernelDist];
                            sum += map[y + i][x + j] * kernel[i + kernelDist][j + kernelDist];
                        }
                    }
                }
                if (cnt)
                    h = sum / cnt;
            }
            filteredMap[y][x] = h;
        }
    }
    return filteredMap;
}
function tiltMap(map, gravityCenter, waterDepth) {
    const maxY = map.length;
    const maxX = map[0].length;
    const tiltedMap = Create2DArray(maxY, 0);
    let gravityPoint = {};
    switch (gravityCenter) {
        case 1: // center
            gravityPoint.x = parseInt(maxX / 2);
            gravityPoint.y = parseInt(maxY / 2);
            break;
        case 2: // North center
            gravityPoint.x = parseInt(maxX / 2);
            gravityPoint.y = 0;
            break;
        case 3: // North - East
            gravityPoint.x = maxX;
            gravityPoint.y = 0;
            break;
        case 4: // East center
            gravityPoint.x = maxX;
            gravityPoint.y = parseInt(maxY / 2);
            break;
        case 5: // South - East
            gravityPoint.x = maxX;
            gravityPoint.y = maxY;
            break;
        case 6: // South center
            gravityPoint.x = parseInt(maxX / 2);
            gravityPoint.y = maxY;
            break;
        case 7: // South - West
            gravityPoint.x = 0;
            gravityPoint.y = maxY;
            break;
        case 8: // West center
            gravityPoint.x = 0;
            gravityPoint.y = parseInt(maxY / 2);
            break;
        case 9: // North - West
            gravityPoint.x = 0;
            gravityPoint.y = 0;
            break;
        case 10: // North side
            gravityPoint.y = 0;
            break;
        case 11: // East side
            gravityPoint.x = maxX;
            break;
        case 12: // South side
            gravityPoint.y = maxY;
            break;
        case 13: // West side
            gravityPoint.x = 0;
            break;
        default:
        // do nothing
    }
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = map[y][x];
            let correction = 0;
            //calculate the relative distance to the gravity center or side
            let relDistance = 0;
            switch (gravityCenter) {
                case 1:
                case 2:
                case 3:
                case 4:
                case 5:
                case 6:
                case 7:
                case 8:
                case 9:
                    //pythagoras for distance
                    relDistance = Math.sqrt(Math.pow(gravityPoint.x - x, 2) + Math.pow(gravityPoint.y - y, 2)) / maxY;
                    break;
                case 10:
                case 12:
                    // north and south side, only take y distance into account
                    relDistance = Math.abs(gravityPoint.y - y) / maxY;
                    break;
                case 11:
                case 13:
                    // east and west side, only take x distance into account
                    relDistance = Math.abs(gravityPoint.x - x) / maxX;
                    break;
                default:
                // do nothing
            }
            tiltedMap[y][x] = h + Math.round(waterDepth * relDistance * 100) / 100;
            ;
        }
    }
    if (gravityCenter == 0) {
        console.log('no map tilting');
    }
    else {
        console.log(`tilted map in direction ${gravityCenter} with ${waterDepth} m`);
    }
    return tiltedMap;
}
function interpolateArray(data, fitCount) {
    var linearInterpolate = function (before, after, atPoint) {
        return before + (after - before) * atPoint;
    };
    var newData = new Array();
    var springFactor = new Number((data.length - 1) / (fitCount - 1));
    newData[0] = data[0]; // for new allocation
    for (var i = 1; i < fitCount - 1; i++) {
        var tmp = i * springFactor;
        var before = new Number(Math.floor(tmp)).toFixed();
        var after = new Number(Math.ceil(tmp)).toFixed();
        var atPoint = tmp - before;
        newData[i] = linearInterpolate(data[before], data[after], atPoint);
    }
    newData[fitCount - 1] = data[data.length - 1]; // for new allocation
    return newData;
}
function levelMap(map, min, max, style) {
    let curve;
    switch (style) {
        case 1: // reserved for testing
            curve = [0.1, 1, 1.9];
            break;
        case 2: // coastline and plains
            curve = [0.15, 0.45, 0.75, 1.1, 1.4, 1.7, 1.9, 1.9];
            break;
        case 3: // agressive coastline and plains
            curve = [0.1, 0.2, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
            break;
        case 9:
            curve = [0.1, 0.2, 0.5, 1, 1.3, 1.7, 2.5];
            break;
        default:
            console.log('no map leveling');
            return map;
    }
    const interpolatedCurve = interpolateArray(curve, 256);
    const maxY = map.length;
    const maxX = map[0].length;
    const elevationStep = Math.round((max - min) / interpolatedCurve.length);
    // calculate the minimum level for each index in the curve
    let levels = [min]; // size of the levels array will be 1 larger then the curve
    let lastLevel = min;
    for (let i = 0; i < interpolatedCurve.length; i++) {
        levels.push(Math.round((lastLevel + elevationStep * interpolatedCurve[i]) * 10) / 10);
        lastLevel = levels[i + 1];
    }
    // debugging
    //let debug = [];
    //for(let i = 0; i < interpolatedCurve.length; i++) {
    //    debug.push([i, interpolatedCurve[i], levels[i]]);
    //}
    //exportToCSV(debug);
    const leveledMap = Create2DArray(maxY, 0);
    let highestHight = 0;
    for (let y = 0; y < maxY; y++) {
        for (let x = 0; x < maxX; x++) {
            let h = map[y][x];
            if (h - min > 0) {
                // calcualte the index based on the position in the heights array
                let idx = Math.min(interpolatedCurve.length - 1, Math.floor((h - min) / elevationStep));
                h = levels[idx] + ((h - levels[idx]) * interpolatedCurve[idx]);
                h = Math.round(h * 10) / 10;
            }
            leveledMap[y][x] = h;
            if (h > highestHight)
                highestHight = h;
        }
    }
    console.log(`min ${min} max ${max} highest high ${highestHight}`);
    // after releveling the map, it is possible that the highest point has become higher
    // rescale back to original min max
    let rescale = 10;
    if (highestHight > max) {
        rescale = Math.floor((max - min) / highestHight * 100) / 10; // little speed gain, by taking calc out the loop
        for (let y = 0; y < maxY; y++) {
            for (let x = 0; x < maxX; x++) {
                let h = leveledMap[y][x];
                if (h - min > 0) {
                    leveledMap[y][x] = Math.round(h * rescale) / 10;
                }
            }
        }
    }
    console.log(`leveled map with style ${style}, rescale ${rescale / 10}`);
    return leveledMap;
}
function toHeightmap(tiles, distance) {
    let tileNum = tiles.length;
    let srcMap = Create2DArray(tileNum * 512, 0);
    // in heightmap, each pixel is treated as vertex data, and 1081px represents 1080 faces
    // therefore, "1px = 16m" when the map size is 17.28km
    let heightmap = Create2DArray(Math.ceil(1080 * (distance / mapSize)), 0);
    let smSize = srcMap.length;
    let hmSize = heightmap.length;
    let r = (hmSize - 1) / (smSize - 1);
    for (let i = 0; i < tileNum; i++) {
        for (let j = 0; j < tileNum; j++) {
            let tile = new Uint8Array(UPNG.toRGBA8(tiles[i][j])[0]);
            for (let y = 0; y < 512; y++) {
                for (let x = 0; x < 512; x++) {
                    let tileIndex = y * 512 * 4 + x * 4;
                    // resolution 0.1 meters
                    srcMap[i * 512 + y][j * 512 + x] = -100000 + ((tile[tileIndex] * 256 * 256 + tile[tileIndex + 1] * 256 + tile[tileIndex + 2]));
                }
            }
        }
    }
    // bilinear interpolation
    let hmIndex = Array(hmSize);
    for (let i = 0; i < hmSize; i++) {
        hmIndex[i] = i / r;
    }
    for (let i = 0; i < (hmSize - 1); i++) {
        for (let j = 0; j < (hmSize - 1); j++) {
            let y0 = Math.floor(hmIndex[i]);
            let x0 = Math.floor(hmIndex[j]);
            let y1 = y0 + 1;
            let x1 = x0 + 1;
            let dy = hmIndex[i] - y0;
            let dx = hmIndex[j] - x0;
            heightmap[i][j] = Math.round((1 - dx) * (1 - dy) * srcMap[y0][x0] + dx * (1 - dy) * srcMap[y0][x1] + (1 - dx) * dy * srcMap[y1][x0] + dx * dy * srcMap[y1][x1]);
        }
    }
    for (let i = 0; i < hmSize; i++) {
        heightmap[i][hmSize - 1] = srcMap[i][hmSize - 1];
    }
    for (let j = 0; j < hmSize; j++) {
        heightmap[hmSize - 1][j] = srcMap[hmSize - 1][j];
    }
    return heightmap;
}
function toTerrainRGB(heightmap) {
    let canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = heightmap.length;
    canvas.height = heightmap.length;
    let img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            let r = Math.floor((Math.floor((heightmap[y][x] + 100000) / 256)) / 256);
            let g = (Math.floor((heightmap[y][x] + 100000) / 256)) % 256;
            let b = (heightmap[y][x] + 100000) % 256;
            let index = y * canvas.width * 4 + x * 4;
            // create pixel
            img.data[index + 0] = r;
            img.data[index + 1] = g;
            img.data[index + 2] = b;
            img.data[index + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}
function toCitiesmap(heightmap, watermap) {
    const citiesmapSize = 1081;
    // cities has L/H byte order
    let citiesmap = new Uint8ClampedArray(2 * citiesmapSize * citiesmapSize);
    let workingmap = Create2DArray(citiesmapSize, 0);
    // correct the waterDepth for the scaling. 
    // in the final pass, it will be scaled back. Round to 1 decimal
    let waterDepth = Math.round(scope.waterDepth / parseFloat(scope.heightScale) * 100 * 10) / 10;
    // watermap: => normalized depth between 0 => deepest water, 1 => land
    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            // stay with ints as long as possible
            let height = (heightmap[y][x] - scope.baseLevel * 10);
            // raise the land by the amount of water depth
            // a height lower than baselevel is considered to be the below sea level and the height is set to 0
            // water depth is unaffected by height scale
            // the map is unscaled at this point, so high mountains above 1024 meter can be present
            let calcHeight = (height + Math.round(waterDepth * 10 * watermap[y][x])) / 10;
            workingmap[y][x] = Math.max(0, calcHeight);
        }
    }
    // level correction, for specific needs
    // to smooth plains and dramatize mountains or level a mountanus coastline
    workingmap = levelMap(workingmap, grid.minHeight + waterDepth, grid.maxHeight, scope.levelCorrection);
    // smooth the plains and wateredges in a number of passes
    let passes = parseInt(document.getElementById('blurPasses').value);
    let postPasses = parseInt(document.getElementById('blurPostPasses').value);
    let plainsHeight = parseInt(document.getElementById('plainsHeight').value);
    for (let l = 0; l < passes; l++) {
        workingmap = filterMap(workingmap, 0, plainsHeight + waterDepth, meanKernel);
    }
    // sharpen the mountains, for more dramatic effect
    for (let l = 0; l < postPasses; l++) {
        workingmap = filterMap(workingmap, plainsHeight + waterDepth, grid.maxHeight, sharpenKernel);
    }
    // if there where enough passes, all the small streams on the plains are faded.
    // so redraw them, with little extra depth
    let streamDepth = parseInt(document.getElementById('streamDepth').value);
    let highestWaterHeight = 0;
    if (document.getElementById('drawStrm').checked) {
        for (let y = 0; y < citiesmapSize; y++) {
            for (let x = 0; x < citiesmapSize; x++) {
                let height = workingmap[y][x];
                if (height > highestWaterHeight) {
                    highestWaterHeight = height;
                }
                // prevent drawing below the seabed
                if (height > streamDepth) {
                    workingmap[y][x] = height - (1 - watermap[y][x]) * streamDepth;
                }
            }
        }
    }
    // tilt the map in the direction of gravity, so water always flows to the lowest point
    let tiltHeight = parseInt(document.getElementById('tiltHeight').value);
    // correct the tiltHeight for the scale. In the final pass, it will be corrected back
    tiltHeight = Math.round(tiltHeight / parseFloat(scope.heightScale) * 100 * 10) / 10;
    workingmap = tiltMap(workingmap, scope.gravityCenter, tiltHeight);
    // finally, finish the drawn streams with a light smoothing
    // the streams are drawn over the entire map, so post process the entire map
    for (let l = 0; l < postPasses; l++) {
        workingmap = filterMap(workingmap, 0, highestWaterHeight, meanKernel);
    }
    // debug
    //exportToCSV(workingmap);
    // convert the normalized and smoothed map to a cities skylines map/
    // As this is the final step, take scale into account
    for (let y = 0; y < citiesmapSize; y++) {
        for (let x = 0; x < citiesmapSize; x++) {
            // get the value in 1/10meyers and scale and convert to cities skylines 16 bit int
            let h = Math.round(workingmap[y][x] / 100 * parseFloat(scope.heightScale) / 0.015625);
            if (h > 65535)
                h = 65535;
            // calculate index in image
            let index = y * citiesmapSize * 2 + x * 2;
            // cities used hi/low 16 bit
            citiesmap[index + 0] = h >> 8;
            citiesmap[index + 1] = h & 255;
        }
    }
    //exportToCSV(citiesmap);
    // draw a grid on the image
    if (document.getElementById('drawGrid').checked) {
        for (let y = 0; y < citiesmapSize; y++) {
            for (let x = 0; x < citiesmapSize; x++) {
                if (y % 120 == 0 || x % 120 == 0) {
                    // calculate index in image
                    let index = y * citiesmapSize * 2 + x * 2;
                    // create pixel
                    citiesmap[index + 0] = 127;
                    citiesmap[index + 1] = 255;
                }
            }
        }
    }
    // marker, upper left corner
    if (document.getElementById('drawMarker').checked) {
        citiesmap[0] = 255;
        citiesmap[1] = 255;
        citiesmap[2] = 0;
        citiesmap[3] = 0;
    }
    // log the correct bounding rect to the console
    let bounds = getExtent(grid.lng, grid.lat, mapSize);
    console.log(bounds.topleft[0], bounds.topleft[1], bounds.bottomright[0], bounds.bottomright[1]);
    return citiesmap;
}
function download(filename, data, url = false) {
    var a = window.document.createElement('a');
    if (url) {
        a.href = url;
    }
    else {
        a.href = window.URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    }
    a.download = filename;
    // Append anchor to body.
    document.body.appendChild(a);
    a.click();
    // Remove anchor from body
    document.body.removeChild(a);
}
async function downloadPngToTile(url, withoutQueryUrl = url) {
    const cachedRes = await caches.match(url, { ignoreSearch: true });
    if (cachedRes && cachedRes.ok) {
        console.log('terrain-rgb: load from cache');
        let pngData = await cachedRes.arrayBuffer();
        let png = UPNG.decode(pngData);
        return png;
    }
    else {
        console.log('terrain-rgb: load by fetch, cache downloaded file');
        try {
            const response = await fetch(url);
            if (response.ok) {
                let res = response.clone();
                let pngData = await response.arrayBuffer();
                let png = UPNG.decode(pngData);
                cache.put(withoutQueryUrl, res);
                return png;
            }
            else {
                throw new Error('download terrain-rgb error:', response.status);
            }
        }
        catch (e) {
            console.log(e.message);
        }
    }
}
async function downloadPbfToTile(url, withoutQueryUrl = url) {
    const cachedRes = await caches.match(url, { ignoreSearch: true });
    if (cachedRes && cachedRes.ok) {
        console.log('pbf: load from cache');
        let data = await cachedRes.arrayBuffer();
        let tile = new VectorTile(new Protobuf(new Uint8Array(data)));
        return tile;
    }
    else {
        console.log('pbf: load by fetch, cache downloaded file');
        try {
            const response = await fetch(url);
            if (response.ok) {
                let res = response.clone();
                let data = await response.arrayBuffer();
                let tile = new VectorTile(new Protobuf(new Uint8Array(data)));
                cache.put(withoutQueryUrl, res);
                return tile;
            }
            else {
                throw new Error('download Pbf error:', response.status);
            }
        }
        catch (e) {
            console.log(e.message);
            return true;
        }
    }
}
//Original by @Niharkanta1
function downloadAsZip(data, mode) {
    var filename = prompt("Please enter your map name", "HeightMap");
    if (filename == null) {
        return;
    }
    var zip = new JSZip();
    var info = getInfo(filename);
    zip.file("info.txt", info);
    let imageName = mode == 0 ? filename + ".raw" : (mode == 1 ? filename + ".png" : filename + "-tiles.png");
    zip.file(imageName, data, { binary: true });
    zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 1 } })
        .then(function (content) {
        download(filename + ".zip", content);
    });
}
function getInfo(fileName) {
    return 'Heightmap name: ' + fileName + '\n' +
        '\n' +
        '/* Generated by Cities: Skylines online heightmap generator (https://cs.heightmap.skydark.pl) (https://github.com/sysoppl/Cities-Skylines-heightmap-generator) */\n' +
        '\n' +
        'Longitude: ' + grid.lng.toFixed(5) + '\n' +
        'Latitude: ' + grid.lat.toFixed(5) + '\n' +
        'Min Height: ' + grid.minHeight + '\n' +
        'Max Height: ' + grid.maxHeight + '\n' +
        'Water contours: ' + grid.waterContours + '\n' +
        'Height contours: ' + grid.heightContours + '\n' +
        'Zoom: ' + grid.zoom + '\n';
}
// Function to get the API token from local storage, otherwise null
function getApiToken() {
    return localStorage.getItem('mapboxApiToken') || 'null';
}
// Function to save the API token to local storage
function saveApiToken() {
    const token = document.getElementById('mapboxApiToken').value;
    if (token) {
        localStorage.setItem('mapboxApiToken', token);
        alert('API token saved! Refresh the page to apply the changes.');
    }
    else {
        alert('Please enter a valid API token.');
    }
}
// Event listener to load the saved API token into the input field on page load
document.addEventListener('DOMContentLoaded', () => {
    const savedToken = localStorage.getItem('mapboxApiToken');
    if (savedToken) {
        document.getElementById('mapboxApiToken').value = savedToken;
    }
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBwLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vc3JjL2FwcC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxjQUFjO0FBRWQsWUFBWSxDQUFBO0FBRVosTUFBTSxpQkFBaUIsR0FBRyxFQUFFLENBQUM7QUFFN0IsaUVBQWlFO0FBQ2pFLE1BQU0sVUFBVSxHQUFHO0lBQ2YsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUNULENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDVCxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0NBQ1osQ0FBQztBQUVGLE1BQU0sYUFBYSxHQUFHO0lBQ2xCLENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLENBQUM7SUFDbEQsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sQ0FBQztJQUNsRCxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxFQUFFLENBQUMsT0FBTyxDQUFDO0lBQ2xELENBQUMsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLEVBQUUsQ0FBQyxPQUFPLENBQUM7SUFDbEQsQ0FBQyxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sRUFBRSxDQUFDLE9BQU8sQ0FBQztDQUNyRCxDQUFDO0FBRUYsSUFBSSxRQUFRLEdBQUcsTUFBTSxDQUFDO0FBQ3RCLElBQUksT0FBTyxHQUFHLEtBQUssQ0FBQztBQUNwQixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUM7QUFFcEIsSUFBSSxJQUFJLEdBQUcsWUFBWSxFQUFF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RUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLEdBQUcsT0FBTyxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUM7UUFDbEMsS0FBSyxJQUFJLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxHQUFHLE9BQU8sRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDO1lBQ2xDLElBQUksT0FBTyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQ3RDLElBQUksTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztvQkFDOUIsSUFBSSxHQUFHLEdBQUcsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDLFlBQVksRUFBRSxDQUFDO29CQUVoRSxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDO3dCQUNsQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLEVBQUUsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUMvSCxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUUsRUFBRSxDQUFDOzRCQUNyQyxHQUFHLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksR0FBRyxDQUFDLEVBQUUsR0FBRyxNQUFNLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQyxDQUFDO3dCQUNuSSxDQUFDO29CQUNMLENBQUM7Z0JBQ0wsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO0lBQ0wsQ0FBQztJQUNELEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztJQUNoQixHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7SUFFWCxJQUFJLFFBQVEsQ0FBQyxjQUFjLENBQUMsVUFBVSxDQUFDLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDOUMsV0FBVztRQUNYLEdBQUcsQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFDO1FBQzVCLEdBQUcsQ0FBQyxTQUFTLEdBQUcsQ0FBQyxDQUFDO1FBQ2xCLEdBQUcsQ0FBQyxTQUFTLEVBQUUsQ0FBQztRQUVoQixLQUFLLElBQUksRUFBRSxHQUFHLENBQUMsRUFBRSxFQUFFLEdBQUcsT0FBTyxFQUFFLEVBQUUsRUFBRSxFQUFFLENBQUM7WUFDbEMsS0FBSyxJQUFJLEVBQUUsR0FBRyxDQUFDLEVBQUUsRUFBRSxHQUFHLE9BQU8sRUFBRSxFQUFFLEVBQUUsRUFBRSxDQUFDO2dCQUNsQyxJQUFJLE9BQU8sTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxLQUFLLFNBQVMsRUFBRSxDQUFDO29CQUN0QyxJQUFJLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxFQUFFLENBQUM7d0JBQ2pDLElBQUksR0FBRyxHQUFHLE1BQU0sQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQyxZQUFZLEVBQUUsQ0FBQzt3QkFFbkUsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQzs0QkFDbEMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsRUFBRSxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQzs0QkFDL0gsS0FBSyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztnQ0FDckMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxHQUFHLENBQUMsRUFBRSxHQUFHLE1BQU0sR0FBRyxPQUFPLENBQUMsQ0FBQyxFQUFFLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLEdBQUcsTUFBTSxHQUFHLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQzs0QkFDbkksQ0FBQzt3QkFDTCxDQUFDO29CQUNMLENBQUM7Z0JBQ0wsQ0FBQztZQUNMLENBQUM7UUFDTCxDQUFDO1FB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