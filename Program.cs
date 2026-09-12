using GeoFormat_Hub.Services;

var builder = WebApplication.CreateBuilder(args);

// Configure Kestrel limits to allow large file uploads (unlimited request body size)
builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = null; // Unlimited request body
    options.Limits.MinRequestBodyDataRate = null; // Prevent slow connection drops during large uploads
});

// 1. Register MVC Controllers & Razor Views
builder.Services.AddControllersWithViews();

// 2. Register In-Memory Cache for fast dataset caching during export/conversions
builder.Services.AddMemoryCache();

// 3. Configure multipart form limits for handling large GeoJSON/JSON uploads (unlimited size, 64MB memory buffer)
builder.Services.Configure<Microsoft.AspNetCore.Http.Features.FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = long.MaxValue; // Unlimited multipart body
    options.ValueLengthLimit = int.MaxValue;
    options.MultipartHeadersLengthLimit = int.MaxValue;
    options.MemoryBufferThreshold = 67108864; // 64 MB buffer before streaming to temp disk
});

// 4. Register Core Geospatial Conversion Engine Service (In-memory, zero DB required)
builder.Services.AddScoped<IGeoDataService, GeoDataService>();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
    // The default HSTS value is 30 days. You may want to change this for production scenarios, see https://aka.ms/aspnetcore-hsts.
    app.UseHsts();
}

app.UseHttpsRedirection();
app.UseStaticFiles();

app.UseRouting();

app.UseAuthorization();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.Run();
