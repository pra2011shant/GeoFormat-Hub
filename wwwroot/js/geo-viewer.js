/**
 * GeoFormat Hub - Frontend JavaScript Controller & Geodesic Calculation Engine
 * =========================================================================
 * Universal Auto-Detect Spatial Geometry Engine
 * Automatically recognizes and plots ANY Polygon, Line, or Point from ANY JSON format:
 *  - ESRI ArcGIS JSON (rings, paths, x/y, spatialReference)
 *  - Standard GeoJSON (FeatureCollection, Feature, Geometry objects)
 *  - WKT strings (POINT, POLYGON, MULTIPOLYGON, LINESTRING, MULTILINESTRING)
 *  - Lat/Long / X/Y columns in any case or nested object
 *  - Embedded JSON strings or direct objects under any key name
 *  - Web Mercator EPSG:3857 to WGS84 EPSG:4326 auto-reprojection
 * =========================================================================
 */

// Global State
let map = null;
let geoJsonLayer = null;
let currentColumns = [];
let allTableRows = [];
let filteredTableRows = [];
let currentPage = 1;
let pageSize = 25;
let currentDataset = null;
window.allMapLayers = [];
let currentHighlightedLayer = null;

// Earth radius in meters for WGS84 ellipsoid calculations
const EARTH_RADIUS_METERS = 6378137;

// =========================================================================
// 1. UTILITY FUNCTIONS
// =========================================================================

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function showClientAlert(message, type = 'warning') {
    const alert = document.getElementById('clientAlert');
    const alertMsg = document.getElementById('clientAlertMessage');
    const alertIcon = document.getElementById('clientAlertIcon');
    if (alert && alertMsg) {
        alert.className = `alert alert-${type} alert-dismissible fade show shadow-sm mb-4`;
        if (alertIcon) {
            alertIcon.className = type === 'success' 
                ? 'bi bi-check-circle-fill fs-4 me-2 text-success' 
                : (type === 'danger' ? 'bi bi-exclamation-triangle-fill fs-4 me-2 text-danger' : 'bi bi-exclamation-circle-fill fs-4 me-2');
        }
        alertMsg.textContent = message;
        alert.classList.remove('d-none');
    }
}

function hideClientAlert() {
    const alert = document.getElementById('clientAlert');
    if (alert) alert.classList.add('d-none');
}

function copyContent(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
        navigator.clipboard.writeText(el.textContent).then(() => {
            showClientAlert('Content copied to clipboard!', 'success');
        }).catch(() => {
            showClientAlert('Unable to copy to clipboard.', 'warning');
        });
    }
}

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// =========================================================================
// 2. UNIVERSAL SPATIAL PARSER & WGS84 GEODESIC CALCULATION ENGINE
// =========================================================================

/**
 * Normalizes coordinate pair [lon, lat], with auto-detection for Web Mercator EPSG:3857 and lat/lon inversion.
 */
function normalizeCoordPair(p) {
    if (!p || !Array.isArray(p) || p.length < 2) return null;
    let x = parseFloat(p[0]);
    let y = parseFloat(p[1]);
    if (isNaN(x) || isNaN(y)) return null;

    // Web Mercator EPSG:3857 projection check (e.g. coordinates in millions of meters)
    if (Math.abs(x) > 180 || Math.abs(y) > 90) {
        if (Math.abs(x) <= 20037508.34 && Math.abs(y) <= 20037508.34) {
            x = (x / 20037508.34) * 180;
            y = (y / 20037508.34) * 180;
            y = (180 / Math.PI) * (2 * Math.atan(Math.exp(y * Math.PI / 180)) - Math.PI / 2);
        }
    }

    // Latitude & Longitude swap check (e.g. if x is latitude 8-38 and y is longitude 68-98 for India)
    if (Math.abs(x) <= 40 && Math.abs(y) >= 60 && Math.abs(y) <= 100) {
        // Swap [lat, lon] to [lon, lat]
        const temp = x;
        x = y;
        y = temp;
    }

    return [x, y];
}

/**
 * Recursively normalizes array of coordinates.
 */
function normalizeCoordsArray(coords) {
    if (!Array.isArray(coords)) return null;
    if (coords.length >= 2 && typeof coords[0] !== 'object') {
        return normalizeCoordPair(coords);
    }
    return coords.map(c => normalizeCoordsArray(c)).filter(c => c !== null);
}

/**
 * Parses WKT (Well-Known Text) string into GeoJSON geometry object.
 */
function parseWktGeometry(wkt) {
    if (!wkt || typeof wkt !== 'string') return null;
    const str = wkt.trim();
    
    // POINT (84.08 24.81)
    const pointMatch = str.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
    if (pointMatch) {
        const pair = normalizeCoordPair([parseFloat(pointMatch[1]), parseFloat(pointMatch[2])]);
        if (pair) return { type: "Point", coordinates: pair };
    }

    // POLYGON (((86.55 25.25, 86.56 25.26, ...)))
    if (/^POLYGON/i.test(str)) {
        const coordsStr = str.replace(/^[^(]*\(\s*\(/, '').replace(/\)\s*\)[^)]*$/, '');
        const rings = [];
        const ringParts = coordsStr.split(/\)\s*,\s*\(/);
        for (let ringPart of ringParts) {
            const points = [];
            const pairs = ringPart.split(',');
            for (let pair of pairs) {
                const parts = pair.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const pt = normalizeCoordPair([parseFloat(parts[0]), parseFloat(parts[1])]);
                    if (pt) points.push(pt);
                }
            }
            if (points.length >= 3) rings.push(points);
        }
        if (rings.length > 0) return { type: "Polygon", coordinates: rings };
    }

    // LINESTRING (86.55 25.25, 86.56 25.26, ...)
    if (/^LINESTRING/i.test(str)) {
        const coordsStr = str.replace(/^[^(]*\(/, '').replace(/\)[^)]*$/, '');
        const points = [];
        const pairs = coordsStr.split(',');
        for (let pair of pairs) {
            const parts = pair.trim().split(/\s+/);
            if (parts.length >= 2) {
                const pt = normalizeCoordPair([parseFloat(parts[0]), parseFloat(parts[1])]);
                if (pt) points.push(pt);
            }
        }
        if (points.length >= 2) return { type: "LineString", coordinates: points };
    }

    return null;
}

/**
 * Native, dependency-free TopoJSON Topology to standard GeoJSON FeatureCollection converter.
 * Decodes quantized delta arcs, applies scale/translate transforms, and stitches polygon/line rings.
 */
