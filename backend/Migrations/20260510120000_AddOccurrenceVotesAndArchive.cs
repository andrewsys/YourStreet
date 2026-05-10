using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace your_street_server.Migrations
{
    public partial class AddOccurrenceVotesAndArchive : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"Occurrences\" ADD COLUMN IF NOT EXISTS \"ArchivedAt\" timestamp with time zone;");
            migrationBuilder.Sql("ALTER TABLE \"Occurrences\" ADD COLUMN IF NOT EXISTS \"LastInteractionAt\" timestamp with time zone NOT NULL DEFAULT (NOW());");

            migrationBuilder.CreateTable(
                name: "OccurrenceVotes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    OccurrenceId = table.Column<int>(type: "integer", nullable: false),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    Solved = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OccurrenceVotes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_OccurrenceVotes_Occurrences_OccurrenceId",
                        column: x => x.OccurrenceId,
                        principalTable: "Occurrences",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_OccurrenceVotes_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OccurrenceVotes_OccurrenceId_UserId",
                table: "OccurrenceVotes",
                columns: new[] { "OccurrenceId", "UserId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_OccurrenceVotes_UserId",
                table: "OccurrenceVotes",
                column: "UserId");

            migrationBuilder.Sql("UPDATE \"Occurrences\" SET \"LastInteractionAt\" = \"CreatedAt\";");
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "OccurrenceVotes");

            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                table: "Occurrences");

            migrationBuilder.DropColumn(
                name: "LastInteractionAt",
                table: "Occurrences");
        }
    }
}
