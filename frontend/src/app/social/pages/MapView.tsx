import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Locate } from "lucide-react";
import { toast } from "sonner";
import occurrenceService, { OccurrenceSummary } from "../../../services/OccurrenceService";

const defaultCenter: [number, number] = [-23.5505, -46.6333];

const typeLabel: Record<string, string> = {
  buraco: "Buraco",
  alagamento: "Alagamento",
  acidente: "Acidente",
};

type OccurrenceOnMap = OccurrenceSummary & {
  coordinates: [number, number];
};

const HERE_API_KEY = import.meta.env.VITE_HERE_API_KEY as string | undefined;
const LAST_LOCATION_STORAGE_KEY = "yourstreet.last-user-location";

let hereScriptLoader: Promise<void> | null = null;

function ensureHereScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existingScript = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existingScript) {
      if ((existingScript as HTMLScriptElement).dataset.loaded === "true") {
        resolve();
      } else {
        existingScript.addEventListener("load", () => resolve(), { once: true });
        existingScript.addEventListener("error", () => reject(new Error(`Falha ao carregar ${src}`)), { once: true });
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

function ensureHereStyles(): void {
  const href = "https://js.api.here.com/v3/3.1/mapsjs-ui.css";
  if (document.querySelector(`link[href="${href}"]`)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

async function loadHereMapsApi(): Promise<void> {
  if (hereScriptLoader) return hereScriptLoader;

  ensureHereStyles();

  hereScriptLoader = (async () => {
    await ensureHereScript("https://js.api.here.com/v3/3.1/mapsjs-core.js");
    await ensureHereScript("https://js.api.here.com/v3/3.1/mapsjs-service.js");
    await ensureHereScript("https://js.api.here.com/v3/3.1/mapsjs-mapevents.js");
    await ensureHereScript("https://js.api.here.com/v3/3.1/mapsjs-ui.js");
  })();

  return hereScriptLoader;
}

declare global {
  interface Window {
    H: any;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fallbackCoordinates(id: number, index: number): [number, number] {
  const ring = Math.floor(index / 10) + 1;
  const slot = index % 10;
  const angle = (slot / 10) * (Math.PI * 2);
  const radius = 0.002 * ring;

  const jitterLat = ((id % 23) - 11) * 0.0001;
  const jitterLng = ((id % 29) - 14) * 0.0001;

  return [
    defaultCenter[0] + Math.sin(angle) * radius + jitterLat,
    defaultCenter[1] + Math.cos(angle) * radius + jitterLng,
  ];
}

export function MapView() {
  const [occurrences, setOccurrences] = useState<Array<OccurrenceSummary>>([]);
  const [mapOccurrences, setMapOccurrences] = useState<Array<OccurrenceOnMap>>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingCoordinates, setResolvingCoordinates] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [initialGeoResolved, setInitialGeoResolved] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [geoDebug, setGeoDebug] = useState<string>("Aguardando geolocalização...");

  const mapRef = useRef<any | null>(null);
  const uiRef = useRef<any | null>(null);
  const markerGroupRef = useRef<any | null>(null);
  const userMarkerGroupRef = useRef<any | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const currentLocationRef = useRef<any | null>(null);
  const pendingLocationRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const recenterTimersRef = useRef<Array<number>>([]);
  const geocodeCacheRef = useRef<Map<string, [number, number] | null>>(new Map());

  const getCachedLocation = (): { lat: number; lng: number } | null => {
    try {
      const raw = window.localStorage.getItem(LAST_LOCATION_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { lat?: number; lng?: number };
      if (typeof parsed.lat === "number" && typeof parsed.lng === "number") {
        return { lat: parsed.lat, lng: parsed.lng };
      }
      return null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const cached = getCachedLocation();
    if (!cached) return;
    applyUserLocation(cached.lat, cached.lng);
    setGeoDebug(`Usando localização em cache: ${cached.lat.toFixed(6)}, ${cached.lng.toFixed(6)}`);
  }, []);

  const applyUserLocation = (lat: number, lng: number, zoom = 12) => {
    const time = new Date().toLocaleTimeString("pt-BR", { hour12: false });
    setUserLocation({ lat, lng });
    setGeoDebug(`[${time}] Localização aplicada: ${lat.toFixed(6)}, ${lng.toFixed(6)}`);

    try {
      window.localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify({ lat, lng }));
    } catch {
      // Ignore storage failures.
    }

    const centerMapOnUser = () => {
      const map = mapRef.current;
      if (!map) {
        pendingLocationRef.current = { lat, lng, zoom };
        return;
      }

      map.getViewPort?.().resize?.();
      map.getViewModel?.().setLookAtData?.({
        position: { lat, lng },
        zoom,
      }, false);
      map.setCenter({ lat, lng }, false);
      map.setZoom(zoom, false);
    };

    recenterTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    recenterTimersRef.current = [];

    centerMapOnUser();
    window.requestAnimationFrame(() => centerMapOnUser());
    recenterTimersRef.current.push(window.setTimeout(centerMapOnUser, 300));
    recenterTimersRef.current.push(window.setTimeout(centerMapOnUser, 900));

    if (userMarkerGroupRef.current) {
      if (currentLocationRef.current) {
        const objects = userMarkerGroupRef.current.getObjects?.() ?? [];
        if (objects.includes(currentLocationRef.current)) {
          userMarkerGroupRef.current.removeObject(currentLocationRef.current);
        }
        currentLocationRef.current = null;
      }

      const H = window.H;
      if (H?.map?.Marker) {
        const userMarker = new H.map.Marker({ lat, lng });
        userMarkerGroupRef.current.addObject(userMarker);
        currentLocationRef.current = userMarker;
      }
    }
  };

  const getCurrentPositionLikeCreate = (options?: PositionOptions): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
        ...options,
      });
    });
  };

  const getFreshWatchPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      const timeoutMs = 20000;
      let settled = false;

      const finishSuccess = (position: GeolocationPosition) => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timeoutId);
        resolve(position);
      };

      const finishError = (error: GeolocationPositionError) => {
        if (settled) return;
        settled = true;
        navigator.geolocation.clearWatch(watchId);
        window.clearTimeout(timeoutId);
        reject(error);
      };

      const watchId = navigator.geolocation.watchPosition(finishSuccess, finishError, {
        enableHighAccuracy: true,
        timeout: timeoutMs,
        maximumAge: 0,
      });

      const timeoutId = window.setTimeout(() => {
        finishError({ code: 3, message: "Tempo limite ao buscar localização.", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      }, timeoutMs + 1000);
    });
  };

  const requestUserLocation = async (
    showError: boolean,
    options?: { preferFresh?: boolean; allowCacheFallback?: boolean; zoom?: number },
  ): Promise<boolean> => {
    const preferFresh = options?.preferFresh ?? false;
    const allowCacheFallback = options?.allowCacheFallback ?? true;
    const zoom = options?.zoom ?? 12;

    if (!navigator.geolocation) {
      if (showError) {
        toast.error("Seu navegador não suporta geolocalização.");
      }
      return false;
    }

    setIsLocating(true);

    const parseGeoError = (error: unknown): string => {
      if (error && typeof error === "object" && "code" in error) {
        const code = (error as GeolocationPositionError).code;
        if (code === 1) return "Permissão negada para geolocalização.";
        if (code === 2) return "Posição indisponível no momento.";
        if (code === 3) return "Tempo limite ao buscar localização.";
      }
      if (error instanceof Error && error.message) {
        return error.message;
      }
      return "Falha ao obter localização.";
    };

    try {
      const position = preferFresh
        ? await getFreshWatchPosition()
        : await getCurrentPositionLikeCreate();

      applyUserLocation(position.coords.latitude, position.coords.longitude, zoom);
      return true;
    } catch (error) {
      const reason = parseGeoError(error);
      setGeoDebug(`Falha na geolocalização: ${reason}`);

      if (preferFresh) {
        try {
          const fallbackPosition = await getCurrentPositionLikeCreate({
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000,
          });
          applyUserLocation(fallbackPosition.coords.latitude, fallbackPosition.coords.longitude, zoom);
          return true;
        } catch {
          // Continue with cache/error flow below.
        }
      }

      const cached = allowCacheFallback ? getCachedLocation() : null;
      if (cached) {
        applyUserLocation(cached.lat, cached.lng, zoom);
        if (showError) {
          toast.warning(`Não foi possível obter GPS agora. Usando última localização salva. (${reason})`);
        }
        return true;
      }

      if (showError) {
        toast.error(`Não foi possível obter sua localização atual. ${reason}`);
      }
      return false;
    } finally {
      setIsLocating(false);
    }
  };

  const filteredOccurrences = useMemo(() => {
    return mapOccurrences;
  }, [mapOccurrences]);

  const fetchCoordinates = async (address: string): Promise<[number, number] | null> => {
    const normalized = address.trim().toLowerCase();
    if (!normalized) return null;

    if (geocodeCacheRef.current.has(normalized)) {
      return geocodeCacheRef.current.get(normalized) ?? null;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6000);

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

      const response = await fetch(`https://geocode.search.hereapi.com/v1/geocode?${params.toString()}`, {
        signal: controller.signal,
      });

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

      const coords: [number, number] = [lat, lng];
      geocodeCacheRef.current.set(normalized, coords);
      return coords;
    } catch {
      geocodeCacheRef.current.set(normalized, null);
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoading(true);
        const data = await occurrenceService.list();
        if (!mounted) return;
        setOccurrences(data);
      } catch (error) {
        console.error(error);
        toast.error("Nao foi possivel carregar as ocorrencias");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void run();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const resolveAllCoordinates = async () => {
      if (occurrences.length === 0) {
        setMapOccurrences([]);
        setResolvingCoordinates(false);
        return;
      }

      setResolvingCoordinates(true);

      try {
        const resolved: Array<OccurrenceOnMap> = [];

        for (let i = 0; i < occurrences.length; i += 1) {
          const occurrence = occurrences[i];
          const address = occurrence.address?.trim() ?? "";
          const coords = address ? await fetchCoordinates(address) : null;

          resolved.push({
            ...occurrence,
            coordinates: coords ?? fallbackCoordinates(occurrence.id, i),
          });
        }

        if (!mounted) return;
        setMapOccurrences(resolved);
      } finally {
        if (mounted) setResolvingCoordinates(false);
      }
    };

    void resolveAllCoordinates();

    return () => {
      mounted = false;
    };
  }, [occurrences]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;
    let resizeHandler: (() => void) | null = null;

    const initialize = async () => {
      if (!HERE_API_KEY) {
        toast.error("Defina VITE_HERE_API_KEY para usar o mapa HERE WeGo.");
        setGeoDebug("Mapa HERE sem API key.");
        return;
      }

      try {
        await loadHereMapsApi();
      } catch (error) {
        console.error(error);
        toast.error("Não foi possível carregar o mapa HERE WeGo.");
        setGeoDebug("Falha ao carregar scripts do HERE.");
        return;
      }

      if (!mounted || !mapContainerRef.current) return;

      const H = window.H;
      const platform = new H.service.Platform({ apikey: HERE_API_KEY });
      const defaultLayers = platform.createDefaultLayers();

      const map = new H.Map(mapContainerRef.current, defaultLayers.vector.normal.map, {
        center: { lat: defaultCenter[0], lng: defaultCenter[1] },
        zoom: 12,
        pixelRatio: window.devicePixelRatio || 1,
      });

      mapRef.current = map;

      const behavior = new H.mapevents.Behavior(new H.mapevents.MapEvents(map));
      void behavior;

      const ui = H.ui.UI.createDefault(map, defaultLayers);
      uiRef.current = ui;

      const markerGroup = new H.map.Group();
      map.addObject(markerGroup);
      markerGroupRef.current = markerGroup;

      const userMarkerGroup = new H.map.Group();
      map.addObject(userMarkerGroup);
      userMarkerGroupRef.current = userMarkerGroup;

      if (pendingLocationRef.current) {
        const pending = pendingLocationRef.current;
        pendingLocationRef.current = null;
        applyUserLocation(pending.lat, pending.lng, pending.zoom);
      }

      setMapReady(true);
      setGeoDebug((prev) => `${prev} | Mapa pronto`);

      resizeHandler = () => map.getViewPort().resize();
      window.addEventListener("resize", resizeHandler);

      resizeObserver = new ResizeObserver(() => map.getViewPort().resize());
      resizeObserver.observe(mapContainerRef.current);
    };

    void initialize();

    return () => {
      mounted = false;
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
      }
      recenterTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      recenterTimersRef.current = [];
      resizeObserver?.disconnect();
      mapRef.current?.dispose();
      mapRef.current = null;
      uiRef.current = null;
      markerGroupRef.current = null;
      userMarkerGroupRef.current = null;
      currentLocationRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    void requestUserLocation(false, { preferFresh: false, allowCacheFallback: true, zoom: 12 }).finally(() => {
      setInitialGeoResolved(true);
    });
  }, [mapReady]);

  useEffect(() => {
    if (!mapRef.current || !markerGroupRef.current) return;

    const H = window.H;
    const map = mapRef.current;
    const markerGroup = markerGroupRef.current;
    const ui = uiRef.current;

    markerGroup.removeAll();
    ui?.getBubbles?.().forEach((bubble: any) => ui.removeBubble(bubble));

    if (filteredOccurrences.length === 0) return;

    if (!initialGeoResolved) {
      return;
    }

    const points: Array<{ lat: number; lng: number }> = [];

    const markerSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="8" fill="#facc15" stroke="#7c5a00" stroke-width="2" /></svg>';
    const icon = new H.map.Icon(markerSvg);

    filteredOccurrences.forEach((occurrence) => {
      const [lat, lng] = occurrence.coordinates;
      const label = typeLabel[occurrence.type] || occurrence.type;
      const address = occurrence.address || "Endereco nao informado";
      const title = `Ocorrência de ${label}`;
      const description = occurrence.description || "Sem descrição informada.";
      const imageHtml = occurrence.imageBase64
        ? `<img src="${occurrence.imageBase64}" alt="Foto da ocorrência" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px;" />`
        : "";

      const popupHtml = `<div style="font-family:sans-serif;min-width:220px;max-width:260px;">${imageHtml}<p style="font-size:14px;font-weight:700;margin:0 0 6px 0;">${escapeHtml(title)}</p><p style="font-size:12px;color:#374151;margin:0 0 6px 0;">${escapeHtml(description)}</p><p style="font-size:12px;color:#6b7280;margin:0 0 10px 0;">${escapeHtml(address)}</p><a href="/ocorrencia/${occurrence.id}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:6px 10px;border-radius:8px;font-size:12px;">Abrir detalhes</a></div>`;

      const marker = new H.map.Marker({ lat, lng }, { icon });
      marker.setData(popupHtml);
      markerGroup.addObject(marker);

      marker.addEventListener("tap", (event: any) => {
        ui?.getBubbles?.().forEach((bubble: any) => ui.removeBubble(bubble));
        const bubble = new H.ui.InfoBubble(event.target.getGeometry(), {
          content: event.target.getData(),
        });
        ui?.addBubble(bubble);
      });

      points.push({ lat, lng });
    });

    if (userLocation) {
      // Keep user-centric view; do not override with automatic bounds fit.
      return;
    }

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(15, true);
      return;
    }

    const geoLine = new H.geo.LineString();
    points.forEach((point) => {
      geoLine.pushPoint(point);
    });

    const bounds = geoLine.getBoundingBox();
    if (bounds) {
      map.getViewModel().setLookAtData({
        bounds,
        zoom: Math.min(map.getZoom(), 15),
      });
    }
  }, [filteredOccurrences, userLocation, initialGeoResolved]);

  const handleLocate = () => {
    if (!mapRef.current || !userMarkerGroupRef.current) {
      toast.error("Mapa ainda não está pronto.");
      return;
    }

    setGeoDebug("Solicitando GPS atual...");
    void requestUserLocation(true, { preferFresh: true, allowCacheFallback: false, zoom: 16 });
  };

  return (
    <div className="h-[calc(100vh-3.5rem-4rem)] relative isolate">
      <button
        onClick={handleLocate}
        className="absolute bottom-24 left-4 z-[1200] bg-white p-3 rounded-full shadow-lg hover:bg-accent transition-colors disabled:opacity-80"
        aria-label="Centralizar na minha localizacao"
        disabled={isLocating}
      >
        {isLocating ? <Loader2 className="h-6 w-6 text-primary animate-spin" /> : <Locate className="h-6 w-6 text-primary" />}
      </button>

      <div ref={mapContainerRef} className="w-full h-full relative z-0" />

      {(loading || resolvingCoordinates) && (
        <div className="absolute inset-0 z-[1100] pointer-events-none grid place-items-center">
          <div className="bg-white/90 border border-border rounded-full px-4 py-2 shadow-md flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <p>Carregando ocorrencias...</p>
          </div>
        </div>
      )}

      {!loading && !resolvingCoordinates && filteredOccurrences.length === 0 && (
        <div className="absolute inset-x-0 bottom-28 z-[1100] px-4 pointer-events-none">
          <div className="max-w-md mx-auto bg-white/95 rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground text-center">
            Nenhuma ocorrência encontrada para o filtro atual.
          </div>
        </div>
      )}

    </div>
  );
}