function topojsonToGeojson(topology) {
    if (!topology || topology.type !== 'Topology' || !topology.objects) return null;

    const scale = topology.transform?.scale || [1, 1];
    const translate = topology.transform?.translate || [0, 0];
    const hasTransform = !!topology.transform;

    const decodedArcs = (topology.arcs || []).map(arc => {
        let x = 0, y = 0;
        return arc.map(pt => {
            if (hasTransform) {
                x += pt[0];
                y += pt[1];
                return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
            } else {
                return [pt[0], pt[1]];
            }
        });
    });

    function getArc(index) {
        if (index >= 0) {
            return decodedArcs[index] || [];
        } else {
            const arc = decodedArcs[~index] || [];
            return arc.slice().reverse();
        }
    }

    function stitchArcs(arcIndices) {
        const ring = [];
        for (let i = 0; i < arcIndices.length; i++) {
            const arc = getArc(arcIndices[i]);
            for (let j = (i === 0 ? 0 : 1); j < arc.length; j++) {
                ring.push(arc[j]);
            }
        }
        if (ring.length > 0) {
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
                ring.push([first[0], first[1]]);
            }
        }
        return ring;
    }

    function decodeGeometry(geom) {
        if (!geom) return null;
        if (geom.type === 'Polygon') {
            const coordinates = (geom.arcs || []).map(ringArcs => stitchArcs(ringArcs));
            return { type: 'Polygon', coordinates: coordinates };
        } else if (geom.type === 'MultiPolygon') {
            const coordinates = (geom.arcs || []).map(polyArcs => 
                polyArcs.map(ringArcs => stitchArcs(ringArcs))
            );
            return { type: 'MultiPolygon', coordinates: coordinates };
        } else if (geom.type === 'LineString') {
            const coordinates = stitchArcs(geom.arcs || []);
            return { type: 'LineString', coordinates: coordinates };
        } else if (geom.type === 'MultiLineString') {
            const coordinates = (geom.arcs || []).map(lineArcs => stitchArcs(lineArcs));
            return { type: 'MultiLineString', coordinates: coordinates };
        } else if (geom.type === 'Point') {
            let coords = geom.coordinates;
            if (hasTransform && coords) {
                coords = [coords[0] * scale[0] + translate[0], coords[1] * scale[1] + translate[1]];
            }
            return { type: 'Point', coordinates: coords };
        } else if (geom.type === 'MultiPoint') {
            let coords = (geom.coordinates || []).map(c => {
                return hasTransform ? [c[0] * scale[0] + translate[0], c[1] * scale[1] + translate[1]] : c;
            });
            return { type: 'MultiPoint', coordinates: coords };
        }
        return null;
    }

    const features = [];
    for (let key in topology.objects) {
        const obj = topology.objects[key];
        if (obj.type === 'GeometryCollection' && Array.isArray(obj.geometries)) {
            obj.geometries.forEach((g, idx) => {
                const geom = decodeGeometry(g);
                if (geom) {
                    features.push({
                        type: 'Feature',
                        id: g.id || `${key}_${idx + 1}`,
                        properties: Object.assign({}, g.properties || {}, { Layer_Name: key }),
                        geometry: geom
                    });
                }
            });
        } else {
            const geom = decodeGeometry(obj);
            if (geom) {
                features.push({
                    type: 'Feature',
                    id: obj.id || key,
                    properties: Object.assign({}, obj.properties || {}, { Layer_Name: key }),
                    geometry: geom
                });
            }
        }
    }

    return {
        type: 'FeatureCollection',
        features: features
    };
}

/**
 * Universal extractor for row geometry supporting ANY field format, nested JSON, ArcGIS, WKT, Lat/Long.
 */
function extractRowGeometry(row) {
    if (!row || typeof row !== 'object') return null;
    let geomType = row.Geometry_Type || row.GeometryType || null;

    // 1. Check all keys in the row object
    for (let key in row) {
        const lowerKey = key.toLowerCase();
        let val = row[key];
        if (val === null || val === undefined || val === '') continue;

        // If string starts with '{' or '[', attempt to parse as JSON
        if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try { val = JSON.parse(trimmed); } catch (e) { }
            }
        }

        // A. WKT string
        if (typeof val === 'string' && (val.startsWith('POINT') || val.startsWith('POLYGON') || val.startsWith('LINESTRING') || val.startsWith('MULTIPOLYGON'))) {
            const wktObj = parseWktGeometry(val);
            if (wktObj) return wktObj;
        }

        // B. Object with GeoJSON coordinates
        if (val && typeof val === 'object') {
            if (val.type && val.coordinates) {
                const norm = normalizeCoordsArray(val.coordinates);
                if (norm) return { type: val.type, coordinates: norm };
            }

            // C. ESRI ArcGIS rings (Polygon)
            if (val.rings && Array.isArray(val.rings)) {
                const norm = normalizeCoordsArray(val.rings);
                if (norm && norm.length > 0) return { type: "Polygon", coordinates: norm };
            }

            // D. ESRI ArcGIS paths (LineString / MultiLineString)
            if (val.paths && Array.isArray(val.paths)) {
                const norm = normalizeCoordsArray(val.paths);
                if (norm && norm.length > 0) {
                    if (norm.length === 1 && Array.isArray(norm[0])) {
                        return { type: "LineString", coordinates: norm[0] };
                    } else {
                        return { type: "MultiLineString", coordinates: norm };
                    }
                }
            }

            // E. ESRI ArcGIS Point { x, y }
            if (val.x !== undefined && val.y !== undefined) {
                const pair = normalizeCoordPair([val.x, val.y]);
                if (pair) return { type: "Point", coordinates: pair };
            }

            // F. Location object { lat, lon } / { latitude, longitude }
            if ((val.lat !== undefined || val.latitude !== undefined) && (val.lon !== undefined || val.lng !== undefined || val.longitude !== undefined)) {
                const lat = val.lat !== undefined ? val.lat : (val.latitude !== undefined ? val.latitude : val.y);
                const lon = val.lon !== undefined ? val.lon : (val.lng !== undefined ? val.lng : (val.longitude !== undefined ? val.longitude : val.x));
                const pair = normalizeCoordPair([lon, lat]);
                if (pair) return { type: "Point", coordinates: pair };
            }
        }

        // G. Direct rings or paths property
        if (lowerKey === 'rings' && Array.isArray(val)) {
            const norm = normalizeCoordsArray(val);
            if (norm && norm.length > 0) return { type: "Polygon", coordinates: norm };
        }

        if (lowerKey === 'paths' && Array.isArray(val)) {
            const norm = normalizeCoordsArray(val);
            if (norm && norm.length > 0) {
                if (norm.length === 1 && Array.isArray(norm[0])) return { type: "LineString", coordinates: norm[0] };
                return { type: "MultiLineString", coordinates: norm };
            }
        }

        // H. Direct coordinates array property
        if ((lowerKey === 'coordinates' || lowerKey === 'coords' || lowerKey === 'coord') && Array.isArray(val)) {
            const norm = normalizeCoordsArray(val);
            if (norm && norm.length > 0) {
                const guessedType = Array.isArray(norm[0]) ? (Array.isArray(norm[0][0]) ? "Polygon" : "LineString") : "Point";
                return { type: geomType || guessedType, coordinates: norm };
            }
        }
    }

    // 2. Scan for separated Latitude and Longitude columns
    let latVal = null, lonVal = null;
    for (let key in row) {
        const lowerKey = key.toLowerCase();
        const val = row[key];
        if (val === null || val === undefined || val === '') continue;

        if (['latitude', 'lat', 'lat_deg', 'point_y', 'y_coord', 'y', 'lat_dd', 'latitude84'].includes(lowerKey)) {
            const num = parseFloat(val);
            if (!isNaN(num)) latVal = num;
        } else if (['longitude', 'lon', 'lng', 'long', 'lon_deg', 'point_x', 'x_coord', 'x', 'lon_dd', 'longitude84'].includes(lowerKey)) {
            const num = parseFloat(val);
            if (!isNaN(num)) lonVal = num;
        }
    }

    if (latVal !== null && lonVal !== null) {
        const pair = normalizeCoordPair([lonVal, latVal]);
        if (pair) return { type: geomType || "Point", coordinates: pair };
    }

    return null;
}

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
}

function calculateRingArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let total = 0;
    const len = ring.length;

    for (let i = 0; i < len; i++) {
        const p1 = ring[i];
        const p2 = ring[(i + 1) % len];
        if (!p1 || !p2 || p1.length < 2 || p2.length < 2) continue;

        const lon1 = (parseFloat(p1[0]) || 0) * Math.PI / 180;
        const lat1 = (parseFloat(p1[1]) || 0) * Math.PI / 180;
        const lon2 = (parseFloat(p2[0]) || 0) * Math.PI / 180;
        const lat2 = (parseFloat(p2[1]) || 0) * Math.PI / 180;

        total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }

    const area = Math.abs(total * (EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2.0);
    return area;
}

