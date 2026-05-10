using Microsoft.EntityFrameworkCore;
using your_street_server.Data;
using DotNetEnv;

// Carregar variáveis de ambiente do arquivo .env (se existir)
if (File.Exists(".env"))
{
    Env.Load();
}

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.
builder.Services.AddControllers();

builder.Services.AddHttpClient("GoogleAi", client =>
{
    client.BaseAddress = new Uri("https://generativelanguage.googleapis.com/");
    client.Timeout = TimeSpan.FromSeconds(15);
});

// Swagger / OpenAPI (Swashbuckle)
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new Microsoft.OpenApi.Models.OpenApiInfo { Title = "YourStreet API", Version = "v1" });
});

// Configurar Entity Framework com PostgreSQL
var dbConnectionString = Environment.GetEnvironmentVariable("CONNECTION_STRING")
    ?? builder.Configuration.GetConnectionString("DefaultConnection")
    ?? throw new InvalidOperationException("Connection string nao configurada. Defina CONNECTION_STRING ou ConnectionStrings:DefaultConnection.");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseNpgsql(dbConnectionString));

// Configurar cache para sessões
builder.Services.AddDistributedMemoryCache();

// Configurar sessões
builder.Services.AddSession(options =>
{
    options.Cookie.Name = ".YourStreet.Session";
    options.IdleTimeout = TimeSpan.FromMinutes(30);
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;

    if (builder.Environment.IsDevelopment())
    {
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    }
    else
    {
        // Required for cross-site cookies when frontend/backend are on different domains.
        options.Cookie.SameSite = SameSiteMode.None;
        options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
    }
});

// Configurar CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(builder =>
    {
        var corsOrigin = Environment.GetEnvironmentVariable("CORS_ORIGIN") ?? "http://localhost:5173";
        var allowedOrigins = corsOrigin
            .Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(o => o.Trim().TrimEnd('/'))
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        // Keep localhost origins for local development while honoring production env origins.
        allowedOrigins.Add("http://localhost:5173");
        allowedOrigins.Add("https://localhost:5173");
        allowedOrigins.Add("http://127.0.0.1:5173");
        allowedOrigins.Add("https://127.0.0.1:5173");

        builder.WithOrigins(allowedOrigins.ToArray())
               .AllowAnyMethod()
               .AllowAnyHeader()
               .AllowCredentials();
    });
});

// Learn more about configuring OpenAPI at https://aka.ms/aspnet/openapi
builder.Services.AddOpenApi();

// Adicionar health checks
builder.Services.AddHealthChecks();

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "YourStreet API V1");
    });

    app.MapOpenApi();
    app.UseDeveloperExceptionPage();
}
else
{
    app.UseHttpsRedirection();
}

// Aplicar CORS
app.UseCors();

// Usar sessões (deve vir antes da autorização)
app.UseSession();

app.UseAuthorization();

app.MapControllers();

// Mapear health checks
app.MapHealthChecks("/health");

// Aplicar migrações automaticamente durante o desenvolvimento
if (app.Environment.IsDevelopment())
{
    using (var scope = app.Services.CreateScope())
    {
        var context = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        context.Database.Migrate();
    }
}

app.Run();
