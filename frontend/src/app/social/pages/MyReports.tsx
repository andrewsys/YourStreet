import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, MapPin, MessageCircle, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Card, CardContent } from "../components/ui/card";
import occurrenceService, { OccurrenceSummary } from "../../../services/OccurrenceService";
import AuthService from "../../../services/AuthService";

const HERE_API_KEY = import.meta.env.VITE_HERE_API_KEY;

const typeLabel: Record<string, string> = {
  buraco: "Buraco",
  alagamento: "Alagamento",
  acidente: "Acidente",
};

type FilterMode = "nearby" | "my" | "all";
type SortMode = "likes" | "newest" | "oldest";

const statusLabels = {
  pending: { label: "Pendente", color: "bg-amber-500" },
  archived: { label: "Arquivada", color: "bg-slate-600" },
};

function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return earthRadiusKm * c;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDistance(value: number): string {
  if (value < 1) {
    return `${Math.round(value * 1000)} m`;
  }
  return `${value.toFixed(1)} km`;
}

async function getCurrentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocalização não suportada neste navegador"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000,
    });
  });
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

export function MyReports() {
  const [reports, setReports] = useState<Array<OccurrenceSummary>>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingNearby, setResolvingNearby] = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("nearby");
  const [sortMode, setSortMode] = useState<SortMode>("likes");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [distanceById, setDistanceById] = useState<Record<number, number | null>>({});

  const geocodeCacheRef = useRef<Map<string, [number, number] | null>>(new Map());

  const geocodeAddress = async (address: string): Promise<[number, number] | null> => {
    const normalized = address.trim().toLowerCase();
    if (!normalized) return null;

    const cached = geocodeCacheRef.current.get(normalized);
    if (cached !== undefined) {
      return cached;
    }

    try {
      if (!HERE_API_KEY) {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }

      const params = new URLSearchParams({
        q: address,
        limit: "1",
        lang: "pt-BR",
        in: "countryCode:BRA",
        apiKey: HERE_API_KEY,
      });

      const response = await fetch(`https://geocode.search.hereapi.com/v1/geocode?${params.toString()}`);

      if (!response.ok) {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }

      const data = (await response.json()) as {
        items?: Array<{
          position?: {
            lat: number;
            lng: number;
          };
        }>;
      };

      const firstItem = data.items?.[0];
      if (!firstItem?.position) {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }

      const lat = Number(firstItem.position.lat);
      const lng = Number(firstItem.position.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        geocodeCacheRef.current.set(normalized, null);
        return null;
      }

      const coordinates: [number, number] = [lat, lng];
      geocodeCacheRef.current.set(normalized, coordinates);
      return coordinates;
    } catch {
      geocodeCacheRef.current.set(normalized, null);
      return null;
    }
  };

  const loadReports = async () => {
    const authService = AuthService.getInstance();
    const user = authService.getCurrentUser() || (await authService.checkCurrentUser());
    setUserId(user ? Number(user.id) : null);

    const allReports = await occurrenceService.list({ includeArchived });
    setReports(allReports);
  };

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const position = await getCurrentPosition();
        if (!mounted) return;
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      } catch {
        if (!mounted) return;
        toast.warning("Não foi possível acessar sua localização. O filtro Próximas pode ficar vazio.");
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);

      try {
        await loadReports();
      } catch (error) {
        console.error(error);
        toast.error(getErrorMessage(error, "Não foi possível carregar suas ocorrências"));
      } finally {
        setLoading(false);
      }
    })();
  }, [includeArchived]);

  useEffect(() => {
    let mounted = true;

    const resolveDistances = async () => {
      if (!userLocation || reports.length === 0) {
        setDistanceById({});
        return;
      }

      setResolvingNearby(true);

      const pairs = await Promise.all(
        reports.map(async (report) => {
          const address = report.address?.trim() ?? "";
          if (!address) return [report.id, null] as const;

          const coordinates = await geocodeAddress(address);
          if (!coordinates) return [report.id, null] as const;

          const [lat, lng] = coordinates;
          const distance = haversineDistanceKm(userLocation.lat, userLocation.lng, lat, lng);
          return [report.id, distance] as const;
        }),
      );

      if (!mounted) return;

      const nextDistances: Record<number, number | null> = {};
      pairs.forEach(([id, distance]) => {
        nextDistances[id] = distance;
      });
      setDistanceById(nextDistances);
      setResolvingNearby(false);
    };

    void resolveDistances();

    return () => {
      mounted = false;
    };
  }, [reports, userLocation]);

  const processedReports = useMemo(() => {
    const byFilter = reports.filter((report) => {
      if (filterMode === "my") {
        return userId !== null && report.userId === userId;
      }

      if (filterMode === "nearby") {
        const distance = distanceById[report.id];
        return typeof distance === "number" && distance <= 16;
      }

      return true;
    });

    return [...byFilter].sort((a, b) => {
      if (sortMode === "likes") {
        return b.likesCount - a.likesCount;
      }

      const timestampA = new Date(a.createdAt).getTime();
      const timestampB = new Date(b.createdAt).getTime();

      if (sortMode === "newest") {
        return timestampB - timestampA;
      }

      return timestampA - timestampB;
    });
  }, [distanceById, filterMode, reports, sortMode, userId]);

  const handleDelete = async (id: number) => {
    if (confirm("Deseja realmente excluir esta ocorrência?")) {
      try {
        await occurrenceService.delete(id);
        setReports((prev) => prev.filter((report) => report.id !== id));
        setDistanceById((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        toast.success("Ocorrência excluída");
      } catch (error) {
        console.error(error);
        toast.error(getErrorMessage(error, "Não foi possível excluir a ocorrência"));
      }
    }
  };

  return (
    <div className="h-[calc(100vh-3.5rem-4rem)] overflow-y-auto pb-6">
      <div className="max-w-md mx-auto px-4 pt-6">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-2">Ocorrências</h2>
          <p className="text-muted-foreground text-sm">Fique sabendo de tudo o que acontece</p>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-2">
          <button
            onClick={() => setFilterMode("nearby")}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              filterMode === "nearby" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Próximas (16 km)
          </button>
          <button
            onClick={() => setFilterMode("my")}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              filterMode === "my" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Minhas ocorrências
          </button>
          <button
            onClick={() => setFilterMode("all")}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
              filterMode === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            Todas
          </button>
        </div>

        <div className="mb-6">
          <label htmlFor="sort-mode" className="block text-xs text-muted-foreground mb-1">
            Ordem
          </label>
          <select
            id="sort-mode"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="likes">Mais curtidas</option>
            <option value="newest">Mais recentes</option>
            <option value="oldest">Mais antigas</option>
          </select>
        </div>

        <label className="mb-6 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeArchived}
            onChange={(event) => setIncludeArchived(event.target.checked)}
          />
          Mostrar ocorrencias arquivadas
        </label>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Carregando ocorrências...</p>
          </div>
        ) : resolvingNearby && filterMode === "nearby" ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Calculando ocorrências próximas...</p>
          </div>
        ) : processedReports.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">
              {filterMode === "nearby"
                ? "Nenhuma ocorrência encontrada em até 16 km da sua localização"
                : filterMode === "my"
                  ? "Você ainda não criou nenhuma ocorrência"
                  : "Nenhuma ocorrência disponível"}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {processedReports.map((report) => (
              <Card key={report.id} className="overflow-hidden">
                <CardContent className="p-0 [&:last-child]:pb-0">
                  <Link to={`/ocorrencia/${report.id}`} className="w-full text-left block">
                    <div className="flex gap-3 p-3">
                      <div className="relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-muted">
                        {report.imageBase64 ? (
                          <img src={report.imageBase64} alt={report.type} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full grid place-items-center text-xs text-muted-foreground">Sem imagem</div>
                        )}
                        <div className="absolute top-1 right-1 flex flex-col gap-1 items-end">
                          {report.archivedAt ? (
                            <div className={`${statusLabels.archived.color} text-white text-xs px-2 py-0.5 rounded-full`}>
                              {statusLabels.archived.label}
                            </div>
                          ) : (
                            <div className={`${statusLabels.pending.color} text-white text-xs px-2 py-0.5 rounded-full`}>
                              {statusLabels.pending.label}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-semibold text-sm line-clamp-2">{typeLabel[report.type] || report.type}</h3>
                          <button
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              handleDelete(report.id);
                            }}
                            className="p-1.5 hover:bg-destructive/10 rounded-lg transition-colors shrink-0"
                            aria-label="Excluir ocorrência"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </button>
                        </div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{report.address || "Endereço não informado"}</span>
                        </div>
                        {filterMode === "nearby" && typeof distanceById[report.id] === "number" && (
                          <p className="text-xs text-primary mb-2">Aproximadamente {formatDistance(distanceById[report.id]!)} de você</p>
                        )}
                        <p className="text-xs text-muted-foreground mb-2">{formatDate(report.createdAt)}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Heart className="h-3.5 w-3.5" />
                            {report.likesCount}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {report.commentsCount}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>

                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
