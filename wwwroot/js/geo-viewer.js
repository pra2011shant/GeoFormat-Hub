/**
 * GeoFormat Hub - Frontend JavaScript Controller
 * =========================================================================
 * Modules included:
 *  1. File Upload Dropzone & Client-side format/size validation
 *  2. Fast Client-side JSON inspection (Safe memory preview)
 *  3. AJAX / Fetch API Upload handler (No full page reload)
 *  4. AJAX / Fetch API Export handler (Binary Blob download & Progress feedback)
 *  5. Leaflet.js GIS Mapping (Canvas renderer & Hover effects)
 *  6. Windowed HTML Tabular Grid (In-memory search filtering & Paginated DOM)
 *  7. Clipboard copy & Sample GeoJSON testing
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

// =========================================================================
// 1. UTILITY FUNCTIONS
// =========================================================================

/**
 * Formats bytes into human-readable string (e.g. "1.45 MB")
 */
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Displays status feedback alerts in the UI.
 */
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

/**
 * Hides status feedback alert.
 */
function hideClientAlert() {
    const alert = document.getElementById('clientAlert');
    if (alert) alert.classList.add('d-none');
}

/**
 * Copies text content of an element to clipboard with user feedback.
 */
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

/**
 * Loads built-in sample GeoJSON file directly into the upload input for instant testing.
 */
function loadSampleData() {
    fetch('/sample_data.geojson')
        .then(response => {
            if (!response.ok) throw new Error("Could not fetch sample dataset");
            return response.text();
        })
        .then(text => {
            window.uploadedRawJson = text;
            window.uploadedFileName = 'sample_cities.geojson';
            const blob = new Blob([text], { type: 'application/geo+json' });
            const file = new File([blob], 'sample_cities.geojson', { type: 'application/geo+json' });
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            const fileInput = document.getElementById('geoFileInput');
            if (fileInput) {
                fileInput.files = dataTransfer.files;
                const changeEvent = new Event('change', { bubbles: true });
                fileInput.dispatchEvent(changeEvent);
            }
        })
        .catch(err => {
            showClientAlert("Error loading sample data: " + err.message, 'danger');
        });
}

// =========================================================================
// 2. UPLOAD FORM, DROPZONE & AJAX SUBMIT
// =========================================================================

/**
 * Initializes Drag & Drop dropzone, file input change events, and AJAX submit.
 */
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

    // Validate selected file extension & update UI badge (Zero RAM load on selection)
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

    // Reset input fields
    function resetFileInput() {
        if (fileInput) fileInput.value = '';
        window.selectedFile = null;
        selectedFileInfo?.classList.add('d-none');
        if (uploadProgressContainer) uploadProgressContainer.classList.add('d-none');
        if (btnUploadSubmit) btnUploadSubmit.disabled = true;
        if (btnClientPreview) btnClientPreview.disabled = true;
        if (clientPreviewContainer) clientPreviewContainer.classList.add('d-none');
    }

    // Input change event
    if (fileInput) {
        fileInput.addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) {
                validateAndProcessFile(e.target.files[0]);
            }
        });
    }

    // Drag & Drop visual events
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

    // Clear file button
    if (btnClearFile) {
        btnClearFile.addEventListener('click', function () {
            resetFileInput();
            hideClientAlert();
        });
    }

    // Client-side instant JSON inspection (Uses fast 32KB stream slice for zero memory lag)
    if (btnClientPreview) {
        btnClientPreview.addEventListener('click', function () {
            const file = fileInput?.files[0] || window.selectedFile;
            if (!file) return;

            // Safe slice: read at most 32KB into browser memory
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
                            `   Click "Upload & Process Data" to stream-analyze the full dataset.\n` +
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

    // AJAX Upload with Real-Time Progress Bar (Supports unlimited file sizes)
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

            // Show Progress UI
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

            // Live Upload Progress
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
                btnUploadSubmit.innerHTML = '<i class="bi bi-upload me-1"></i> Upload & Process Data';

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
                btnUploadSubmit.innerHTML = '<i class="bi bi-upload me-1"></i> Upload & Process Data';
                uploadProgressContainer?.classList.add('d-none');
                showClientAlert("Network connection error occurred during upload.", 'danger');
            };

            xhr.send(formData);
        });
    }
}

