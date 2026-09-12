using GeoFormat_Hub.Models;
using GeoFormat_Hub.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using System.Diagnostics;
using System.Text.Json;

namespace GeoFormat_Hub.Controllers
{
    /// <summary>
    /// Main controller for GeoFormat Hub.
    /// Handles file uploads (classic form & AJAX), data inspection, and multi-format file exports.
    /// Operates 100% in-memory with intelligent caching for instant conversions without DOM or network overload.
    /// </summary>
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        private readonly IGeoDataService _geoDataService;
        private readonly IMemoryCache _memoryCache;

        private const int MaxJsonPreviewChars = 25000;
        private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(30);

        public HomeController(ILogger<HomeController> logger, IGeoDataService geoDataService, IMemoryCache memoryCache)
        {
            _logger = logger;
            _geoDataService = geoDataService;
            _memoryCache = memoryCache;
        }

        // =========================================================================
        // 1. GET: INDEX VIEW
        // =========================================================================

        /// <summary>
        /// Renders the main conversion & visualization dashboard.
        /// </summary>
        [HttpGet]
        public IActionResult Index()
        {
            return View(new FileUploadViewModel());
        }

        // =========================================================================
        // =========================================================================
        // 2. POST: CLASSIC MULTIPART FORM UPLOAD (WITH FULL PAGE RENDER)
        // =========================================================================

