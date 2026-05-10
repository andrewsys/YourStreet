using System.ComponentModel.DataAnnotations;

namespace your_street_server.Models;

public class Occurrence
{
    public int Id { get; set; }

    // vinculada ao usuário que criou a ocorrência
    public int UserId { get; set; }
    public User? User { get; set; }

    // tipo: temporariamente "buraco", "alagamento", "Acidente"
    [Required]
    [MaxLength(50)]
    public string Type { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Description { get; set; }

    [MaxLength(500)]
    public string? Address { get; set; }

    // data de criação
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // ultima interacao (comentario, like ou voto)
    public DateTime LastInteractionAt { get; set; } = DateTime.UtcNow;

    // quando arquivada por inatividade
    public DateTime? ArchivedAt { get; set; }

    // imagem em base64
    public string? ImageBase64 { get; set; }

    public ICollection<OccurrenceLike> Likes { get; set; } = new List<OccurrenceLike>();
    public ICollection<OccurrenceFavorite> Favorites { get; set; } = new List<OccurrenceFavorite>();
    public ICollection<OccurrenceComment> Comments { get; set; } = new List<OccurrenceComment>();
    public ICollection<OccurrenceVote> Votes { get; set; } = new List<OccurrenceVote>();
}