// =========================================================================
// 3. EXPORT FORM & AJAX BLOB DOWNLOAD
// =========================================================================

/**
 * Intercepts export button click to download files via async fetch with Blob handler.
 */
function initExportForm() {
    const downloadBtn = document.getElementById('downloadBtn') || document.getElementById('btnExportSubmit');
    const exportIcon = document.getElementById('exportIcon');
    const exportBtnText = document.getElementById('exportBtnText');

    if (!downloadBtn) return;

    downloadBtn.addEventListener('click', async function (e) {
        if (e) e.preventDefault();

        const exportFormatEl = document.getElementById('exportFormat') || document.getElementById('formatSelect');
        const format = exportFormatEl ? exportFormatEl.value : 'excel';
        const rawJson = window.uploadedRawJson; // Store globally on upload
        const fileName = window.uploadedFileName || document.getElementById('exportFileName')?.value || 'GeoData';
        const datasetId = window.uploadedDatasetId || document.getElementById('exportDatasetId')?.value;
        const tableName = document.getElementById('tableNameInput')?.value || 'GeoData';

        if (!rawJson && !datasetId) {
            alert("Please upload a file first!");
            return;
        }

        // Show loading progress state
        downloadBtn.disabled = true;
        if (exportIcon) exportIcon.className = "spinner-border spinner-border-sm me-1";
        if (exportBtnText) exportBtnText.textContent = "Downloading...";

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
                showClientAlert(`Export complete! Downloaded successfully.`, 'success');
            } else {
                let errText = await response.text();
                console.error("Export download failed:", errText);
                alert("Download failed: " + (errText || "File might be too large or invalid."));
            }
        } catch (err) {
            console.error("Export download failed:", err);
            alert("Download failed. " + (err.message || "Please check connection."));
        } finally {
            downloadBtn.disabled = false;
            if (exportIcon) exportIcon.className = "bi bi-download";
            if (exportBtnText) exportBtnText.textContent = "Download File";
        }
    });
}

// =========================================================================
// 4. RESULTS & DASHBOARD RENDERER
// =========================================================================

/**
 * Updates UI with parsed dataset from AJAX or initial server render.
 */
