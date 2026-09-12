using GeoFormat_Hub.Models;

namespace GeoFormat_Hub.Services
{
    /// <summary>
    /// Contract for spatial data parsing, conversion, and multi-format exports.
    /// Operates fully in-memory with zero database dependencies.
    /// </summary>
    public interface IGeoDataService
    {
        /// <summary>Parses JSON / GeoJSON string into an in-memory structured dataset.</summary>
        GeoDataset ParseJson(string jsonContent, string fileName);

        /// <summary>Parses JSON / GeoJSON UTF-8 stream asynchronously into an in-memory structured dataset with low memory footprint.</summary>
        Task<GeoDataset> ParseJsonStreamAsync(Stream utf8Stream, string fileName, CancellationToken cancellationToken = default);

        /// <summary>Parses JSON / GeoJSON UTF-8 stream synchronously into an in-memory structured dataset.</summary>
        GeoDataset ParseJsonStream(Stream utf8Stream, string fileName);

        /// <summary>Converts dataset to a styled Excel (.xlsx) spreadsheet byte array using ClosedXML.</summary>
        byte[] ExportToExcel(GeoDataset dataset);

        /// <summary>Converts dataset to standard CSV (.csv) byte array using CsvHelper.</summary>
        byte[] ExportToCsv(GeoDataset dataset);

        /// <summary>Generates SQL CREATE TABLE and INSERT INTO script (.sql) using StringBuilder.</summary>
        byte[] ExportToSql(GeoDataset dataset, string tableName);

        /// <summary>Generates well-formed XML dataset (.xml) byte array.</summary>
        byte[] ExportToXml(GeoDataset dataset);

        /// <summary>Converts dataset to standard formatted JSON (.json) byte array.</summary>
        byte[] ExportToJson(GeoDataset dataset);

        /// <summary>Converts dataset to standard GeoJSON FeatureCollection (.geojson) byte array.</summary>
        byte[] ExportToGeoJson(GeoDataset dataset);
    }
}
