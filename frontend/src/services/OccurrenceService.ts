import { apiFetch } from "./api";

async function readErrorMessage(response: Response, fallback: string): Promise<Error> {
  let message = fallback;

  try {
    const text = await response.text();
    if (text) {
      message = text;
    }
  } catch {
    // Keep fallback when body cannot be read.
  }

  if (response.status === 401) {
    message = "Sessao expirada. Faça login novamente.";
  }

  return new Error(message);
}


export interface OccurrenceSummary {
  id: number;
  userId: number;
  type: string;
  description: string | null;
  address: string | null;
  createdAt: string;
  imageBase64: string | null;
  likesCount: number;
  favoritesCount: number;
  commentsCount: number;
  likedByCurrentUser: boolean;
  favoritedByCurrentUser: boolean;
}

export interface OccurrenceComment {
  id: number;
  userId: number;
  text: string;
  createdAt: string;
  user?: {
    id: number;
    name: string;
    email: string;
    picture?: string | null;
  };
}

export interface OccurrenceDetails extends Omit<OccurrenceSummary, "commentsCount"> {
  comments: Array<OccurrenceComment>;
}

export interface CreateOccurrencePayload {
  description: string;
  address: string;
  imageBase64?: string | null;
}

class OccurrenceService {
  async list(): Promise<Array<OccurrenceSummary>> {
    const response = await apiFetch("/occurrences");
    if (!response.ok) throw await readErrorMessage(response, "Falha ao carregar ocorrencias");
    return response.json();
  }

  async getById(id: number): Promise<OccurrenceDetails> {
    const response = await apiFetch(`/occurrences/${id}`);
    if (!response.ok) throw await readErrorMessage(response, "Falha ao carregar ocorrencia");
    return response.json();
  }

  async create(payload: CreateOccurrencePayload): Promise<{ id: number }> {
    const response = await apiFetch("/occurrences", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!response.ok) throw await readErrorMessage(response, "Falha ao criar ocorrencia");

    return response.json();
  }

  async toggleLike(id: number): Promise<void> {
    const response = await apiFetch(`/occurrences/${id}/like`, {
      method: "POST",
    });

    if (!response.ok) throw await readErrorMessage(response, "Falha ao curtir ocorrencia");
  }

  async toggleFavorite(id: number): Promise<void> {
    const response = await apiFetch(`/occurrences/${id}/favorite`, {
      method: "POST",
    });

    if (!response.ok) throw await readErrorMessage(response, "Falha ao favoritar ocorrencia");
  }

  async getComments(id: number): Promise<Array<OccurrenceComment>> {
    const response = await apiFetch(`/occurrences/${id}/comments`);
    if (!response.ok) throw await readErrorMessage(response, "Falha ao carregar comentarios");
    return response.json();
  }

  async addComment(id: number, text: string): Promise<void> {
    const response = await apiFetch(`/occurrences/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });

    if (!response.ok) throw await readErrorMessage(response, "Falha ao adicionar comentario");
  }

  async delete(id: number): Promise<void> {
    const response = await apiFetch(`/occurrences/${id}`, {
      method: "DELETE",
    });

    if (!response.ok) throw await readErrorMessage(response, "Falha ao excluir ocorrencia");
  }
}

export default new OccurrenceService();