function displayResults(data) {
    currentDataset = data;

    window.uploadedFileName = data.fileName || window.uploadedFileName || 'GeoData';
    if (data.datasetId) {
        window.uploadedDatasetId = data.datasetId;
    }
    if (data.rawJson) {
        window.uploadedRawJson = data.rawJson;
    }

    // 1. Reveal results container
    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) resultsSection.classList.remove('d-none');

    // 2. Populate stats overview
    document.getElementById('statFileName').textContent = data.fileName || 'Data';
    document.getElementById('statDetectedType').textContent = data.detectedType || 'JSON';
    document.getElementById('statTotalRecords').textContent = (data.totalRecords ?? data.rows?.length ?? 0).toLocaleString();
    document.getElementById('statGeometrySummary').textContent = data.geometrySummary || (data.hasGeometry ? 'Spatial Features' : 'Non-spatial JSON');

    // 3. Set export parameters
    const exportDatasetId = document.getElementById('exportDatasetId');
    if (exportDatasetId) exportDatasetId.value = data.datasetId || '';

    const exportFileName = document.getElementById('exportFileName');
    if (exportFileName) exportFileName.value = data.fileName || 'GeoData';

    // 4. Update raw JSON view (safe formatted preview)
    const serverRawJson = document.getElementById('serverRawJson');
    if (serverRawJson) {
        serverRawJson.textContent = data.jsonPreview || data.rawJson || '';
    }

    // 5. Render Leaflet Map (Supports native GeoJSON, GeometryJSON strings, and Lat/Long coordinates)
    let rawObj = null;

    if (data.rawJson) {
        try {
            const parsed = typeof data.rawJson === 'string' ? JSON.parse(data.rawJson) : data.rawJson;
            if (parsed && (parsed.type === 'FeatureCollection' || parsed.type === 'Feature')) {
                rawObj = parsed;
            }
        } catch (e) {
            console.warn("Could not parse rawJson as GeoJSON:", e);
        }
    }

    // If not a native GeoJSON FeatureCollection, dynamically build GeoJSON Features from rows
    if (!rawObj && data.rows && data.rows.length > 0) {
        const features = [];
        const rowsForMap = data.rows.length > 3000 ? data.rows.slice(0, 3000) : data.rows;

        for (let row of rowsForMap) {
            let geomType = row.Geometry_Type || row.GeometryType || "Point";
            let coords = null;

            // 1. Check for embedded GeometryJSON (e.g. "{ \"type\": \"Point\", \"coordinates\": [ 84.08, 24.81 ] }")
            if (row.GeometryJSON) {
                try {
                    const gJson = typeof row.GeometryJSON === 'string' ? JSON.parse(row.GeometryJSON) : row.GeometryJSON;
                    if (gJson && gJson.coordinates) {
                        geomType = gJson.type || geomType;
                        coords = gJson.coordinates;
                    }
                } catch (e) { }
            }

            // 2. Check for Coordinates array/string
            if (!coords && row.Coordinates) {
                try {
                    coords = typeof row.Coordinates === 'string' ? JSON.parse(row.Coordinates) : row.Coordinates;
                } catch (e) { }
            }

            // 3. Check for Longitude and Latitude property variations (strings or numbers)
            if (!coords) {
                const lonVal = row.Longitude !== undefined ? row.Longitude : (row.lon !== undefined ? row.lon : (row.lng !== undefined ? row.lng : row.long));
                const latVal = row.Latitude !== undefined ? row.Latitude : (row.lat !== undefined ? row.lat : row.y);
                if (lonVal !== undefined && latVal !== undefined && lonVal !== null && latVal !== null) {
                    const lonNum = parseFloat(lonVal);
                    const latNum = parseFloat(latVal);
                    if (!isNaN(lonNum) && !isNaN(latNum)) {
                        coords = [lonNum, latNum];
                    }
                }
            }

            if (coords && Array.isArray(coords)) {
                const props = Object.assign({}, row);
                delete props.GeometryJSON;
                features.push({
                    type: "Feature",
                    geometry: {
                        type: geomType || "Point",
                        coordinates: coords
                    },
                    properties: props
                });
            }
        }

        if (features.length > 0) {
            rawObj = {
                type: "FeatureCollection",
                features: features
            };
        }
    }

    renderMap(rawObj);

    // 6. Render Windowed Dynamic HTML Table
    renderDynamicTable(data.columns || [], data.rows || []);

    // 7. Smooth scroll into view
    resultsSection?.scrollIntoView({ behavior: 'smooth' });
}

// =========================================================================
// 5. LEAFLET.JS GIS MAP CONTROLLER (Canvas Accelerated & Safe Sampling)
// =========================================================================

/**
 * Initializes and plots GeoJSON features on Leaflet.js interactive map using Canvas renderer.
 */
