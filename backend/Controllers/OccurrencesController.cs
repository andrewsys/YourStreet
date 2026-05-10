using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Json;
using System.Text.Json;
using your_street_server.Data;
using your_street_server.Models;

namespace your_street_server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class OccurrencesController : ControllerBase
{
    private readonly AppDbContext _context;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<OccurrencesController> _logger;
    private readonly string? _googleAiApiKey;
    private const string GeminiModel = "gemini-2.5-flash";

    public OccurrencesController(
        AppDbContext context,
        IHttpClientFactory httpClientFactory,
        ILogger<OccurrencesController> logger)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
        _googleAiApiKey = Environment.GetEnvironmentVariable("GEMINI_API_KEY")
            ?? Environment.GetEnvironmentVariable("GOOGLE_AI_API_KEY");
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateOccurrenceDto dto)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var userId))
            return Unauthorized("Usuário não autenticado");

        var generatedType = await GenerateTypeAsync(dto);
        if (string.IsNullOrWhiteSpace(generatedType))
            return StatusCode(StatusCodes.Status502BadGateway, "Falha ao categorizar ocorrência pela IA");

        var occ = new Occurrence
        {
            UserId = userId,
            Type = generatedType,
            Description = dto.Description,
            Address = dto.Address,
            ImageBase64 = dto.ImageBase64,
            CreatedAt = DateTime.UtcNow
        };

        _context.Occurrences.Add(occ);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = occ.Id }, new { id = occ.Id });
    }

    [HttpGet]
    public async Task<IActionResult> List()
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        int? userId = null;
        if (int.TryParse(userIdStr, out var uid)) userId = uid;

        var list = await _context.Occurrences
            .Include(o => o.Comments)
            .Include(o => o.Likes)
            .Include(o => o.Favorites)
            .OrderByDescending(o => o.CreatedAt)
            .Select(o => new
            {
                id = o.Id,
                userId = o.UserId,
                type = o.Type,
                description = o.Description,
                address = o.Address,
                createdAt = o.CreatedAt,
                imageBase64 = o.ImageBase64,
                likesCount = o.Likes.Count,
                favoritesCount = o.Favorites.Count,
                commentsCount = o.Comments.Count,
                likedByCurrentUser = userId.HasValue && o.Likes.Any(l => l.UserId == userId.Value),
                favoritedByCurrentUser = userId.HasValue && o.Favorites.Any(f => f.UserId == userId.Value)
            })
            .ToListAsync();

        return Ok(list);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(int id)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        int? userId = null;
        if (int.TryParse(userIdStr, out var uid)) userId = uid;

        var occ = await _context.Occurrences
            .Include(o => o.Comments).ThenInclude(c => c.User)
            .Include(o => o.Likes)
            .Include(o => o.Favorites)
            .FirstOrDefaultAsync(o => o.Id == id);

        if (occ == null) return NotFound();

        return Ok(new
        {
            id = occ.Id,
            userId = occ.UserId,
            type = occ.Type,
            description = occ.Description,
            address = occ.Address,
            createdAt = occ.CreatedAt,
            imageBase64 = occ.ImageBase64,
            likesCount = occ.Likes.Count,
            favoritesCount = occ.Favorites.Count,
            comments = occ.Comments.Select(c => new { id = c.Id, userId = c.UserId, text = c.Text, createdAt = c.CreatedAt }),
            likedByCurrentUser = userId.HasValue && occ.Likes.Any(l => l.UserId == userId.Value),
            favoritedByCurrentUser = userId.HasValue && occ.Favorites.Any(f => f.UserId == userId.Value)
        });
    }

    [HttpPost("{id}/like")]
    public async Task<IActionResult> ToggleLike(int id)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var userId))
            return Unauthorized("Usuário não autenticado");

        var occ = await _context.Occurrences.FindAsync(id);
        if (occ == null) return NotFound();

        var existing = await _context.OccurrenceLikes.FirstOrDefaultAsync(l => l.OccurrenceId == id && l.UserId == userId);
        if (existing == null)
        {
            _context.OccurrenceLikes.Add(new OccurrenceLike { OccurrenceId = id, UserId = userId });
        }
        else
        {
            _context.OccurrenceLikes.Remove(existing);
        }

        await _context.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{id}/favorite")]
    public async Task<IActionResult> ToggleFavorite(int id)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var userId))
            return Unauthorized("Usuário não autenticado");

        var occ = await _context.Occurrences.FindAsync(id);
        if (occ == null) return NotFound();

        var existing = await _context.OccurrenceFavorites.FirstOrDefaultAsync(f => f.OccurrenceId == id && f.UserId == userId);
        if (existing == null)
        {
            _context.OccurrenceFavorites.Add(new OccurrenceFavorite { OccurrenceId = id, UserId = userId });
        }
        else
        {
            _context.OccurrenceFavorites.Remove(existing);
        }

        await _context.SaveChangesAsync();
        return Ok();
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var userId))
            return Unauthorized("Usuário não autenticado");

        var occ = await _context.Occurrences.FirstOrDefaultAsync(o => o.Id == id);
        if (occ == null) return NotFound("Ocorrência não encontrada");
        if (occ.UserId != userId) return Forbid();

        _context.Occurrences.Remove(occ);
        await _context.SaveChangesAsync();

        return NoContent();
    }

    [HttpGet("{id}/comments")]
    public async Task<IActionResult> GetComments(int id)
    {
        var occ = await _context.Occurrences.FindAsync(id);
        if (occ == null) return NotFound("Ocorrência não encontrada");

        var comments = await _context.OccurrenceComments
            .Include(c => c.User)
            .Where(c => c.OccurrenceId == id)
            .OrderBy(c => c.CreatedAt)
            .Select(c => new
            {
                id = c.Id,
                userId = c.UserId,
                text = c.Text,
                createdAt = c.CreatedAt,
                user = new
                {
                    id = c.User != null ? c.User.Id : 0,
                    name = c.User != null ? c.User.Name : string.Empty,
                    email = c.User != null ? c.User.Email : string.Empty,
                    picture = c.User != null ? c.User.Picture : null
                }
            })
            .ToListAsync();

        return Ok(comments);
    }

    [HttpPost("{id}/comments")]
    public async Task<IActionResult> AddComment(int id, [FromBody] CreateCommentDto dto)
    {
        var userIdStr = HttpContext.Session.GetString("user_id");
        if (string.IsNullOrEmpty(userIdStr) || !int.TryParse(userIdStr, out var userId))
            return Unauthorized("Usuário não autenticado");

        var occ = await _context.Occurrences.FindAsync(id);
        if (occ == null) return NotFound();

        if (string.IsNullOrWhiteSpace(dto.Text)) return BadRequest("Comentário vazio");

        var comment = new OccurrenceComment { OccurrenceId = id, UserId = userId, Text = dto.Text, CreatedAt = DateTime.UtcNow };
        _context.OccurrenceComments.Add(comment);
        await _context.SaveChangesAsync();

        return CreatedAtAction(nameof(GetById), new { id = id }, new { commentId = comment.Id });
    }

    // DTOs
    public class CreateOccurrenceDto
    {
        public string Type { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? Address { get; set; }
        public string? ImageBase64 { get; set; }
    }

    public class CreateCommentDto
    {
        public string Text { get; set; } = string.Empty;
    }

    private async Task<string?> GenerateTypeAsync(CreateOccurrenceDto dto)
    {
        if (string.IsNullOrWhiteSpace(_googleAiApiKey))
            return null;

        var description = dto.Description?.Trim();
        var address = dto.Address?.Trim();

        var prompt =
            "Classifique ocorrencias urbanas. Gere um tipo curto (ate 50 caracteres). " +
            "Responda apenas com o tipo, sem aspas, sem lista e sem pontuacao extra. " +
            "Nao responda 'desconhecido' nem 'outros'. " +
            $"Descricao: {description ?? "(vazio)"}. Endereco: {address ?? "(vazio)"}.";

        var payload = new
        {
            contents = new[]
            {
                new
                {
                    parts = new[] { new { text = prompt } }
                }
            },
            generationConfig = new { temperature = 0.2, maxOutputTokens = 1000, responseMimeType = "text/plain" }
        };

        var result = await CallGeminiAsync(payload, description, address);
        if (string.IsNullOrWhiteSpace(result))
        {
            var retryPrompt =
                "Gere um tipo curto e descritivo (ate 50 caracteres) para a ocorrencia urbana abaixo. " +
                "Responda apenas com o tipo, sem pontuacao extra. Nao responda 'desconhecido' nem 'outros'. " +
                $"Descricao: {description ?? "(vazio)"}. Endereco: {address ?? "(vazio)"}.";

            var retryPayload = new
            {
                contents = new[] { new { parts = new[] { new { text = retryPrompt } } } },
                generationConfig = new { temperature = 0.2, maxOutputTokens = 1000, responseMimeType = "text/plain" }
            };

            result = await CallGeminiAsync(retryPayload, description, address);
        }

        if (string.IsNullOrWhiteSpace(result))
            return null;

        var normalized = result
            .Replace("\r", " ")
            .Replace("\n", " ")
            .Replace("\"", string.Empty)
            .Trim();

        if (string.IsNullOrWhiteSpace(normalized))
            return null;

        if (normalized.Length > 50)
            normalized = normalized[..50];

        return normalized.ToLowerInvariant();
    }

    private async Task<string?> CallGeminiAsync(object payload, string? description, string? address)
    {
        var client = _httpClientFactory.CreateClient("GoogleAi");
        HttpResponseMessage response;
        using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(12));

        try
        {
            response = await client.PostAsJsonAsync(
                $"v1beta/models/{GeminiModel}:generateContent?key={_googleAiApiKey}",
                payload,
                timeoutCts.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Gemini request failed.");
            return null;
        }

        var body = await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning(
                "Gemini request failed with status {StatusCode}. Body: {Body}",
                response.StatusCode,
                body);
            return null;
        }

        using var doc = JsonDocument.Parse(body);
        string? text = null;
        string? finishReason = null;
        if (doc.RootElement.TryGetProperty("candidates", out var candidates) && candidates.GetArrayLength() > 0)
        {
            var candidate = candidates[0];
            if (candidate.TryGetProperty("finishReason", out var finishReasonElement))
                finishReason = finishReasonElement.GetString();

            if (candidate.TryGetProperty("content", out var content) &&
                content.TryGetProperty("parts", out var parts) &&
                parts.GetArrayLength() > 0 &&
                parts[0].TryGetProperty("text", out var textElement))
            {
                text = textElement.GetString();
            }
        }

        if (string.IsNullOrWhiteSpace(text))
        {
            _logger.LogWarning(
                "Gemini returned empty text. FinishReason: {FinishReason}. Description length: {DescriptionLength}, Address length: {AddressLength}. Body: {Body}",
                finishReason ?? "(null)",
                description?.Length ?? 0,
                address?.Length ?? 0,
                body);
        }

        return text;
    }
}
