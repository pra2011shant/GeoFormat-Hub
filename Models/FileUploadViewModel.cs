using Microsoft.AspNetCore.Http;
using System.ComponentModel.DataAnnotations;

namespace GeoFormat_Hub.Models
{
    /// <summary>
    /// ViewModel for file upload form handling and server-side validation feedback.
    /// Operates entirely in memory without requiring database storage.
    /// </summary>
    public class FileUploadViewModel
    {
        /// <summary>Uploaded file object from multipart form</summary>
        [Required(ErrorMessage = "Please select a JSON or GeoJSON file.")]
        [Display(Name = "Geospatial File (.json, .geojson)")]
        public IFormFile? GeoFile { get; set; }

        /// <summary>Source file name</summary>
        public string? FileName { get; set; }

        /// <summary>Size of file in bytes</summary>
        public long? FileSizeBytes { get; set; }

        /// <summary>Raw text content of the uploaded file</summary>
        public string? FileContent { get; set; }

        /// <summary>Feedback or error message to display in UI</summary>
        public string? StatusMessage { get; set; }

        /// <summary>Status flag indicating whether processing succeeded</summary>
        public bool IsSuccess { get; set; }

        /// <summary>Type of spatial dataset detected</summary>
        public string? DetectedType { get; set; }

        /// <summary>Total features or records count</summary>
        public int FeatureCount { get; set; }

        /// <summary>Unique in-memory cache identifier for fast downloads</summary>
        public string? DatasetId { get; set; }

        /// <summary>Truncated formatted preview of the JSON content for safe DOM rendering</summary>
        public string? JsonPreview { get; set; }

        /// <summary>Parsed in-memory dataset representation</summary>
        public GeoDataset? Dataset { get; set; }
    }
}