function calculateRingPerimeter(ring) {
    if (!ring || ring.length < 2) return 0;
    let perimeter = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        if (p1 && p2 && p1.length >= 2 && p2.length >= 2) {
            perimeter += calculateHaversineDistance(parseFloat(p1[1]), parseFloat(p1[0]), parseFloat(p2[1]), parseFloat(p2[0]));
        }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
        perimeter += calculateHaversineDistance(parseFloat(last[1]), parseFloat(last[0]), parseFloat(first[1]), parseFloat(first[0]));
    }
    return perimeter;
}

function calculateLineLength(points) {
    if (!points || points.length < 2) return 0;
    let length = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        if (p1 && p2 && p1.length >= 2 && p2.length >= 2) {
            length += calculateHaversineDistance(parseFloat(p1[1]), parseFloat(p1[0]), parseFloat(p2[1]), parseFloat(p2[0]));
        }
    }
    return length;
}

function calculateSpatialMetrics(geometry) {
    const result = {
        areaM2: 0,
        areaKm2: 0,
        areaHectares: 0,
        areaAcres: 0,
        perimeterM: 0,
        perimeterKm: 0,
        centroid: null,
        vertexCount: 0,
        bbox: null,
        geomType: geometry?.type || 'Unknown'
    };

    if (!geometry || !geometry.coordinates) return result;

    const coords = geometry.coordinates;
    const type = (geometry.type || '').toLowerCase();
    let allPoints = [];

    if (type === 'polygon') {
        if (Array.isArray(coords) && coords.length > 0) {
            const outerRing = coords[0];
            if (Array.isArray(outerRing)) {
                result.areaM2 = calculateRingArea(outerRing);
                result.perimeterM = calculateRingPerimeter(outerRing);
                allPoints = outerRing;
            }
        }
    } else if (type === 'multipolygon') {
        if (Array.isArray(coords)) {
            for (let poly of coords) {
                if (Array.isArray(poly) && poly.length > 0) {
                    const outerRing = poly[0];
                    if (Array.isArray(outerRing)) {
                        result.areaM2 += calculateRingArea(outerRing);
                        result.perimeterM += calculateRingPerimeter(outerRing);
                        allPoints = allPoints.concat(outerRing);
                    }
                }
            }
        }
    } else if (type === 'linestring') {
        if (Array.isArray(coords)) {
            result.perimeterM = calculateLineLength(coords);
            allPoints = coords;
        }
    } else if (type === 'multilinestring') {
        if (Array.isArray(coords)) {
            for (let line of coords) {
                if (Array.isArray(line)) {
                    result.perimeterM += calculateLineLength(line);
                    allPoints = allPoints.concat(line);
                }
            }
        }
    } else if (type === 'point') {
        if (Array.isArray(coords) && coords.length >= 2) {
            allPoints = [coords];
        }
    }

    result.vertexCount = allPoints.length;
    result.areaKm2 = result.areaM2 / 1000000;
    result.areaHectares = result.areaM2 / 10000;
    result.areaAcres = result.areaM2 / 4046.8564224;
    result.perimeterKm = result.perimeterM / 1000;

    if (allPoints.length > 0) {
        let sumLat = 0, sumLon = 0;
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        let validPts = 0;

        for (let pt of allPoints) {
            if (Array.isArray(pt) && pt.length >= 2) {
                const lon = parseFloat(pt[0]);
                const lat = parseFloat(pt[1]);
                if (!isNaN(lat) && !isNaN(lon)) {
                    sumLat += lat;
                    sumLon += lon;
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                    validPts++;
                }
            }
        }

        if (validPts > 0) {
            result.centroid = [sumLat / validPts, sumLon / validPts];
            result.bbox = [minLat, minLon, maxLat, maxLon];
        }
    }

    return result;
}

// =========================================================================
// 3. UPLOAD FORM, DROPZONE & AJAX SUBMIT
// =========================================================================