function renderMap(rawGeoJson) {
    const mapEl = document.getElementById('mapContainer');
    if (!mapEl) return;

    // Initialize map instance once with Canvas renderer
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

        const cartoPositron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        L.control.layers({
            "OpenStreetMap": osm,
            "Light Canvas": cartoPositron,
            "Dark Canvas": cartoDark
        }).addTo(map);
    }

    // Clean up previous layers
    if (geoJsonLayer) {
        map.removeLayer(geoJsonLayer);
        geoJsonLayer = null;
    }

    const noGeomAlert = document.getElementById('noGeometryAlert');

    if (rawGeoJson && (rawGeoJson.type || (rawGeoJson.features && Array.isArray(rawGeoJson.features)))) {
        try {
            // Apply 3,000 feature limit to canvas map for smooth 60fps rendering without browser freezing
            let plotGeoJson = rawGeoJson;
            if (rawGeoJson.features && rawGeoJson.features.length > 3000) {
                plotGeoJson = {
                    type: "FeatureCollection",
                    features: rawGeoJson.features.slice(0, 3000)
                };
            }

            geoJsonLayer = L.geoJSON(plotGeoJson, {
                renderer: L.canvas(),
                pointToLayer: function (feature, latlng) {
                    return L.circleMarker(latlng, {
                        radius: 7,
                        fillColor: "#2563eb",
                        color: "#ffffff",
                        weight: 2,
                        opacity: 1,
                        fillOpacity: 0.85
                    });
                },
                style: function (feature) {
                    return {
                        color: "#2563eb",
                        weight: 2,
                        opacity: 0.85,
                        fillColor: "#60a5fa",
                        fillOpacity: 0.35
                    };
                },
                onEachFeature: function (feature, layer) {
                    if (feature.properties) {
                        let popupHtml = `<div class="fw-bold mb-1 text-primary"><i class="bi bi-geo-alt me-1"></i>Feature Details</div><table class="popup-table">`;
                        let count = 0;
                        for (let key in feature.properties) {
                            if (count < 10) { // Limit popup properties for speed
                                popupHtml += `<tr><td class="prop-key">${key}</td><td>${feature.properties[key]}</td></tr>`;
                            }
                            count++;
                        }
                        if (count > 10) {
                            popupHtml += `<tr><td colspan="2" class="text-muted small">... and ${count - 10} more attributes</td></tr>`;
                        }
                        popupHtml += `</table>`;
                        layer.bindPopup(popupHtml);
                    }
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

    // Zoom to Fit Layer button
    document.getElementById('btnFitBounds')?.addEventListener('click', function () {
        if (geoJsonLayer && geoJsonLayer.getBounds().isValid()) {
            map.fitBounds(geoJsonLayer.getBounds(), { padding: [30, 30] });
        }
    });
}

// =========================================================================
// 6. WINDOWED / PAGINATED TABULAR GRID (Memory Efficient)
// =========================================================================

let renderedRowCount = 50;
const INITIAL_CHUNK_SIZE = 50;

/**
 * Builds dynamic HTML table header and initializes in-memory lazy-loaded dataset rendering.
 */
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

    // 1. Build Header Row
    thead.innerHTML = '';
    const headerTr = document.createElement('tr');
    currentColumns.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col;
        headerTr.appendChild(th);
    });
    thead.appendChild(headerTr);

    // 2. Setup Search Filtering (Operates purely on JS objects, lightning fast)
    const searchInput = document.getElementById('tableSearchInput');
    const pageSizeSelect = document.getElementById('pageSizeSelect');

    if (searchInput) {
        searchInput.value = '';
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

    // 3. Setup Load More button click listener
    if (btnLoadMore) {
        btnLoadMore.onclick = function () {
            loadMoreRows();
        };
    }

    // 4. Initial render of first 50 rows
    renderLazyTableRows();
}

/**
 * Debounce helper for smooth search input filtering
 */
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Appends the next batch of 50 rows to the table without clearing existing DOM nodes.
 */
function loadMoreRows() {
    const total = filteredTableRows.length;
    const start = renderedRowCount;
    renderedRowCount = Math.min(renderedRowCount + INITIAL_CHUNK_SIZE, total);
    appendTableRowBatch(start, renderedRowCount);
    updateTableInfoAndControls();
}

/**
 * Renders ONLY the first batch (up to 50 rows) into DOM on initial view or search filter change.
 */
function renderLazyTableRows() {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    tbody.innerHTML = '';
    const total = filteredTableRows.length;
    const end = Math.min(renderedRowCount, total);
    appendTableRowBatch(0, end);
    updateTableInfoAndControls();
}

/**
 * Helper to build and append a slice of rows using a single DocumentFragment.
 */
function appendTableRowBatch(start, end) {
    const tbody = document.getElementById('tableBody');
    if (!tbody) return;

    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        const row = filteredTableRows[i];
        if (!row) continue;
        const tr = document.createElement('tr');
        tr.setAttribute('data-index', i);

        currentColumns.forEach(col => {
            const td = document.createElement('td');
            const val = row[col];
            if (typeof val === 'boolean') {
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

/**
 * Updates status text and Load More button visibility.
 */
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