        /// <summary>
        /// Processes file upload via traditional form submit with server validation.
        /// Caches the parsed dataset in-memory and supplies lightweight preview to the view.
        /// </summary>
        [HttpPost]
        [ValidateAntiForgeryToken]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = long.MaxValue, ValueLengthLimit = int.MaxValue)]
        public async Task<IActionResult> Index(FileUploadViewModel model)
        {
            // 1. Validation: Ensure file exists
            if (model.GeoFile == null || model.GeoFile.Length == 0)
            {
                ModelState.AddModelError("GeoFile", "Please choose a valid file to upload.");
                model.IsSuccess = false;
                model.StatusMessage = "No file selected. Please select a .json or .geojson file.";
                return View(model);
            }

            // 2. Validation: Ensure valid extension
            var extension = Path.GetExtension(model.GeoFile.FileName).ToLowerInvariant();
            if (extension != ".json" && extension != ".geojson")
            {
                ModelState.AddModelError("GeoFile", "Invalid file format. Only .json and .geojson files are allowed.");
                model.IsSuccess = false;
                model.StatusMessage = "Invalid file extension. Please upload a file with .json or .geojson extension.";
                return View(model);
            }

            try
            {
                model.FileName = model.GeoFile.FileName;
                model.FileSizeBytes = model.GeoFile.Length;

                // 3. Read stream directly with low memory allocations
                await using (var stream = model.GeoFile.OpenReadStream())
                {
                    // 4. Parse dataset into structured in-memory model from stream
                    var dataset = await _geoDataService.ParseJsonStreamAsync(stream, model.FileName);

                    // 5. Generate cache key and store parsed dataset in IMemoryCache
                    string datasetId = Guid.NewGuid().ToString("N");
                    dataset.DatasetId = datasetId;
                    _memoryCache.Set(datasetId, dataset, CacheDuration);

                    model.DatasetId = datasetId;
                    model.Dataset = dataset;
                    model.DetectedType = dataset.DetectedType;
                    model.FeatureCount = dataset.TotalRecords;
                    model.JsonPreview = await ReadStreamPreviewAsync(model.GeoFile);
                    model.FileContent = model.JsonPreview; // Safe truncated preview for DOM

                    model.IsSuccess = true;
                    model.StatusMessage = $"File '{model.FileName}' ({FormatFileSize(model.FileSizeBytes ?? 0)}) loaded successfully! {dataset.TotalRecords:N0} records detected.";
                }
            }
            catch (JsonException ex)
            {
                model.IsSuccess = false;
                model.StatusMessage = $"File content is not valid JSON. Error: {ex.Message}";
                ModelState.AddModelError("GeoFile", "Invalid JSON syntax.");
            }
            catch (Exception ex)
            {
                model.IsSuccess = false;
                model.StatusMessage = $"Error processing file: {ex.Message}";
                ModelState.AddModelError("GeoFile", "An unexpected error occurred while processing the file.");
            }

            return View(model);
        }

        // =========================================================================
        // 3. POST: AJAX / FETCH API LIVE UPLOAD (SEAMLESS NO-RELOAD)
        // =========================================================================

        /// <summary>
        /// Handles live AJAX uploads from the browser without full page reload.
        /// Supports arbitrarily large files with streaming parsing.
        /// Returns dataset metadata, cached DatasetId, columns, and rows for instant client rendering.
        /// </summary>
        [HttpPost]
        [ValidateAntiForgeryToken]
        [DisableRequestSizeLimit]
        [RequestFormLimits(MultipartBodyLengthLimit = long.MaxValue, ValueLengthLimit = int.MaxValue)]
        public async Task<IActionResult> ProcessUpload(IFormFile? file)
        {
            if (file == null || file.Length == 0)
            {
                return Json(new { success = false, message = "Please select a valid file to upload." });
            }

            var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (extension != ".json" && extension != ".geojson")
            {
                return Json(new { success = false, message = "Invalid format. Only .json and .geojson files are supported." });
            }

            try
            {
                GeoDataset dataset;
                await using (var stream = file.OpenReadStream())
                {
                    dataset = await _geoDataService.ParseJsonStreamAsync(stream, file.FileName);
                }

                // Store in memory cache for instant, zero-reupload exports
                string datasetId = Guid.NewGuid().ToString("N");
                dataset.DatasetId = datasetId;
                _memoryCache.Set(datasetId, dataset, CacheDuration);

                string preview = await ReadStreamPreviewAsync(file);

                // Limit client JSON payload to top 2,500 rows for high-speed DOM responsiveness on huge files
                var clientRows = dataset.Rows.Count > 2500 ? dataset.Rows.Take(2500).ToList() : dataset.Rows;

                return Json(new
                {
                    success = true,
                    datasetId = datasetId,
                    fileName = file.FileName,
                    fileSize = file.Length,
                    fileSizeFormatted = FormatFileSize(file.Length),
                    detectedType = dataset.DetectedType,
                    totalRecords = dataset.TotalRecords,
                    geometrySummary = dataset.GeometryTypeSummary,
                    hasGeometry = dataset.HasGeometry,
                    columns = dataset.Columns,
                    rows = clientRows,
                    isSampled = dataset.Rows.Count > 2500,
                    jsonPreview = preview,
                    message = $"File '{file.FileName}' ({FormatFileSize(file.Length)}) loaded successfully with {dataset.TotalRecords:N0} records!"
                });
            }
            catch (JsonException ex)
            {
                return Json(new { success = false, message = $"Invalid JSON syntax: {ex.Message}" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error processing uploaded file in AJAX handler");
                return Json(new { success = false, message = $"Server error: {ex.Message}" });
            }
        }

        // =========================================================================
        // 4. POST: CONVERT & DOWNLOAD EXPORT (MEMORY CACHED / O(1) LOOKUP)
        // =========================================================================

        /// <summary>
        /// Generates chosen format stream and returns FileResult for direct browser download.
        /// Uses cached in-memory dataset via DatasetId for near-instant zero-reupload exports.
        /// Formats supported: Excel (.xlsx), CSV (.csv), SQL (.sql), XML (.xml).
        /// </summary>
        [HttpPost]
        [IgnoreAntiforgeryToken]
        [DisableRequestSizeLimit]
        public async Task<IActionResult> Export([FromBody] ExportRequestModel? jsonBody)
        {
            ExportRequestModel request;

            if (jsonBody != null && (!string.IsNullOrWhiteSpace(jsonBody.Format) || !string.IsNullOrWhiteSpace(jsonBody.RawJson) || !string.IsNullOrWhiteSpace(jsonBody.DatasetId)))
            {
                request = jsonBody;
            }
            else if (Request.HasFormContentType)
            {
                request = new ExportRequestModel
                {
                    Format = Request.Form["Format"].ToString(),
                    DatasetId = Request.Form["DatasetId"].ToString(),
                    FileName = Request.Form["FileName"].ToString(),
                    RawJson = Request.Form["RawJson"].ToString(),
                    TableName = Request.Form["TableName"].ToString()
                };
            }
            else
            {
                // Fallback: try parsing body stream directly if content-type was application/json but model binding didn't populate
                try
                {
                    using var reader = new StreamReader(Request.Body);
                    var bodyText = await reader.ReadToEndAsync();
                    if (!string.IsNullOrWhiteSpace(bodyText))
                    {
                        request = JsonSerializer.Deserialize<ExportRequestModel>(bodyText, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new ExportRequestModel();
                    }
                    else
                    {
                        request = new ExportRequestModel();
                    }
                }
                catch
                {
                    request = new ExportRequestModel();
                }
            }

            GeoDataset? dataset = null;

            // 1. Check in-memory cache first (High performance, zero re-upload, zero re-parse)
            if (!string.IsNullOrWhiteSpace(request.DatasetId) && _memoryCache.TryGetValue(request.DatasetId, out GeoDataset? cachedDataset))
            {
                dataset = cachedDataset;
            }
            // 2. Fallback to parsing RawJson if provided (e.g. client generated or cache expired)
            else if (!string.IsNullOrWhiteSpace(request.RawJson))
            {
                try
                {
                    dataset = _geoDataService.ParseJson(request.RawJson, request.FileName);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to parse fallback RawJson during export");
                    return BadRequest("Invalid JSON data provided for export.");
                }
            }

            if (dataset == null || dataset.Rows == null)
            {
                return BadRequest("Export failed: Dataset session has expired or no data was provided. Please re-upload your file.");
            }

            try
            {
                string baseName = Path.GetFileNameWithoutExtension(string.IsNullOrWhiteSpace(request.FileName) ? dataset.FileName : request.FileName);
                if (string.IsNullOrWhiteSpace(baseName)) baseName = "GeoData_Export";

                // Ensure Content-Disposition is accessible to client AJAX/Fetch requests
                Response.Headers["Access-Control-Expose-Headers"] = "Content-Disposition";

                switch (request.Format?.ToLowerInvariant())
                {
                    case "json":
                    case "geojson":
                        {
                            var bytes = !string.IsNullOrWhiteSpace(request.RawJson)
                                ? System.Text.Encoding.UTF8.GetBytes(request.RawJson)
                                : (request.Format.ToLowerInvariant() == "geojson" 
                                    ? _geoDataService.ExportToGeoJson(dataset) 
                                    : _geoDataService.ExportToJson(dataset));
                            return File(bytes, "application/json; charset=utf-8", $"{baseName}.{request.Format}");
                        }
                    case "xlsx":
                    case "excel":
                        {
                            var bytes = _geoDataService.ExportToExcel(dataset);
                            return File(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"{baseName}.xlsx");
                        }
                    case "csv":
                        {
                            var bytes = _geoDataService.ExportToCsv(dataset);
                            return File(bytes, "text/csv; charset=utf-8", $"{baseName}.csv");
                        }
                    case "sql":
                        {
                            string tableName = string.IsNullOrWhiteSpace(request.TableName) ? baseName : request.TableName;
                            var bytes = _geoDataService.ExportToSql(dataset, tableName);
                            return File(bytes, "application/sql; charset=utf-8", $"{baseName}.sql");
                        }
                    case "xml":
                        {
                            var bytes = _geoDataService.ExportToXml(dataset);
                            return File(bytes, "application/xml; charset=utf-8", $"{baseName}.xml");
                        }
                    default:
                        return BadRequest("Unsupported export format.");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error exporting data to format '{Format}'", request.Format);
                return StatusCode(500, $"Export error: {ex.Message}");
            }
        }

        // =========================================================================
        // 5. UTILITY & DEFAULT ACTIONS
        // =========================================================================

        /// <summary>
        /// Reads first chunk of uploaded file stream safely without buffering entire large file in RAM.
        /// </summary>
        private static async Task<string> ReadStreamPreviewAsync(IFormFile file)
        {
            try
            {
                await using var stream = file.OpenReadStream();
                int bufferSize = (int)Math.Min(MaxJsonPreviewChars, file.Length > 0 ? file.Length : MaxJsonPreviewChars);
                byte[] buffer = new byte[bufferSize];
                int bytesRead = await stream.ReadAsync(buffer, 0, bufferSize);
                string text = System.Text.Encoding.UTF8.GetString(buffer, 0, bytesRead);
                return CreateJsonPreview(text, file.Length);
            }
            catch
            {
                return string.Empty;
            }
        }

        /// <summary>
        /// Generates a safe, truncated JSON preview for DOM rendering to prevent browser lockups on large datasets.
        /// </summary>
        private static string CreateJsonPreview(string json, long fileSizeBytes)
        {
            if (string.IsNullOrWhiteSpace(json)) return string.Empty;

            if (json.Length <= MaxJsonPreviewChars && fileSizeBytes <= MaxJsonPreviewChars)
            {
                return json;
            }

            // Truncate safely at max chars limit
            string truncated = json.Length > MaxJsonPreviewChars ? json.Substring(0, MaxJsonPreviewChars) : json;
            return truncated + $"\n\n/* -------------------------------------------------------------------------\n" +
                               $"   [STREAM PREVIEW TRUNCATED FOR BROWSER PERFORMANCE]\n" +
                               $"   Displaying first ~{FormatFileSize(truncated.Length)} of {FormatFileSize(fileSizeBytes)} file.\n" +
                               $"   Full dataset ({fileSizeBytes:N0} bytes) is loaded in-memory and available for\n" +
                               $"   Tabular Grid viewing and Multi-Format Exports.\n" +
                               $"   ------------------------------------------------------------------------- */";
        }

        /// <summary>
        /// Formats byte count into human-readable string (e.g. 1.25 MB).
        /// </summary>
        private static string FormatFileSize(long bytes)
        {
            string[] suffixes = { "B", "KB", "MB", "GB" };
            int i = 0;
            double dBytes = bytes;
            while (dBytes >= 1024 && i < suffixes.Length - 1)
            {
                dBytes /= 1024;
                i++;
            }
            return $"{dBytes:0.##} {suffixes[i]}";
        }

        public IActionResult Privacy()
        {
            return View();
        }

        [ResponseCache(Duration = 0, Location = ResponseCacheLocation.None, NoStore = true)]
        public IActionResult Error()
        {
            return View(new ErrorViewModel { RequestId = Activity.Current?.Id ?? HttpContext.TraceIdentifier });
        }
    }
}
