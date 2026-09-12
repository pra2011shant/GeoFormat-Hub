using ClosedXML.Excel;
using CsvHelper;
using CsvHelper.Configuration;
using GeoFormat_Hub.Models;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace GeoFormat_Hub.Services
{
    /// <summary>
    /// Core Conversion Engine Service.
    /// Handles parsing of JSON & GeoJSON formats and high-performance export to
    /// Excel (.xlsx), CSV (.csv), SQL script (.sql), and XML (.xml).
    /// All operations run 100% in-memory with zero database dependencies.
    /// </summary>
    public class GeoDataService : IGeoDataService
    {
        // =========================================================================
        // 1. JSON & GeoJSON PARSING ENGINE (STREAM & STRING COMPATIBLE)
        // =========================================================================

        /// <summary>
        /// Analyzes and parses uploaded JSON/GeoJSON content into a structured GeoDataset.
        /// Supports FeatureCollection, Feature, JSON Arrays, and generic JSON Objects.
        /// </summary>
        public GeoDataset ParseJson(string jsonContent, string fileName)
        {
            var dataset = new GeoDataset
            {
                FileName = fileName,
                RawJson = jsonContent.Length <= 5000000 ? jsonContent : string.Empty
            };

            if (string.IsNullOrWhiteSpace(jsonContent))
            {
                return dataset;
            }

            var docOptions = new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip,
                MaxDepth = 128
            };

            using var doc = JsonDocument.Parse(jsonContent, docOptions);
            ParseJsonDocument(doc, dataset);
            return dataset;
        }

        /// <summary>
        /// Analyzes and parses uploaded JSON/GeoJSON UTF-8 stream asynchronously into a structured GeoDataset.
        /// Direct stream consumption avoids allocating massive multi-gigabyte strings in memory.
        /// </summary>
        public async Task<GeoDataset> ParseJsonStreamAsync(Stream utf8Stream, string fileName, CancellationToken cancellationToken = default)
        {
            var dataset = new GeoDataset
            {
                FileName = fileName
            };

            if (utf8Stream == null)
            {
                return dataset;
            }

            var docOptions = new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip,
                MaxDepth = 128
            };

            using var doc = await JsonDocument.ParseAsync(utf8Stream, docOptions, cancellationToken);
            ParseJsonDocument(doc, dataset);
            return dataset;
        }

        /// <summary>
        /// Analyzes and parses uploaded JSON/GeoJSON UTF-8 stream synchronously into a structured GeoDataset.
        /// </summary>
        public GeoDataset ParseJsonStream(Stream utf8Stream, string fileName)
        {
            var dataset = new GeoDataset
            {
                FileName = fileName
            };

            if (utf8Stream == null)
            {
                return dataset;
            }

            var docOptions = new JsonDocumentOptions
            {
                AllowTrailingCommas = true,
                CommentHandling = JsonCommentHandling.Skip,
                MaxDepth = 128
            };

            using var doc = JsonDocument.Parse(utf8Stream, docOptions);
            ParseJsonDocument(doc, dataset);
            return dataset;
        }

        /// <summary>
        /// Common core parsing logic from JsonDocument root element.
        /// Supports GeoJSON (FeatureCollection, Feature, Geometry) and ALL standard JSON structures
        /// (Arrays of objects, Wrapped object arrays like { data: [...] }, and Key-Value dictionaries).
        /// </summary>
        private void ParseJsonDocument(JsonDocument doc, GeoDataset dataset)
        {
            var root = doc.RootElement;

            if (root.ValueKind == JsonValueKind.Object)
            {
                // 1. Check if this object is a standard GeoJSON structure
                if (root.TryGetProperty("type", out var typeProp))
                {
                    string? type = typeProp.GetString();
                    if (!string.IsNullOrWhiteSpace(type))
                    {
                        if (string.Equals(type, "FeatureCollection", StringComparison.OrdinalIgnoreCase) &&
                            root.TryGetProperty("features", out var features) &&
                            features.ValueKind == JsonValueKind.Array)
                        {
                            dataset.DetectedType = "GeoJSON FeatureCollection";
                            ParseFeatureCollection(features, dataset);
                            return;
                        }
                        else if (string.Equals(type, "Feature", StringComparison.OrdinalIgnoreCase))
                        {
                            dataset.DetectedType = "GeoJSON Feature";
                            ParseSingleFeature(root, dataset);
                            return;
                        }
                    }
                }

                // 2. Check if JSON object wraps a primary array (e.g. { "data": [...] }, { "records": [...] }, { "items": [...] })
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        dataset.DetectedType = $"JSON Object ({prop.Name} array)";
                        ParseGenericJsonArray(prop.Value, dataset);
                        return;
                    }
                }

                // 3. Generic Key-Value JSON object fallback
                dataset.DetectedType = "JSON Object (Key-Value)";
                ParseGenericJsonObject(root, dataset);
            }
            else if (root.ValueKind == JsonValueKind.Array)
            {
                // Array of JSON records
                dataset.DetectedType = "JSON Array";
                ParseGenericJsonArray(root, dataset);
            }
        }

        /// <summary>
        /// Parses a GeoJSON FeatureCollection array into tabular rows with geometry summaries.
        /// </summary>
        private void ParseFeatureCollection(JsonElement features, GeoDataset dataset)
        {
            var columnSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var tempRows = new List<Dictionary<string, object?>>();
            var geometryTypes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            int index = 1;

            foreach (var feature in features.EnumerateArray())
            {
                var row = ParseFeatureItem(feature, index, columnSet, geometryTypes, dataset);
                tempRows.Add(row);
                index++;
            }

            // Standardize column order (Identifiers & geometry first, followed by custom properties)
            var columns = new List<string> { "Feature_Id", "Geometry_Type", "Coordinates" };
            foreach (var col in columnSet)
            {
                if (!columns.Contains(col, StringComparer.OrdinalIgnoreCase))
                {
                    columns.Add(col);
                }
            }

            dataset.Columns = columns;
            dataset.Rows = tempRows;
            dataset.GeometryTypeSummary = string.Join(", ", geometryTypes.Select(kv => $"{kv.Key} ({kv.Value})"));
        }

        /// <summary>
        /// Parses a standalone GeoJSON Feature into a single-item collection.
        /// </summary>
        private void ParseSingleFeature(JsonElement feature, GeoDataset dataset)
        {
            var columnSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var geometryTypes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            var row = ParseFeatureItem(feature, 1, columnSet, geometryTypes, dataset);

            var columns = new List<string> { "Feature_Id", "Geometry_Type", "Coordinates" };
            foreach (var col in columnSet)
            {
                if (!columns.Contains(col, StringComparer.OrdinalIgnoreCase))
                {
                    columns.Add(col);
                }
            }

            dataset.Columns = columns;
            dataset.Rows = new List<Dictionary<string, object?>> { row };
            dataset.GeometryTypeSummary = string.Join(", ", geometryTypes.Select(kv => $"{kv.Key} ({kv.Value})"));
        }

        /// <summary>
        /// Extracts row dictionary, geometry, and properties from a single Feature element.
        /// </summary>
        private Dictionary<string, object?> ParseFeatureItem(
            JsonElement feature, 
            int index, 
            HashSet<string> columnSet, 
            Dictionary<string, int> geometryTypes, 
            GeoDataset dataset)
        {
            var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
            row["Feature_Id"] = index;

            // 1. Geometry Extraction & Classification
            if (feature.TryGetProperty("geometry", out var geom) && geom.ValueKind == JsonValueKind.Object)
            {
                dataset.HasGeometry = true;
                string geomType = "Unknown";
                if (geom.TryGetProperty("type", out var gType) && gType.ValueKind == JsonValueKind.String)
                {
                    geomType = gType.GetString() ?? "Unknown";
                }

                row["Geometry_Type"] = geomType;
                if (!geometryTypes.ContainsKey(geomType)) geometryTypes[geomType] = 0;
                geometryTypes[geomType]++;

                if (geom.TryGetProperty("coordinates", out var coords))
                {
                    row["Coordinates"] = SummarizeCoordinates(coords, geomType);
                }
            }
            else
            {
                row["Geometry_Type"] = "None";
            }

            // 2. Feature Properties Extraction
            if (feature.TryGetProperty("properties", out var props) && props.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in props.EnumerateObject())
                {
                    columnSet.Add(prop.Name);
                    row[prop.Name] = ExtractJsonValue(prop.Value);
                }
            }

            return row;
        }

        /// <summary>
        /// Parses a generic array of JSON objects into structured grid rows.
        /// Automatically detects ESRI ArcGIS (rings, paths, x/y), GeoJSON, and latitude/longitude properties.
        /// </summary>
        private void ParseGenericJsonArray(JsonElement array, GeoDataset dataset)
        {
            var columnSet = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var tempRows = new List<Dictionary<string, object?>>();
            int index = 1;
            bool coordinatesDetected = false;
            string detectedGeomType = "Point";

            foreach (var item in array.EnumerateArray())
            {
                var row = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                row["Index"] = index;

                if (item.ValueKind == JsonValueKind.Object)
                {
                    double? lat = null;
                    double? lon = null;
                    string? geomJsonString = null;
                    string? customGeomType = null;
                    string? directCoordinates = null;

                    foreach (var prop in item.EnumerateObject())
                    {
                        columnSet.Add(prop.Name);
                        object? val = ExtractJsonValue(prop.Value);
                        row[prop.Name] = val;

                        if (prop.Name.Equals("GeometryJSON", StringComparison.OrdinalIgnoreCase) ||
                            prop.Name.Equals("geometry", StringComparison.OrdinalIgnoreCase) ||
                            prop.Name.Equals("geom", StringComparison.OrdinalIgnoreCase) ||
                            prop.Name.Equals("the_geom", StringComparison.OrdinalIgnoreCase) ||
                            prop.Name.Equals("geojson", StringComparison.OrdinalIgnoreCase) ||
                            prop.Name.Equals("shape", StringComparison.OrdinalIgnoreCase))
                        {
                            geomJsonString = val?.ToString();
                        }
                        else if (prop.Name.Equals("rings", StringComparison.OrdinalIgnoreCase) ||
                                 prop.Name.Equals("paths", StringComparison.OrdinalIgnoreCase) ||
                                 prop.Name.Equals("coordinates", StringComparison.OrdinalIgnoreCase))
                        {
                            directCoordinates = val?.ToString();
                            if (prop.Name.Equals("rings", StringComparison.OrdinalIgnoreCase)) customGeomType = "Polygon";
                            else if (prop.Name.Equals("paths", StringComparison.OrdinalIgnoreCase)) customGeomType = "LineString";
                        }
                        else if (prop.Name.Equals("GeometryType", StringComparison.OrdinalIgnoreCase) ||
                                 prop.Name.Equals("Geometry_Type", StringComparison.OrdinalIgnoreCase))
                        {
                            customGeomType = val?.ToString();
                        }

                        // Robust coordinate parsing: handles both numeric (double) and string ("84.089...") values
                        if (val != null && double.TryParse(val.ToString(), NumberStyles.Any, CultureInfo.InvariantCulture, out double numVal))
                        {
                            if (prop.Name.Equals("lat", StringComparison.OrdinalIgnoreCase) ||
                                prop.Name.Equals("latitude", StringComparison.OrdinalIgnoreCase) ||
                                prop.Name.Equals("lat_deg", StringComparison.OrdinalIgnoreCase) ||
                                prop.Name.Equals("y", StringComparison.OrdinalIgnoreCase))
                            {
                                if (numVal >= -90 && numVal <= 90) lat = numVal;
                            }
                            else if (prop.Name.Equals("lon", StringComparison.OrdinalIgnoreCase) ||
                                     prop.Name.Equals("lng", StringComparison.OrdinalIgnoreCase) ||
                                     prop.Name.Equals("long", StringComparison.OrdinalIgnoreCase) ||
                                     prop.Name.Equals("longitude", StringComparison.OrdinalIgnoreCase) ||
                                     prop.Name.Equals("lon_deg", StringComparison.OrdinalIgnoreCase) ||
                                     prop.Name.Equals("x", StringComparison.OrdinalIgnoreCase))
                            {
                                if (numVal >= -180 && numVal <= 180) lon = numVal;
                            }
                        }
                    }

                    // 1. Direct Lat/Lon fields found
                    if (lat.HasValue && lon.HasValue)
                    {
                        string gType = !string.IsNullOrWhiteSpace(customGeomType) ? customGeomType : "Point";
                        row["Geometry_Type"] = gType;
                        row["Coordinates"] = $"[{lon.Value.ToString(CultureInfo.InvariantCulture)}, {lat.Value.ToString(CultureInfo.InvariantCulture)}]";
                        coordinatesDetected = true;
                        detectedGeomType = gType;
                    }
                    // 2. Embedded Geometry JSON found (GeoJSON or ESRI ArcGIS format)
                    else if (!string.IsNullOrWhiteSpace(geomJsonString))
                    {
                        try
                        {
                            using var gDoc = JsonDocument.Parse(geomJsonString);
                            var gRoot = gDoc.RootElement;
                            if (gRoot.ValueKind == JsonValueKind.Object)
                            {
                                // A. GeoJSON format: { type: "Polygon", coordinates: [...] }
                                if (gRoot.TryGetProperty("type", out var gType) &&
                                    gRoot.TryGetProperty("coordinates", out var gCoords))
                                {
                                    string gTypeStr = gType.GetString() ?? "Polygon";
                                    row["Geometry_Type"] = gTypeStr;
                                    row["Coordinates"] = gCoords.GetRawText();
                                    coordinatesDetected = true;
                                    detectedGeomType = gTypeStr;
                                }
                                // B. ESRI ArcGIS Polygon format: { rings: [[[x, y], ...]] }
                                else if (gRoot.TryGetProperty("rings", out var rings) && rings.ValueKind == JsonValueKind.Array)
                                {
                                    row["Geometry_Type"] = "Polygon";
                                    row["Coordinates"] = rings.GetRawText();
                                    coordinatesDetected = true;
                                    detectedGeomType = "Polygon";
                                }
                                // C. ESRI ArcGIS Polyline format: { paths: [[[x, y], ...]] }
                                else if (gRoot.TryGetProperty("paths", out var paths) && paths.ValueKind == JsonValueKind.Array)
                                {
                                    var pathArray = paths.EnumerateArray().ToList();
                                    if (pathArray.Count == 1)
                                    {
                                        row["Geometry_Type"] = "LineString";
                                        row["Coordinates"] = pathArray[0].GetRawText();
                                        detectedGeomType = "LineString";
                                    }
                                    else
                                    {
                                        row["Geometry_Type"] = "MultiLineString";
                                        row["Coordinates"] = paths.GetRawText();
                                        detectedGeomType = "MultiLineString";
                                    }
                                    coordinatesDetected = true;
                                }
                                // D. ESRI ArcGIS Point format: { x: ..., y: ... }
                                else if (gRoot.TryGetProperty("x", out var gx) && gRoot.TryGetProperty("y", out var gy))
                                {
                                    row["Geometry_Type"] = "Point";
                                    row["Coordinates"] = $"[{gx.GetRawText()}, {gy.GetRawText()}]";
                                    coordinatesDetected = true;
                                    detectedGeomType = "Point";
                                }
                            }
                        }
                        catch { }
                    }
                    // 3. Direct coordinates / rings property on row
                    else if (!string.IsNullOrWhiteSpace(directCoordinates))
                    {
                        string gType = !string.IsNullOrWhiteSpace(customGeomType) ? customGeomType : "Polygon";
                        row["Geometry_Type"] = gType;
                        row["Coordinates"] = directCoordinates;
                        coordinatesDetected = true;
                        detectedGeomType = gType;
                    }
                }
                else
                {
                    columnSet.Add("Value");
                    row["Value"] = ExtractJsonValue(item);
                }

                tempRows.Add(row);
                index++;
            }

            var columns = new List<string> { "Index" };
            if (coordinatesDetected)
            {
                dataset.HasGeometry = true;
                dataset.GeometryTypeSummary = $"{detectedGeomType} ({tempRows.Count})";
                columns.Add("Geometry_Type");
                columns.Add("Coordinates");
            }

            foreach (var col in columnSet)
            {
                if (!columns.Contains(col, StringComparer.OrdinalIgnoreCase))
                {
                    columns.Add(col);
                }
            }

            dataset.Columns = columns;
            dataset.Rows = tempRows;
        }

        /// <summary>
        /// Parses a single generic JSON object as Property-Value pairs.
        /// </summary>
        private void ParseGenericJsonObject(JsonElement obj, GeoDataset dataset)
        {
            var columns = new List<string> { "Property", "Value" };
            var rows = new List<Dictionary<string, object?>>();

            foreach (var prop in obj.EnumerateObject())
            {
                rows.Add(new Dictionary<string, object?>
                {
                    ["Property"] = prop.Name,
                    ["Value"] = ExtractJsonValue(prop.Value)
                });
            }

            dataset.Columns = columns;
            dataset.Rows = rows;
        }

        /// <summary>
        /// Safely extracts strongly-typed .NET primitives from JsonElement tokens.
        /// </summary>
        private static object? ExtractJsonValue(JsonElement element)
        {
            return element.ValueKind switch
            {
                JsonValueKind.String => element.GetString(),
                JsonValueKind.Number => element.TryGetInt64(out long l) ? l : element.GetDouble(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                JsonValueKind.Null => null,
                JsonValueKind.Array => element.GetRawText(),
                JsonValueKind.Object => element.GetRawText(),
                _ => element.GetRawText()
            };
        }

        /// <summary>
        /// Summarizes coordinates into readable text format for table display.
        /// </summary>
        private static string SummarizeCoordinates(JsonElement coords, string geomType)
        {
            if (geomType.Equals("Point", StringComparison.OrdinalIgnoreCase) && coords.ValueKind == JsonValueKind.Array)
            {
                var items = coords.EnumerateArray().ToList();
                if (items.Count >= 2)
                {
                    return $"[{items[0]}, {items[1]}]";
                }
            }
            return coords.GetRawText();
        }

        // =========================================================================
        // 2. EXCEL (.XLSX) EXPORT MODULE (ClosedXML)
        // =========================================================================

        /// <summary>
        /// Generates a styled Excel spreadsheet using ClosedXML with freeze panes, header styling, and auto-fit columns.
        /// </summary>
        public byte[] ExportToExcel(GeoDataset dataset)
        {
            using var workbook = new XLWorkbook();
            string sheetName = SanitizeSheetName(dataset?.FileName);
            var worksheet = workbook.Worksheets.Add(string.IsNullOrWhiteSpace(sheetName) ? "GeoData" : sheetName);

            var columns = dataset?.Columns ?? new List<string>();
            var rows = dataset?.Rows ?? new List<Dictionary<string, object?>>();

            if (columns.Count == 0)
            {
                worksheet.Cell(1, 1).Value = "No Data";
                using var emptyMs = new MemoryStream();
                workbook.SaveAs(emptyMs);
                return emptyMs.ToArray();
            }

            // 1. Write Header Row
            for (int c = 0; c < columns.Count; c++)
            {
                var cell = worksheet.Cell(1, c + 1);
                string header = columns[c] ?? $"Column_{c + 1}";
                cell.Value = header.Length > 32767 ? header.Substring(0, 32764) + "..." : header;
                cell.Style.Font.Bold = true;
                cell.Style.Font.FontColor = XLColor.White;
                cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#1E40AF");
                cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
            }

            // 2. Write Data Rows
            for (int r = 0; r < rows.Count; r++)
            {
                var row = rows[r];
                for (int c = 0; c < columns.Count; c++)
                {
                    string colName = columns[c];
                    object? val = null;
                    row?.TryGetValue(colName, out val);
                    var cell = worksheet.Cell(r + 2, c + 1);

                    if (val == null)
                    {
                        cell.Value = Blank.Value;
                    }
                    else if (val is int i) cell.Value = i;
                    else if (val is long l) cell.Value = l;
                    else if (val is double d) cell.Value = d;
                    else if (val is float f) cell.Value = f;
                    else if (val is decimal dec) cell.Value = dec;
                    else if (val is bool b) cell.Value = b;
                    else if (val is DateTime dt) cell.Value = dt;
                    else if (val is JsonElement je)
                    {
                        switch (je.ValueKind)
                        {
                            case JsonValueKind.String:
                                string s = je.GetString() ?? string.Empty;
                                cell.Value = s.Length > 32767 ? s.Substring(0, 32764) + "..." : s;
                                break;
                            case JsonValueKind.Number:
                                if (je.TryGetInt64(out long jl)) cell.Value = jl;
                                else if (je.TryGetDouble(out double jd)) cell.Value = jd;
                                else cell.Value = je.GetRawText();
                                break;
                            case JsonValueKind.True:
                                cell.Value = true;
                                break;
                            case JsonValueKind.False:
                                cell.Value = false;
                                break;
                            case JsonValueKind.Null:
                                cell.Value = Blank.Value;
                                break;
                            default:
                                string raw = je.GetRawText();
                                cell.Value = raw.Length > 32767 ? raw.Substring(0, 32764) + "..." : raw;
                                break;
                        }
                    }
                    else
                    {
                        string str = val.ToString() ?? string.Empty;
                        cell.Value = str.Length > 32767 ? str.Substring(0, 32764) + "..." : str;
                    }

                    // Alternating light row striping
                    if (r % 2 == 1)
                    {
                        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#F8FAFC");
                    }
                }
            }

            // 3. Safe layout formatting
            try
            {
                worksheet.Columns().AdjustToContents(1, Math.Max(2, rows.Count + 1), 10.0, 80.0);
            }
            catch
            {
                try
                {
                    worksheet.Columns().Width = 20;
                }
                catch { }
            }

            try
            {
                worksheet.SheetView.FreezeRows(1);
            }
            catch { }

            using var ms = new MemoryStream();
            workbook.SaveAs(ms);
            return ms.ToArray();
        }

        // =========================================================================
        // 3. CSV (.CSV) EXPORT MODULE (CsvHelper)
        // =========================================================================

        /// <summary>
        /// Generates standard CSV with UTF-8 BOM encoding for seamless Excel compatibility using CsvHelper.
        /// </summary>
        public byte[] ExportToCsv(GeoDataset dataset)
        {
            using var ms = new MemoryStream();
            using var writer = new StreamWriter(ms, new UTF8Encoding(true)); // Include BOM
            using var csv = new CsvWriter(writer, new CsvConfiguration(CultureInfo.InvariantCulture)
            {
                HasHeaderRecord = true
            });

            // Write Header
            foreach (var col in dataset.Columns)
            {
                csv.WriteField(col);
            }
            csv.NextRecord();

            // Write Records
            foreach (var row in dataset.Rows)
            {
                foreach (var col in dataset.Columns)
                {
                    row.TryGetValue(col, out var val);
                    csv.WriteField(val?.ToString() ?? string.Empty);
                }
                csv.NextRecord();
            }

            writer.Flush();
            return ms.ToArray();
        }

        // =========================================================================
        // 4. SQL (.SQL) EXPORT MODULE (StringBuilder)
        // =========================================================================

        /// <summary>
        /// Generates CREATE TABLE and INSERT INTO statements with schema inference and quote escaping.
        /// </summary>
        public byte[] ExportToSql(GeoDataset dataset, string tableName)
        {
            var sb = new StringBuilder();
            string cleanTable = SanitizeIdentifier(string.IsNullOrWhiteSpace(tableName) ? "GeoDataRecords" : tableName);

            sb.AppendLine($"-- =============================================");
            sb.AppendLine($"-- GeoFormat Hub SQL Export");
            sb.AppendLine($"-- Source File: {dataset.FileName}");
            sb.AppendLine($"-- Exported at: {DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
            sb.AppendLine($"-- Total Records: {dataset.Rows.Count}");
            sb.AppendLine($"-- =============================================");
            sb.AppendLine();

            // 1. CREATE TABLE Script
            sb.AppendLine($"IF OBJECT_ID('dbo.[{cleanTable}]', 'U') IS NOT NULL");
            sb.AppendLine($"    DROP TABLE dbo.[{cleanTable}];");
            sb.AppendLine("GO");
            sb.AppendLine();

            sb.AppendLine($"CREATE TABLE dbo.[{cleanTable}] (");

            var cleanCols = new List<string>();
            for (int i = 0; i < dataset.Columns.Count; i++)
            {
                string origCol = dataset.Columns[i];
                string cleanCol = SanitizeIdentifier(origCol);
                if (cleanCols.Contains(cleanCol, StringComparer.OrdinalIgnoreCase))
                {
                    cleanCol = $"{cleanCol}_{i + 1}";
                }
                cleanCols.Add(cleanCol);

                string colType = InferSqlType(dataset.Rows, origCol);
                string comma = (i < dataset.Columns.Count - 1) ? "," : "";
                sb.AppendLine($"    [{cleanCol}] {colType}{comma}");
            }
            sb.AppendLine(");");
            sb.AppendLine("GO");
            sb.AppendLine();

            // 2. INSERT INTO Statements
            if (dataset.Rows.Count > 0)
            {
                sb.AppendLine($"-- Insert Statements");
                string colList = string.Join(", ", cleanCols.Select(c => $"[{c}]"));

                foreach (var row in dataset.Rows)
                {
                    var values = new List<string>();
                    for (int c = 0; c < dataset.Columns.Count; c++)
                    {
                        string colName = dataset.Columns[c];
                        row.TryGetValue(colName, out var val);
                        values.Add(FormatSqlValue(val));
                    }

                    sb.AppendLine($"INSERT INTO dbo.[{cleanTable}] ({colList}) VALUES ({string.Join(", ", values)});");
                }
            }

            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        // =========================================================================
        // 5. XML (.XML) EXPORT MODULE
        // =========================================================================

        /// <summary>
        /// Generates a well-formed XML representation of the dataset.
        /// </summary>
        public byte[] ExportToXml(GeoDataset dataset)
        {
            var sb = new StringBuilder();
            sb.AppendLine("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
            sb.AppendLine($"<GeoDataset fileName=\"{System.Security.SecurityElement.Escape(dataset.FileName)}\" totalRecords=\"{dataset.Rows.Count}\">");

            foreach (var row in dataset.Rows)
            {
                sb.AppendLine("  <Record>");
                foreach (var col in dataset.Columns)
                {
                    row.TryGetValue(col, out var val);
                    string cleanTag = SanitizeIdentifier(col);
                    string strVal = System.Security.SecurityElement.Escape(val?.ToString() ?? "");
                    sb.AppendLine($"    <{cleanTag}>{strVal}</{cleanTag}>");
                }
                sb.AppendLine("  </Record>");
            }

            sb.AppendLine("</GeoDataset>");
            return Encoding.UTF8.GetBytes(sb.ToString());
        }

        // =========================================================================
        // 6. JSON (.JSON) & GEOJSON (.GEOJSON) EXPORT MODULES
        // =========================================================================

        /// <summary>
        /// Generates standard indented JSON representation of the dataset.
        /// </summary>
        public byte[] ExportToJson(GeoDataset dataset)
        {
            if (!string.IsNullOrWhiteSpace(dataset.RawJson))
            {
                try
                {
                    using var doc = JsonDocument.Parse(dataset.RawJson);
                    return JsonSerializer.SerializeToUtf8Bytes(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
                }
                catch
                {
                    return Encoding.UTF8.GetBytes(dataset.RawJson);
                }
            }

            return JsonSerializer.SerializeToUtf8Bytes(dataset.Rows, new JsonSerializerOptions { WriteIndented = true });
        }

        /// <summary>
        /// Generates a valid GeoJSON FeatureCollection representation of the dataset.
        /// </summary>
        public byte[] ExportToGeoJson(GeoDataset dataset)
        {
            if (!string.IsNullOrWhiteSpace(dataset.RawJson) && dataset.DetectedType.Contains("Feature", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    using var doc = JsonDocument.Parse(dataset.RawJson);
                    return JsonSerializer.SerializeToUtf8Bytes(doc.RootElement, new JsonSerializerOptions { WriteIndented = true });
                }
                catch
                {
                    return Encoding.UTF8.GetBytes(dataset.RawJson);
                }
            }

            // Construct standard GeoJSON FeatureCollection from parsed rows
            var featureList = new List<Dictionary<string, object?>>();
            foreach (var row in dataset.Rows)
            {
                var properties = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
                object? geometryObj = null;

                foreach (var kvp in row)
                {
                    if (kvp.Key.Equals("Coordinates", StringComparison.OrdinalIgnoreCase) ||
                        kvp.Key.Equals("Geometry_Type", StringComparison.OrdinalIgnoreCase) ||
                        kvp.Key.Equals("Feature_Id", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    properties[kvp.Key] = kvp.Value;
                }

                if (row.TryGetValue("Geometry_Type", out var gTypeVal) && gTypeVal != null && !gTypeVal.ToString()!.Equals("None", StringComparison.OrdinalIgnoreCase))
                {
                    string geomType = gTypeVal.ToString()!;
                    if (row.TryGetValue("Coordinates", out var coordsVal) && coordsVal != null)
                    {
                        try
                        {
                            using var doc = JsonDocument.Parse(coordsVal.ToString()!);
                            geometryObj = new
                            {
                                type = geomType,
                                coordinates = doc.RootElement.Clone()
                            };
                        }
                        catch
                        {
                            geometryObj = null;
                        }
                    }
                }

                var feature = new Dictionary<string, object?>
                {
                    ["type"] = "Feature",
                    ["geometry"] = geometryObj,
                    ["properties"] = properties
                };
                featureList.Add(feature);
            }

            var geoJsonObj = new Dictionary<string, object?>
            {
                ["type"] = "FeatureCollection",
                ["features"] = featureList
            };

            return JsonSerializer.SerializeToUtf8Bytes(geoJsonObj, new JsonSerializerOptions { WriteIndented = true });
        }

        // =========================================================================
        // 6. HELPER ROUTINES & SQL INFERENCE
        // =========================================================================

        /// <summary>
        /// Infers appropriate SQL column data types by inspecting row values.
        /// </summary>
        private static string InferSqlType(List<Dictionary<string, object?>> rows, string colName)
        {
            bool hasValues = false;
            bool isAllInt = true;
            bool isAllNumeric = true;
            bool isAllBool = true;
            int maxLen = 0;

            foreach (var row in rows)
            {
                if (!row.TryGetValue(colName, out var val) || val == null) continue;

                hasValues = true;
                string strVal = val.ToString() ?? "";
                if (strVal.Length > maxLen) maxLen = strVal.Length;

                if (val is bool)
                {
                    isAllInt = false;
                    isAllNumeric = false;
                }
                else if (val is int || val is long)
                {
                    isAllBool = false;
                }
                else if (val is double || val is float || val is decimal)
                {
                    isAllInt = false;
                    isAllBool = false;
                }
                else
                {
                    isAllInt = false;
                    isAllNumeric = false;
                    isAllBool = false;
                }
            }

            if (!hasValues) return "NVARCHAR(255) NULL";
            if (isAllBool) return "BIT NULL";
            if (isAllInt) return "BIGINT NULL";
            if (isAllNumeric) return "FLOAT NULL";
            if (maxLen > 4000) return "NVARCHAR(MAX) NULL";
            return $"NVARCHAR({Math.Max(50, Math.Min(maxLen * 2, 4000))}) NULL";
        }

        /// <summary>
        /// Formats and escapes individual values for SQL INSERT statements.
        /// </summary>
        private static string FormatSqlValue(object? val)
        {
            if (val == null) return "NULL";
            if (val is bool b) return b ? "1" : "0";
            if (val is int || val is long || val is double || val is float || val is decimal)
            {
                return Convert.ToString(val, CultureInfo.InvariantCulture) ?? "0";
            }
            string str = val.ToString() ?? "";
            return $"N'{str.Replace("'", "''")}'";
        }

        /// <summary>
        /// Sanitizes sheet names for Excel compatibility (max 31 chars, no special symbols).
        /// </summary>
        private static string SanitizeSheetName(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "GeoData";
            string clean = Path.GetFileNameWithoutExtension(name);
            clean = Regex.Replace(clean, @"[\\/*?:\[\]']", "_").Trim();
            if (string.IsNullOrWhiteSpace(clean)) return "GeoData";
            return clean.Length > 31 ? clean.Substring(0, 31) : clean;
        }

        /// <summary>
        /// Sanitizes database/column identifiers.
        /// </summary>
        private static string SanitizeIdentifier(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return "Col";
            string clean = Regex.Replace(name, @"[^a-zA-Z0-9_]", "_");
            if (char.IsDigit(clean[0])) clean = "_" + clean;
            return clean;
        }
    }
}