function initUploadForm() {
    const fileInput = document.getElementById('geoFileInput');
    const dropZone = document.getElementById('dropZone');
    const selectedFileInfo = document.getElementById('selectedFileInfo');
    const displayFileName = document.getElementById('displayFileName');
    const displayFileSize = document.getElementById('displayFileSize');
    const displayFileExt = document.getElementById('displayFileExt');
    const btnUploadSubmit = document.getElementById('btnUploadSubmit');
    const btnClientPreview = document.getElementById('btnClientPreview');
    const btnClearFile = document.getElementById('btnClearFile');
    const clientPreviewContainer = document.getElementById('clientPreviewContainer');
    const clientJsonPreview = document.getElementById('clientJsonPreview');
    const clientStats = document.getElementById('clientStats');
    const uploadForm = document.getElementById('uploadForm');
    const uploadProgressContainer = document.getElementById('uploadProgressContainer');
    const uploadProgressBar = document.getElementById('uploadProgressBar');
    const uploadProgressStatus = document.getElementById('uploadProgressStatus');
    const uploadProgressStats = document.getElementById('uploadProgressStats');

    function validateAndProcessFile(file) {
        hideClientAlert();
        if (!file) {
            resetFileInput();
            return false;
        }

        const fileName = file.name;
        const ext = fileName.slice((fileName.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();

        if (ext !== 'json' && ext !== 'geojson') {
            showClientAlert(`Invalid file format ".${ext}". Only .json and .geojson files are supported.`, 'danger');
            resetFileInput();
            return false;
        }

        window.uploadedFileName = file.name;
        window.selectedFile = file;

        if (displayFileName) displayFileName.textContent = file.name;
        if (displayFileSize) displayFileSize.textContent = formatBytes(file.size);
        if (displayFileExt) displayFileExt.textContent = ext.toUpperCase();
        selectedFileInfo?.classList.remove('d-none');
        if (btnUploadSubmit) btnUploadSubmit.disabled = false;
        if (btnClientPreview) btnClientPreview.disabled = false;
        return true;
    }

    function resetFileInput() {
        if (fileInput) fileInput.value = '';
        window.selectedFile = null;
        selectedFileInfo?.classList.add('d-none');
        if (uploadProgressContainer) uploadProgressContainer.classList.add('d-none');
        if (btnUploadSubmit) btnUploadSubmit.disabled = true;
        if (btnClientPreview) btnClientPreview.disabled = true;
        if (clientPreviewContainer) clientPreviewContainer.classList.add('d-none');
    }

    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                validateAndProcessFile(e.target.files[0]);
            }
        });
    }

    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('dragover');
            }, false);
        });

        dropZone.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                if (fileInput) fileInput.files = files;
                validateAndProcessFile(files[0]);
            }
        });
    }

    if (btnClearFile) {
        btnClearFile.addEventListener('click', function () {
            resetFileInput();
            hideClientAlert();
        });
    }

    if (btnClientPreview) {
        btnClientPreview.addEventListener('click', function () {
            const file = fileInput?.files[0] || window.selectedFile;
            if (!file) return;

            const sliceSize = Math.min(32768, file.size);
            const slice = file.slice(0, sliceSize);
            const reader = new FileReader();

            reader.onload = function (e) {
                try {
                    const rawSlice = e.target.result;
                    let previewText = "";
                    let isFull = file.size <= 32768;

                    if (isFull) {
                        try {
                            const parsed = JSON.parse(rawSlice);
                            previewText = JSON.stringify(parsed, null, 2);
                            let type = parsed.type || (Array.isArray(parsed) ? 'JSON Array' : 'Standard JSON');
                            let featureCount = (parsed.features && Array.isArray(parsed.features)) 
                                ? parsed.features.length 
                                : (Array.isArray(parsed) ? parsed.length : '1');

                            if (clientStats) {
                                clientStats.innerHTML = `
                                    <span class="badge bg-primary">Type: ${type}</span>
                                    <span class="badge bg-success">Records: ${featureCount}</span>
                                    <span class="badge bg-secondary">Total Size: ${formatBytes(file.size)}</span>
                                `;
                            }
                        } catch {
                            previewText = rawSlice;
                        }
                    } else {
                        previewText = rawSlice.substring(0, 25000) + 
                            `\n\n/* =========================================================================\n` +
                            `   [CLIENT SLICE PREVIEW: Displaying first 32 KB of ${formatBytes(file.size)}]\n` +
                            `   Click "Upload & Calculate Data" to stream-analyze the full dataset.\n` +
                            `   ========================================================================= */`;

                        if (clientStats) {
                            clientStats.innerHTML = `
                                <span class="badge bg-primary">Format: ${file.name.endsWith('.geojson') ? 'GeoJSON' : 'JSON'}</span>
                                <span class="badge bg-info">Large File Mode</span>
                                <span class="badge bg-secondary">Total Size: ${formatBytes(file.size)}</span>
                            `;
                        }
                    }

                    if (clientJsonPreview) clientJsonPreview.textContent = previewText;
                    clientPreviewContainer?.classList.remove('d-none');
                    clientPreviewContainer?.scrollIntoView({ behavior: 'smooth' });
                } catch (err) {
                    showClientAlert("Error inspecting file: " + err.message, 'danger');
                }
            };
            reader.readAsText(slice);
        });
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const file = fileInput?.files[0] || window.selectedFile;
            if (!file) {
                showClientAlert("Please choose a file to upload.", 'warning');
                return;
            }

            const formData = new FormData();
            formData.append('file', file);

            const tokenInput = uploadForm.querySelector('input[name="__RequestVerificationToken"]');
            if (tokenInput) {
                formData.append('__RequestVerificationToken', tokenInput.value);
            }

            btnUploadSubmit.disabled = true;
            btnUploadSubmit.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status"></span> Streaming Upload...';
            if (uploadProgressContainer) {
                uploadProgressContainer.classList.remove('d-none');
                if (uploadProgressBar) {
                    uploadProgressBar.style.width = '0%';
                    uploadProgressBar.setAttribute('aria-valuenow', '0');
                }
            }

            const startTime = Date.now();
            const xhr = new XMLHttpRequest();
            xhr.open('POST', '/Home/ProcessUpload', true);

            xhr.upload.onprogress = function (event) {
                if (event.lengthComputable && uploadProgressBar) {
                    const percent = Math.min(99, Math.round((event.loaded / event.total) * 100));
                    uploadProgressBar.style.width = percent + '%';
                    uploadProgressBar.setAttribute('aria-valuenow', percent);

                    const elapsedSeconds = (Date.now() - startTime) / 1000;
                    const speedBytes = elapsedSeconds > 0 ? (event.loaded / elapsedSeconds) : 0;
                    const speedText = formatBytes(speedBytes) + '/s';

                    if (percent < 99) {
                        if (uploadProgressStatus) uploadProgressStatus.innerHTML = `<i class="bi bi-cloud-arrow-up-fill me-1"></i> Uploading: ${percent}%`;
                        if (uploadProgressStats) uploadProgressStats.textContent = `${formatBytes(event.loaded)} of ${formatBytes(event.total)} (${speedText})`;
                    } else {
                        if (uploadProgressStatus) uploadProgressStatus.innerHTML = `<span class="spinner-border spinner-border-sm me-1"></span> Processing file on server...`;
                        if (uploadProgressStats) uploadProgressStats.textContent = `${formatBytes(event.total)} uploaded. Parsing stream...`;
                    }
                }
            };

            xhr.onload = function () {
                btnUploadSubmit.disabled = false;
                btnUploadSubmit.innerHTML = '<i class="bi bi-upload me-1"></i> Upload & Calculate Data';

                if (uploadProgressBar) {
                    uploadProgressBar.style.width = '100%';
                    uploadProgressBar.setAttribute('aria-valuenow', '100');
                }

                if (xhr.status >= 200 && xhr.status < 300) {
                    try {
                        const data = JSON.parse(xhr.responseText);
                        if (data.success) {
                            showClientAlert(data.message, 'success');
                            displayResults(data);
                            setTimeout(() => {
                                uploadProgressContainer?.classList.add('d-none');
                            }, 1500);
                        } else {
                            showClientAlert(data.message || 'Error processing file', 'danger');
                            uploadProgressContainer?.classList.add('d-none');
                        }
                    } catch (parseErr) {
                        showClientAlert("Failed to parse server response: " + parseErr.message, 'danger');
                        uploadProgressContainer?.classList.add('d-none');
                    }
                } else {
                    showClientAlert(`Upload failed. Server returned HTTP ${xhr.status} (${xhr.statusText})`, 'danger');
                    uploadProgressContainer?.classList.add('d-none');
                }
            };

            xhr.onerror = function () {
                btnUploadSubmit.disabled = false;
                btnUploadSubmit.innerHTML = '<i class="bi bi-upload me-1"></i> Upload & Calculate Data';
                uploadProgressContainer?.classList.add('d-none');
                showClientAlert("Network connection error occurred during upload.", 'danger');
            };

            xhr.send(formData);
        });
    }
}

// =========================================================================
// 4. EXPORT SUITE & AJAX DOWNLOAD
// =========================================================================

