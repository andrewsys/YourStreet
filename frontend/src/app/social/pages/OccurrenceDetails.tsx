import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, Heart, MapPin, MessageCircle, Send, Share2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import occurrenceService, { OccurrenceComment, OccurrenceDetails as OccurrenceDetailsType } from "../../../services/OccurrenceService";

const typeLabel: Record<string, string> = {
  buraco: "Buraco",
  alagamento: "Alagamento",
  acidente: "Acidente",
};

const statusLabels = {
  pending: { label: "Pendente", color: "bg-amber-500" },
  archived: { label: "Arquivada", color: "bg-slate-600" },
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getInitials(name?: string): string {
  if (!name) return "US";
  const chunks = name.split(" ").filter(Boolean);
  if (chunks.length === 1) return chunks[0].slice(0, 2).toUpperCase();
  return `${chunks[0][0]}${chunks[chunks.length - 1][0]}`.toUpperCase();
}

export function OccurrenceDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [occurrence, setOccurrence] = useState<OccurrenceDetailsType | null>(null);
  const [comments, setComments] = useState<Array<OccurrenceComment>>([]);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [actionsLoading, setActionsLoading] = useState(false);

  const occurrenceId = id ? Number(id) : NaN;

  const loadOccurrence = async () => {
    if (!Number.isFinite(occurrenceId)) return;

    const [occurrenceData, commentsData] = await Promise.all([
      occurrenceService.getById(occurrenceId, { includeArchived: true }),
      occurrenceService.getComments(occurrenceId, { includeArchived: true }),
    ]);

    setOccurrence(occurrenceData);
    setComments(commentsData);
  };

  useEffect(() => {
    (async () => {
      if (!Number.isFinite(occurrenceId)) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        await loadOccurrence();
      } catch (error) {
        console.error(error);
        toast.error(getErrorMessage(error, "Nao foi possivel carregar a ocorrencia"));
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleLike = async () => {
    if (!occurrence) return;
    if (occurrence.archivedAt) return;

    try {
      setActionsLoading(true);
      await occurrenceService.toggleLike(occurrence.id);
      await loadOccurrence();
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Nao foi possivel curtir a ocorrencia"));
    } finally {
      setActionsLoading(false);
    }
  };

  const handleShare = async () => {
    if (!occurrence) return;

    const shareData = {
      title: typeLabel[occurrence.type] || occurrence.type,
      text: occurrence.description || "Ocorrencia no YourStreet",
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success("Link copiado para a area de transferencia");
      }
    } catch {
      // Ignore cancel from native share dialog.
    }
  };

  const handleVote = async (solved: boolean) => {
    if (!occurrence) return;
    if (occurrence.archivedAt) return;

    try {
      setActionsLoading(true);
      await occurrenceService.vote(occurrence.id, solved);
      await loadOccurrence();
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Nao foi possivel votar na ocorrencia"));
    } finally {
      setActionsLoading(false);
    }
  };

  const handleAddComment = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!occurrence || !commentText.trim() || occurrence.archivedAt) return;

    try {
      setSubmittingComment(true);
      await occurrenceService.addComment(occurrence.id, commentText.trim());
      setCommentText("");
      await loadOccurrence();
      toast.success("Comentario adicionado");
    } catch (error) {
      console.error(error);
      toast.error(getErrorMessage(error, "Nao foi possivel adicionar comentario"));
    } finally {
      setSubmittingComment(false);
    }
  };

  if (loading) {
    return (
      <div className="h-[calc(100vh-3.5rem-4rem)] flex items-center justify-center">
        <p className="text-muted-foreground">Carregando ocorrencia...</p>
      </div>
    );
  }

  if (!occurrence) {
    return (
      <div className="h-[calc(100vh-3.5rem-4rem)] flex items-center justify-center">
        <p className="text-muted-foreground">Ocorrencia nao encontrada</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-3.5rem-4rem)] overflow-y-auto pb-6">
      <div className="max-w-md mx-auto">
        <div className="sticky top-0 bg-background z-10 border-b border-border px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
            Voltar
          </button>
        </div>

        {occurrence.imageBase64 && (
          <div className="w-full aspect-video overflow-hidden">
            <img src={occurrence.imageBase64} alt={occurrence.type} className="w-full h-full object-cover" />
          </div>
        )}

        <div className="px-4 pt-4">
          <div className="mb-3 flex flex-col gap-2">
            <div className="flex items-center gap-2">
            {occurrence.archivedAt ? (
              <span className={`${statusLabels.archived.color} text-white text-xs px-3 py-1 rounded-full inline-block`}>
                {statusLabels.archived.label}
              </span>
            ) : (
              <span className={`${statusLabels.pending.color} text-white text-xs px-3 py-1 rounded-full inline-block`}>
                {statusLabels.pending.label}
              </span>
            )}
            {occurrence.archivedAt && (
              <span className="text-xs text-muted-foreground">
                Esta ocorrencia foi arquivada por inatividade.
              </span>
            )}
            </div>
            {occurrence.archivedAt && (
              <span className="text-xs text-muted-foreground">
                Arquivada em {formatDate(occurrence.archivedAt)}
              </span>
            )}
          </div>

          <h1 className="text-2xl font-semibold mb-3">{typeLabel[occurrence.type] || occurrence.type}</h1>

          <div className="flex items-center gap-1 text-sm text-muted-foreground mb-2">
            <MapPin className="h-4 w-4" />
            <span>{occurrence.address || "Endereco nao informado"}</span>
          </div>
          <p className="text-sm text-muted-foreground mb-4">{formatDate(occurrence.createdAt)}</p>

          <div className="mb-6">
            <h3 className="font-semibold mb-2">Descricao</h3>
            <p className="text-muted-foreground leading-relaxed">{occurrence.description || "Sem descricao informada."}</p>
          </div>

          <p className="font-semibold text-sm mb-3">
            Votos: {occurrence.solvedVotesCount} dizem que foi solucionada, {occurrence.unsolvedVotesCount} dizem que nao foi.
          </p>

          {!occurrence.archivedAt && (
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => handleVote(true)}
                disabled={actionsLoading}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  occurrence.currentUserVote === true ? "border-emerald-500 text-emerald-600 bg-emerald-50" : "border-border"
                }`}
              >
                <CheckCircle2 className="h-4 w-4" />
                Resolvida ({occurrence.solvedVotesCount})
              </button>
              <button
                onClick={() => handleVote(false)}
                disabled={actionsLoading}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  occurrence.currentUserVote === false ? "border-rose-500 text-rose-600 bg-rose-50" : "border-border"
                }`}
              >
                <XCircle className="h-4 w-4" />
                Nao resolvida ({occurrence.unsolvedVotesCount})
              </button>
            </div>
          )}

          <div className="flex items-center gap-6 py-4 border-y border-border mb-6">
            <button
              onClick={handleLike}
              disabled={actionsLoading || Boolean(occurrence.archivedAt)}
              className={`flex items-center gap-2 hover:text-amber-600 transition-colors ${occurrence.likedByCurrentUser ? "text-amber-600" : ""}`}
            >
              <Heart className={`h-5 w-5 ${occurrence.likedByCurrentUser ? "fill-current" : ""}`} />
              <span className="text-sm font-medium">{occurrence.likesCount}</span>
            </button>

            <div className="flex items-center gap-2 text-muted-foreground">
              <MessageCircle className="h-5 w-5" />
              <span className="text-sm font-medium">{comments.length}</span>
            </div>

            <button
              onClick={handleShare}
              className="flex items-center gap-2 hover:text-primary transition-colors ml-auto"
            >
              <Share2 className="h-5 w-5" />
              <span className="text-sm font-medium">Compartilhar</span>
            </button>
          </div>

          <div className="mb-6">
            <h3 className="font-semibold mb-4">Comentarios ({comments.length})</h3>

            <form onSubmit={handleAddComment} className="mb-6">
              <div className="flex gap-2">
                <div className="h-9 w-9 flex-shrink-0 rounded-full bg-primary text-primary-foreground text-xs grid place-items-center font-semibold">
                  VC
                </div>
                <div className="flex-1 flex gap-2">
                  <Input
                    type="text"
                    placeholder={occurrence.archivedAt ? "Ocorrencia arquivada - comentarios desativados" : "Adicione um comentario..."}
                    value={commentText}
                    onChange={(event) => setCommentText(event.target.value)}
                    className="flex-1"
                    disabled={Boolean(occurrence.archivedAt)}
                  />
                  <button
                    type="submit"
                    disabled={!commentText.trim() || submittingComment || Boolean(occurrence.archivedAt)}
                    className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </form>

            <div className="space-y-4">
              {comments.length === 0 ? (
                <p className="text-center text-muted-foreground text-sm py-8">
                  Nenhum comentario ainda. Seja o primeiro a comentar!
                </p>
              ) : (
                comments.map((comment) => (
                  <Card key={comment.id}>
                    <CardContent className="p-4">
                      <div className="flex gap-3">
                        <div className="h-9 w-9 flex-shrink-0 rounded-full bg-muted text-sm grid place-items-center font-medium">
                          {getInitials(comment.user?.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="font-semibold text-sm">{comment.user?.name || "Usuario"}</span>
                            <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed">{comment.text}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
