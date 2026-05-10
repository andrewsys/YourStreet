namespace your_street_server.Models;

public class OccurrenceVote
{
    public int Id { get; set; }

    public int OccurrenceId { get; set; }
    public Occurrence? Occurrence { get; set; }

    public int UserId { get; set; }
    public User? User { get; set; }

    public bool Solved { get; set; }
}