function initExportForm() {
    const downloadBtn = document.getElementById('downloadBtn');
    const exportIcon = document.getElementById('exportIcon');
    const exportBtnText = document.getElementById('exportBtnText');

    if (!downloadBtn) return;

    downloadBtn.addEventListener('click', async function (e) {
        if (e) e.preventDefault();

        const exportFormatEl = document.getElementById('exportFormat');
        const format = exportFormatEl ? exportFormatEl.value : 'excel';
        const rawJson = window.uploadedRawJson;
        const fileName = window.uploadedFileName || document.getElementById('exportFileName')?.value || 'GeoData';
        const datasetId = window.uploadedDatasetId || document.getElementById('exportDatasetId')?.value;
        const tableName = document.getElementById('tableNameInput')?.value || 'GeoData';

        if (!rawJson && !datasetId) {
            alert("Please upload a file first!");
            return;
        }

        downloadBtn.disabled = true;
        if (exportIcon) exportIcon.className = "spinner-border spinner-border-sm me-1";
        if (exportBtnText) exportBtnText.textContent = "Exporting...";

        try {
            let response = await fetch('/Home/Export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    format: format, 
                    rawJson: rawJson, 
                    fileName: fileName,
                    datasetId: datasetId,
                    tableName: tableName
                })
            });

            if (response.ok) {
                let blob = await response.blob();
                let url = window.URL.createObjectURL(blob);
                let a = document.createElement('a');
                a.href = url;
                let ext = (format === 'excel' || format === 'xlsx') ? 'xlsx' : format;
                let baseName = fileName ? fileName.replace(/\.[^/.]+$/, "") : "GeoData_Export";
                a.download = `${baseName}.${ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
                showClientAlert(`Export complete! Downloaded ${baseName}.${ext} successfully.`, 'success');
            } else {
                let errText = await response.text();
                alert("Download failed: " + (errText || "File might be too large or invalid."));
            }
        } catch (err) {
            alert("Download failed. " + (err.message || "Please check connection."));
        } finally {
            downloadBtn.disabled = false;
            if (exportIcon) exportIcon.className = "bi bi-download";
            if (exportBtnText) exportBtnText.textContent = "Export Dataset";
        }
    });
}

// =========================================================================
// 5. RESULTS & EXECUTIVE ANALYTICS DASHBOARD
// =========================================================================

function displayResults(data) {
    currentDataset = data;

    window.uploadedFileName = data.fileName || window.uploadedFileName || 'GeoData';
    if (data.datasetId) window.uploadedDatasetId = data.datasetId;
    if (data.rawJson) window.uploadedRawJson = data.rawJson;

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.classList.remove('d-none');

    const exportDatasetId = document.getElementById('exportDatasetId');
    if (exportDatasetId) exportDatasetId.value = data.datasetId || '';
    const exportFileName = document.getElementById('exportFileName');
    if (exportFileName) exportFileName.value = data.fileName || 'GeoData';

    const serverRawJson = document.getElementById('serverRawJson');
    if (serverRawJson) {
        serverRawJson.textContent = data.jsonPreview || data.rawJson || '';
    }

    let rawObj = null;

    const sourceRawJson = data.rawJson || window.uploadedRawJson;
    if (sourceRawJson) {
        try {
            const parsed = typeof sourceRawJson === 'string' ? JSON.parse(sourceRawJson) : sourceRawJson;
            if (parsed) {
                if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature') {
                    rawObj = parsed;
                } else if (parsed.type === 'Topology') {
                    rawObj = topojsonToGeojson(parsed);
                }
            }
        } catch (e) {
            console.warn("Could not parse rawJson as GeoJSON/TopoJSON:", e);
        }
    }

    const calculatedFeatures = [];
    const rows = data.rows || [];

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const geomObj = extractRowGeometry(row);

        let spatialMetrics = { areaKm2: 0, areaHectares: 0, areaAcres: 0, perimeterKm: 0, centroid: null, vertexCount: 0 };
        if (geomObj && geomObj.coordinates) {
            spatialMetrics = calculateSpatialMetrics(geomObj);

            row["Calculated_Area_Km2"] = spatialMetrics.areaKm2 > 0 ? spatialMetrics.areaKm2.toFixed(4) : "-";
            row["Perimeter_Km"] = spatialMetrics.perimeterKm > 0 ? spatialMetrics.perimeterKm.toFixed(3) : "-";
            row["Centroid"] = spatialMetrics.centroid ? `${spatialMetrics.centroid[0].toFixed(4)}, ${spatialMetrics.centroid[1].toFixed(4)}` : "-";

            const props = Object.assign({}, row);
            delete props.GeometryJSON;
            delete props.geometry;

            calculatedFeatures.push({
                type: "Feature",
                geometry: geomObj,
                properties: props,
                metrics: spatialMetrics,
                rowIndex: i
            });
        }
    }

    if (!rawObj && calculatedFeatures.length > 0) {
        rawObj = {
            type: "FeatureCollection",
            features: calculatedFeatures
        };
    }

    // 5. Aggregate Dataset-Level Spatial Analytics
    updateDatasetAnalyticsAndKPIs(data, calculatedFeatures);

    // 6. Render Leaflet GIS Studio Map
    renderMap(rawObj, calculatedFeatures);

    // 7. Inject Calculated Columns to Columns List if not already present
    const columns = data.columns ? [...data.columns] : [];
    if (calculatedFeatures.length > 0) {
        if (!columns.includes("Calculated_Area_Km2")) columns.push("Calculated_Area_Km2");
        if (!columns.includes("Perimeter_Km")) columns.push("Perimeter_Km");
        if (!columns.includes("Centroid")) columns.push("Centroid");
    }

    // 8. Render Dynamic Tabular Grid
    renderDynamicTable(columns, rows);

    // 9. If dataset is non-spatial, auto-switch to Tabular Grid tab
    if (calculatedFeatures.length === 0 && rows.length > 0) {
        const tableTabBtn = document.getElementById('table-tab');
        if (tableTabBtn) {
            setTimeout(() => {
                tableTabBtn.click();
            }, 100);
        }
    }

    // 10. Smooth scroll into view
    resultsSection?.scrollIntoView({ behavior: 'smooth' });
}

function updateDatasetAnalyticsAndKPIs(data, features) {
    let totalAreaKm2 = 0;
    let totalPerimeterKm = 0;
    let polygonCount = 0;
    let lineCount = 0;
    let pointCount = 0;
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    let sumCentroidLat = 0, sumCentroidLon = 0, validCentroidCount = 0;

    const polygonsList = [];

    for (let feat of features) {
        const m = feat.metrics;
        const gType = (feat.geometry?.type || '').toLowerCase();
        if (gType.includes('polygon')) polygonCount++;
        else if (gType.includes('line')) lineCount++;
        else if (gType.includes('point')) pointCount++;

        if (m) {
            if (m.areaKm2 > 0) {
                totalAreaKm2 += m.areaKm2;
                polygonsList.push({
                    feature: feat,
                    name: feat.properties.NAME || feat.properties.V_NAME || feat.properties.HAB_NAME || feat.properties.GPNAME_1 || feat.properties.Name || feat.properties.name || `Feature #${feat.rowIndex + 1}`,
                    areaKm2: m.areaKm2,
                    areaHa: m.areaHectares,
                    perimeterKm: m.perimeterKm,
                    centroid: m.centroid,
                    rowIndex: feat.rowIndex
                });
            }
            if (m.perimeterKm > 0) {
                totalPerimeterKm += m.perimeterKm;
            }
            if (m.bbox) {
                minLat = Math.min(minLat, m.bbox[0]);
                minLon = Math.min(minLon, m.bbox[1]);
                maxLat = Math.max(maxLat, m.bbox[2]);
                maxLon = Math.max(maxLon, m.bbox[3]);
            }
            if (m.centroid) {
                sumCentroidLat += m.centroid[0];
                sumCentroidLon += m.centroid[1];
                validCentroidCount++;
            }
        }
    }

    const totalRecords = data.totalRecords ?? data.rows?.length ?? features.length;
    document.getElementById('kpiTotalRecords').textContent = totalRecords.toLocaleString();
    document.getElementById('kpiFileName').textContent = data.fileName || 'Data';
    document.getElementById('kpiDetectedType').textContent = data.detectedType || (features.length > 0 ? 'Geospatial JSON' : 'JSON');

    document.getElementById('kpiTotalArea').innerHTML = `${totalAreaKm2.toFixed(2)} <span class="fs-6 text-muted fw-normal">km²</span>`;
    document.getElementById('kpiAreaHa').textContent = `${(totalAreaKm2 * 100).toFixed(1)} ha`;
    document.getElementById('kpiAreaAcres').textContent = `${(totalAreaKm2 * 247.105).toFixed(1)} Acres`;

    document.getElementById('kpiTotalPerimeter').innerHTML = `${totalPerimeterKm.toFixed(2)} <span class="fs-6 text-muted fw-normal">km</span>`;
    document.getElementById('kpiPerimeterM').textContent = `${Math.round(totalPerimeterKm * 1000).toLocaleString()} meters`;
    
    const avgArea = polygonCount > 0 ? (totalAreaKm2 / polygonCount).toFixed(3) : "0.00";
    document.getElementById('kpiAvgArea').textContent = lineCount > 0 ? `${lineCount} Lines / Canals` : `Avg: ${avgArea} km²`;

    if (validCentroidCount > 0) {
        const centerLat = (sumCentroidLat / validCentroidCount).toFixed(4);
        const centerLon = (sumCentroidLon / validCentroidCount).toFixed(4);
        document.getElementById('kpiCentroid').textContent = `${centerLat}°, ${centerLon}°`;
        document.getElementById('bboxMinLat').textContent = minLat.toFixed(5) + '°';
        document.getElementById('bboxMaxLat').textContent = maxLat.toFixed(5) + '°';
        document.getElementById('bboxMinLng').textContent = minLon.toFixed(5) + '°';
        document.getElementById('bboxMaxLng').textContent = maxLon.toFixed(5) + '°';
    } else {
        document.getElementById('kpiCentroid').textContent = '-- , --';
    }

    let summaryText = "";
    if (polygonCount > 0) summaryText += `${polygonCount} Polygons `;
    if (lineCount > 0) summaryText += `${lineCount} Lines `;
    if (pointCount > 0) summaryText += `${pointCount} Points `;
    document.getElementById('kpiGeometrySummary').textContent = summaryText || data.geometrySummary || 'Spatial Features';

    polygonsList.sort((a, b) => b.areaKm2 - a.areaKm2);
    const topPolygonsBody = document.getElementById('topPolygonsBody');
    if (topPolygonsBody) {
        if (polygonsList.length === 0) {
            topPolygonsBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-3">${lineCount > 0 ? 'Line features plotted (lengths shown in grid & on map)' : 'No polygon features with area found.'}</td></tr>`;
        } else {
            topPolygonsBody.innerHTML = '';
            const top5 = polygonsList.slice(0, 10);
            top5.forEach((p, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="fw-bold text-muted">${idx + 1}</td>
                    <td>
                        <strong class="text-dark d-block">${p.name}</strong>
                        <span class="text-muted small">Record #${p.rowIndex + 1}</span>
                    </td>
                    <td class="fw-bold text-success mono-font">${p.areaKm2.toFixed(4)} km²</td>
                    <td class="mono-font">${p.areaHa.toFixed(2)} ha</td>
                    <td class="mono-font">${p.perimeterKm.toFixed(3)} km</td>
                    <td>
                        <button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 rounded-pill" onclick="focusFeatureOnMap(${p.rowIndex}, '${String(p.name).replace(/'/g, "\\'")}')">
                            <i class="bi bi-geo-alt-fill me-1"></i> Zoom
                        </button>
                    </td>
                `;
                topPolygonsBody.appendChild(tr);
            });
        }
    }

    const numericStatsBody = document.getElementById('numericStatsBody');
    if (numericStatsBody && data.rows && data.rows.length > 0) {
        const rows = data.rows;
        const columns = data.columns || Object.keys(rows[0] || {});
        const numericCols = [];

        for (let col of columns) {
            if (col === "ID" || col === "Id" || col === "Index" || col === "Feature_Id" || col.includes("Area") || col.includes("Perimeter") || col.includes("Centroid")) continue;
            let isNumeric = true;
            let sum = 0;
            let max = -Infinity;
            let count = 0;

            for (let r of rows) {
                const val = r[col];
                if (val !== null && val !== undefined && val !== '') {
                    const n = parseFloat(val);
                    if (!isNaN(n)) {
                        sum += n;
                        max = Math.max(max, n);
                        count++;
                    } else {
                        isNumeric = false;
                        break;
                    }
                }
            }

            if (isNumeric && count > 0) {
                numericCols.push({
                    col: col,
                    sum: sum,
                    avg: sum / count,
                    max: max
                });
            }
        }

        if (numericCols.length === 0) {
            numericStatsBody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-2">No additional numeric attribute fields found.</td></tr>`;
        } else {
            numericStatsBody.innerHTML = '';
            numericCols.slice(0, 8).forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="fw-semibold text-dark">${item.col}</td>
                    <td class="mono-font text-primary">${Math.round(item.sum).toLocaleString()}</td>
                    <td class="mono-font">${item.avg.toFixed(2)}</td>
                    <td class="mono-font text-danger">${Math.round(item.max).toLocaleString()}</td>
                `;
                numericStatsBody.appendChild(tr);
            });
        }
    }
}

// =========================================================================
// 6. LEAFLET.JS GIS MAP STUDIO
// =========================================================================

function renderMap(rawGeoJson, calculatedFeatures = []) {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl) return;

    window.allMapLayers = [];
    currentHighlightedLayer = null;

    if (!map) {
        map = L.map('mapContainer', {
            zoomControl: true,
            attributionControl: true,
            preferCanvas: true
        }).setView([20, 0], 2);

        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        const esriSatellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri',
            maxZoom: 19
        });

        const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        const cartoPositron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        const topoMap = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            maxZoom: 17,
            attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM'
        });

        L.control.layers({
            "OpenStreetMap": osm,
            "Esri Satellite Imagery": esriSatellite,
            "Dark Studio Canvas": cartoDark,
            "Light Positron": cartoPositron,
            "Topographic Terrain": topoMap
        }, null, { position: 'topright' }).addTo(map);

        const mapSearchInput = document.getElementById('mapSearchInput');
        if (mapSearchInput) {
            mapSearchInput.addEventListener('input', debounce(function () {
                searchFeaturesOnMap(this.value);
            }, 200));
        }
    }

    if (geoJsonLayer) {
        map.removeLayer(geoJsonLayer);
        geoJsonLayer = null;
    }

    const noGeomAlert = document.getElementById('noGeometryAlert');
    const floatingHud = document.getElementById('mapFloatingHud');

    if (rawGeoJson && (rawGeoJson.type || (rawGeoJson.features && Array.isArray(rawGeoJson.features))) && rawGeoJson.features && rawGeoJson.features.length > 0) {
        try {
            let plotGeoJson = rawGeoJson;
            if (rawGeoJson.features && rawGeoJson.features.length > 3000) {
                plotGeoJson = {
                    type: "FeatureCollection",
                    features: rawGeoJson.features.slice(0, 3000)
                };
            }

            function getFeatureCategoryMeta(feature) {
                const gType = (feature.geometry?.type || '').toLowerCase();
                const props = feature.properties || {};
                const propStr = JSON.stringify(props).toLowerCase();

                if (gType.includes('polygon')) {
                    return {
                        category: 'Polygon',
                        icon: 'bi-bounding-box-circles',
                        label: 'Boundary / Parcel',
                        color: '#2563eb',
                        fillColor: '#60a5fa',
                        fillOpacity: 0.45,
                        weight: 2.5
                    };
                } else if (gType.includes('line')) {
                    if (propStr.includes('canal') || propStr.includes('river') || propStr.includes('minor') || propStr.includes('water') || propStr.includes('drain') || propStr.includes('branch')) {
                        return {
                            category: 'Canal',
                            icon: 'bi-water',
                            label: 'Canal / Waterway',
                            color: '#06b6d4',
                            fillColor: '#06b6d4',
                            fillOpacity: 0,
                            weight: 4
                        };
                    } else {
                        return {
                            category: 'Road',
                            icon: 'bi-signpost-split-fill',
                            label: 'Road / Highway / Route',
                            color: '#f59e0b',
                            fillColor: '#f59e0b',
                            fillOpacity: 0,
                            weight: 4.5
                        };
                    }
                } else {
                    if (propStr.includes('well') || propStr.includes('tube') || propStr.includes('boring') || propStr.includes('pump') || propStr.includes('water_source')) {
                        return {
                            category: 'Well',
                            icon: 'bi-droplet-fill',
                            label: 'Tube-well / Water Asset',
                            color: '#0284c7',
                            fillColor: '#38bdf8',
                            fillOpacity: 0.9,
                            weight: 2,
                            radius: 8
                        };
                    } else if (propStr.includes('tower') || propStr.includes('station') || propStr.includes('plant')) {
                        return {
                            category: 'Station',
                            icon: 'bi-broadcast-pin',
                            label: 'Station / Asset',
                            color: '#7c3aed',
                            fillColor: '#a78bfa',
                            fillOpacity: 0.9,
                            weight: 2,
                            radius: 8
                        };
                    } else {
                        return {
                            category: 'Point',
                            icon: 'bi-geo-alt-fill',
                            label: 'Location Point',
                            color: '#ffffff',
                            fillColor: '#2563eb',
                            fillOpacity: 0.9,
                            weight: 2,
                            radius: 8
                        };
                    }
                }
            }

            geoJsonLayer = L.geoJSON(plotGeoJson, {
                renderer: L.canvas(),
                pointToLayer: function (feature, latlng) {
                    const meta = getFeatureCategoryMeta(feature);
                    return L.circleMarker(latlng, {
                        radius: meta.radius || 8,
                        fillColor: meta.fillColor,
                        color: meta.color,
                        weight: meta.weight || 2,
                        opacity: 1,
                        fillOpacity: meta.fillOpacity || 0.85
                    });
                },
                style: function (feature) {
                    const meta = getFeatureCategoryMeta(feature);
                    return {
                        color: meta.color,
                        weight: meta.weight,
                        opacity: 1,
                        fillColor: meta.fillColor,
                        fillOpacity: meta.fillOpacity
                    };
                },
                onEachFeature: function (feature, layer) {
                    layer.featureData = feature;
                    window.allMapLayers.push(layer);

                    const metrics = feature.metrics || calculateSpatialMetrics(feature.geometry);
                    const props = feature.properties || {};
                    const meta = getFeatureCategoryMeta(feature);
                    const titleName = props.NAME || props.district || props.V_NAME || props.HAB_NAME || props.GPNAME_1 || props.Name || props.name || props.Title || props.id || props.Id || `${meta.label} Details`;

                    let popupHtml = `
                        <div class="popup-pro-header">
                            <span class="fw-bold text-white d-flex align-items-center gap-1">
                                <i class="bi ${meta.icon} text-primary"></i> ${titleName}
                            </span>
                            <span class="badge bg-primary-subtle text-primary">${meta.label}</span>
                        </div>
                        <div class="popup-pro-body">
                            <div class="popup-calc-chips">
                                ${metrics.areaKm2 > 0 ? `
                                <span class="popup-chip"><i class="bi bi-bounding-box-circles me-1"></i>${metrics.areaKm2.toFixed(3)} km²</span>
                                <span class="popup-chip"><i class="bi bi-bezier2 me-1"></i>${metrics.perimeterKm.toFixed(2)} km</span>
                                <span class="popup-chip">${metrics.areaHectares.toFixed(1)} ha</span>` : 
                                (metrics.perimeterKm > 0 ? `<span class="popup-chip"><i class="bi bi-bezier2 me-1"></i>Length: ${metrics.perimeterKm.toFixed(3)} km</span><span class="popup-chip">${Math.round(metrics.perimeterM).toLocaleString()} m</span>` : 
                                (metrics.centroid ? `<span class="popup-chip"><i class="bi bi-geo-alt me-1"></i>${metrics.centroid[0].toFixed(4)}°, ${metrics.centroid[1].toFixed(4)}°</span>` : ''))}
                            </div>
                            <table class="popup-pro-table">`;

                    let count = 0;
                    for (let key in props) {
                        if (count < 10) {
                            popupHtml += `<tr><td class="prop-key">${key}</td><td class="prop-val">${props[key]}</td></tr>`;
                        }
                        count++;
                    }
                    if (count > 10) {
                        popupHtml += `<tr><td colspan="2" class="text-muted small text-center">... and ${count - 10} more attributes</td></tr>`;
                    }
                    popupHtml += `</table></div>`;

                    popupHtml += `
                        <div class="popup-pro-footer">
                            <button type="button" class="btn btn-sm btn-primary w-100 d-flex align-items-center justify-content-center gap-1" onclick="filterTableBySearch('${String(titleName).replace(/'/g, "\\'")}')">
                                <i class="bi bi-table"></i> View in Grid
                            </button>
                        </div>
                    `;
                    layer.bindPopup(popupHtml);

                    layer.on('mouseover', function () {
                        if (floatingHud) {
                            floatingHud.classList.remove('d-none');
                            document.getElementById('hudFeatureName').textContent = `${titleName} (${meta.label})`;
                            document.getElementById('hudAreaKm').textContent = metrics.areaKm2 > 0 ? metrics.areaKm2.toFixed(4) : "0.00";
                            document.getElementById('hudAreaHa').textContent = metrics.areaKm2 > 0 ? `${metrics.areaHectares.toFixed(2)} ha (${metrics.areaAcres.toFixed(1)} acres)` : (metrics.perimeterKm > 0 ? `${metrics.perimeterKm.toFixed(3)} km length` : "-");
                            document.getElementById('hudPerimeterKm').textContent = metrics.perimeterKm > 0 ? metrics.perimeterKm.toFixed(3) : "0.00";
                            document.getElementById('hudPerimeterM').textContent = metrics.perimeterM > 0 ? `${Math.round(metrics.perimeterM).toLocaleString()} meters` : "-";
                            document.getElementById('hudVertexCount').textContent = metrics.vertexCount.toLocaleString();
                            document.getElementById('hudGeomType').textContent = `${feature.geometry?.type || 'Geometry'} [${meta.category}]`;
                            document.getElementById('hudCentroid').textContent = metrics.centroid ? `${metrics.centroid[0].toFixed(4)}°, ${metrics.centroid[1].toFixed(4)}°` : "--";
                        }

                        if (layer.setStyle && layer !== currentHighlightedLayer) {
                            layer.setStyle({
                                weight: 4.5,
                                color: "#f59e0b",
                                fillColor: "#fbbf24",
                                fillOpacity: 0.75
                            });
                        }
                    });

                    layer.on('mouseout', function () {
                        if (geoJsonLayer && layer !== currentHighlightedLayer) {
                            geoJsonLayer.resetStyle(layer);
                        }
                    });

                    layer.on('click', function () {
                        if (currentHighlightedLayer && geoJsonLayer && currentHighlightedLayer.setStyle) {
                            geoJsonLayer.resetStyle(currentHighlightedLayer);
                        }
                        currentHighlightedLayer = layer;
                        if (layer.setStyle) {
                            layer.setStyle({
                                weight: 5,
                                color: "#ef4444",
                                fillColor: "#f87171",
                                fillOpacity: 0.85
                            });
                        }
                        if (layer.getBounds) {
                            map.fitBounds(layer.getBounds(), { maxZoom: 16, padding: [40, 40] });
                        } else if (layer.getLatLng) {
                            map.setView(layer.getLatLng(), Math.max(map.getZoom(), 14));
                        }
                    });
                }
            }).addTo(map);

            const bounds = geoJsonLayer.getBounds();
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [30, 30] });
                noGeomAlert?.classList.add('d-none');
            } else {
                noGeomAlert?.classList.remove('d-none');
            }
        } catch (err) {
            console.warn("Could not plot GeoJSON layer:", err);
            noGeomAlert?.classList.remove('d-none');
        }
    } else {
        noGeomAlert?.classList.remove('d-none');
    }

    document.getElementById('btnFitBounds')?.addEventListener('click', function () {
        if (geoJsonLayer && geoJsonLayer.getBounds().isValid()) {
            map.fitBounds(geoJsonLayer.getBounds(), { padding: [30, 30] });
        }
    });
}

function searchFeaturesOnMap(term) {
    if (!map || !window.allMapLayers) return;
    const query = (term || '').toLowerCase().trim();
    const countBadge = document.getElementById('mapSearchCount');

    if (!query) {
        if (countBadge) countBadge.classList.add('d-none');
        if (currentHighlightedLayer && geoJsonLayer) {
            geoJsonLayer.resetStyle(currentHighlightedLayer);
            currentHighlightedLayer = null;
        }
        return;
    }

    let matchCount = 0;
    let firstMatchedLayer = null;

    for (let layer of window.allMapLayers) {
        const props = layer.featureData?.properties || {};
        let isMatch = false;

        for (let key in props) {
            const val = props[key];
            if (val !== null && val !== undefined && String(val).toLowerCase().includes(query)) {
                isMatch = true;
                break;
            }
        }

        if (isMatch) {
            matchCount++;
            if (!firstMatchedLayer) firstMatchedLayer = layer;
        }
    }

    if (countBadge) {
        countBadge.textContent = `${matchCount} found`;
        countBadge.className = matchCount > 0 
            ? "badge bg-success-subtle text-success border border-success-subtle" 
            : "badge bg-warning-subtle text-warning border border-warning-subtle";
        countBadge.classList.remove('d-none');
    }

    if (firstMatchedLayer) {
        if (currentHighlightedLayer && geoJsonLayer && currentHighlightedLayer.setStyle) {
            geoJsonLayer.resetStyle(currentHighlightedLayer);
        }
        currentHighlightedLayer = firstMatchedLayer;
        if (firstMatchedLayer.setStyle) {
            firstMatchedLayer.setStyle({
                weight: 5,
                color: "#ef4444",
                fillColor: "#f87171",
                fillOpacity: 0.85
            });
        }
        if (firstMatchedLayer.getBounds) {
            map.fitBounds(firstMatchedLayer.getBounds(), { maxZoom: 16, padding: [40, 40] });
        } else if (firstMatchedLayer.getLatLng) {
            map.setView(firstMatchedLayer.getLatLng(), 15);
        }
        firstMatchedLayer.openPopup();
    }
}

function filterTableBySearch(searchTerm) {
    const tableTab = document.getElementById('table-tab');
    const tableSearchInput = document.getElementById('tableSearchInput');
    if (tableTab) tableTab.click();
    if (tableSearchInput) {
        tableSearchInput.value = searchTerm;
        tableSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
        tableSearchInput.focus();
    }
}

function focusFeatureOnMap(rowIndex, queryTerm) {
    const mapTab = document.getElementById('map-tab');
    if (mapTab) mapTab.click();

    setTimeout(() => {
        if (map) map.invalidateSize();
        if (queryTerm) {
            const mapSearchInput = document.getElementById('mapSearchInput');
            if (mapSearchInput) {
                mapSearchInput.value = queryTerm;
            }
            searchFeaturesOnMap(queryTerm);
        }
    }, 200);
}

// =========================================================================
// 7. WINDOWED / PAGINATED TABULAR GRID
// =========================================================================

let renderedRowCount = 50;
const INITIAL_CHUNK_SIZE = 50;

function renderDynamicTable(columns, rows) {
    const thead = document.getElementById('tableHead');
    const tableBadgeCount = document.getElementById('tableBadgeCount');
    const btnLoadMore = document.getElementById('btnLoadMore');

    currentColumns = columns || [];
    allTableRows = rows || [];
    filteredTableRows = allTableRows;
    currentPage = 1;
    renderedRowCount = INITIAL_CHUNK_SIZE;

    if (tableBadgeCount) tableBadgeCount.textContent = allTableRows.length.toLocaleString();
    if (!thead) return;

    thead.innerHTML = '';
    const headerTr = document.createElement('tr');
    
    const thAction = document.createElement('th');
    thAction.style.width = '70px';
    thAction.textContent = 'Locate';
    headerTr.appendChild(thAction);

    currentColumns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);

    const searchInput = document.getElementById('tableSearchInput');
    const pageSizeSelect = document.getElementById('pageSizeSelect');

    if (searchInput) {
        searchInput.oninput = debounce(function () {
            const term = this.value.toLowerCase().trim();
            if (!term) {
                filteredTableRows = allTableRows;
            } else {
                filteredTableRows = allTableRows.filter(row => {
                    for (let col of currentColumns) {
                        const val = row[col];
                        if (val !== null && val !== undefined && String(val).toLowerCase().includes(term)) {
                            return true;
                        }
                    }
                    return false;
                });
            }
            currentPage = 1;
            renderedRowCount = INITIAL_CHUNK_SIZE;
            renderLazyTableRows();
        }, 150);
    }

    if (pageSizeSelect) {
        pageSizeSelect.onchange = function () {
            pageSize = parseInt(this.value, 10);
            currentPage = 1;
            renderedRowCount = pageSize;
            renderLazyTableRows();
        };
    }

    if (btnLoadMore) {
        btnLoadMore.onclick = function () {
            loadMoreRows();
        };
    }

    renderLazyTableRows();
}

function loadMoreRows() {
    const total = filteredTableRows.length;
    const start = renderedRowCount;
    renderedRowCount = Math.min(renderedRowCount + INITIAL_CHUNK_SIZE, total);
    appendTableRowBatch(start, renderedRowCount);
    updateTableInfoAndControls();
}

function renderLazyTableRows() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const total = filteredTableRows.length;
    const end = Math.min(renderedRowCount, total);
    appendTableRowBatch(0, end);
    updateTableInfoAndControls();
}

function appendTableRowBatch(start, end) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        const row = filteredTableRows[i];
        if (!row) continue;
        const tr = document.createElement('tr');
        tr.setAttribute('data-index', i);

        const tdAction = document.createElement('td');
        const searchTerm = row.NAME || row.V_NAME || row.HAB_NAME || row.Name || row.name || row.Id || row.id || '';
        tdAction.innerHTML = `<button type="button" class="btn btn-sm btn-outline-primary py-0 px-2 rounded-pill" title="Locate & zoom on Map" onclick="focusFeatureOnMap(${i}, '${String(searchTerm).replace(/'/g, "\\'")}')"><i class="bi bi-geo-alt-fill"></i></button>`;
        tr.appendChild(tdAction);

        currentColumns.forEach(col => {
            const td = document.createElement('td');
            const val = row[col];

            if (col === "Calculated_Area_Km2" && val && val !== "-") {
                td.innerHTML = `<span class="badge bg-success-subtle text-success mono-font">${val} km²</span>`;
            } else if (col === "Perimeter_Km" && val && val !== "-") {
                td.innerHTML = `<span class="badge bg-purple-subtle text-purple mono-font" style="background:#f5f3ff; color:#8b5cf6;">${val} km</span>`;
            } else if (col === "Centroid" && val && val !== "-") {
                td.innerHTML = `<span class="mono-font small text-muted">${val}</span>`;
            } else if (typeof val === 'boolean') {
                td.innerHTML = `<span class="badge ${val ? 'bg-success' : 'bg-secondary'}">${val}</span>`;
            } else {
                const text = val !== null && val !== undefined ? String(val) : '-';
                td.textContent = text;
                td.title = text;
            }
            tr.appendChild(td);
        });

        fragment.appendChild(tr);
    }

    tbody.appendChild(fragment);
}

function updateTableInfoAndControls() {
    const tableInfo = document.getElementById('tableInfo');
    const btnLoadMore = document.getElementById('btnLoadMore');
    const total = filteredTableRows.length;
    const currentlyShowing = Math.min(renderedRowCount, total);

    if (tableInfo) {
        tableInfo.textContent = total === 0 
            ? 'No matching records' 
            : `Showing ${currentlyShowing.toLocaleString()} of ${total.toLocaleString()} records`;
    }

    if (btnLoadMore) {
        if (currentlyShowing < total) {
            const remaining = total - currentlyShowing;
            const nextBatchSize = Math.min(INITIAL_CHUNK_SIZE, remaining);
            btnLoadMore.innerHTML = `<i class="bi bi-arrow-down-circle me-1"></i> Load More (+${nextBatchSize} rows)`;
            btnLoadMore.classList.remove('d-none');
        } else {
            btnLoadMore.classList.add('d-none');
        }
    }
}
