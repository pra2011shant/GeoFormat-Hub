namespace GeoFormat_Hub.Models
{
    /// <summary>
    /// Represents structured in-memory representation of parsed JSON / GeoJSON data.
    /// No database is required - all data is processed on-the-fly in memory.
    /// </summary>
    public class GeoDataset
    {
        /// <summary>Unique in-memory cache identifier for fast downloads</summary>
        public string DatasetId { get; set; } = string.Empty;

        /// <summary>Name of the uploaded source file</summary>
        public string FileName { get; set; } = string.Empty;

        /// <summary>Detected GeoJSON / JSON type (e.g. FeatureCollection, Feature, JSON Array)</summary>
        public string DetectedType { get; set; } = "Unknown";

        /// <summary>List of discovered column/attribute names</summary>
        public List<string> Columns { get; set; } = new();

        /// <summary>Rows of data containing attribute values</summary>
        public List<Dictionary<string, object?>> Rows { get; set; } = new();

        /// <summary>Original raw JSON string used for Leaflet map rendering & exports (optional)</summary>
        public string RawJson { get; set; } = string.Empty;

        /// <summary>Truncated formatted preview of the JSON content for safe DOM rendering</summary>
        public string JsonPreview { get; set; } = string.Empty;

        /// <summary>Total number of parsed features or records</summary>
        public int TotalRecords => Rows.Count;

        /// <summary>Summary of geometry types found in the dataset (e.g. Point (10), Polygon (2))</summary>
        public string GeometryTypeSummary { get; set; } = string.Empty;

        /// <summary>Indicates whether valid spatial geometry was detected</summary>
        public bool HasGeometry { get; set; }
    }

    /// <summary>
    /// Request model for converting and exporting dataset to chosen file format.
    /// </summary>
    public class ExportRequestModel
    {
        /// <summary>Unique cache key for retrieving parsed dataset from memory</summary>
        public string? DatasetId { get; set; }

        /// <summary>Target export format: 'xlsx', 'csv', 'sql', 'xml'</summary>
        public string Format { get; set; } = "xlsx";

        /// <summary>Desired file name for download</summary>
        public string FileName { get; set; } = "converted_geodata";

        /// <summary>Fallback raw JSON content if cache missed or client generated</summary>
        public string? RawJson { get; set; }

        /// <summary>Custom table name (used only when exporting to SQL)</summary>
        public string TableName { get; set; } = "GeoData";
    }
}
