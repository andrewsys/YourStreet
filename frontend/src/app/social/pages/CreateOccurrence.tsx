import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, Send } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import occurrenceService from "../../../services/OccurrenceService";

interface AddressSuggestion {
  id: string;
  displayName: string;
  value: string;
}

const HERE_API_KEY = import.meta.env.VITE_HERE_API_KEY as string | undefined;
const DEFAULT_SEARCH_AT = "-23.5505,-46.6333";
const LAST_LOCATION_STORAGE_KEY = "yourstreet.last-user-location";

function normalizeAddress(text: string): string {
  return text.trim().toLowerCase();
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Falha ao ler imagem"));
    reader.readAsDataURL(file);
  });
}

export function CreateOccurrence() {
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [suggestions, setSuggestions] = useState<Array<AddressSuggestion>>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingCurrentAddress, setLoadingCurrentAddress] = useState(true);
  const [image, setImage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [searchAt, setSearchAt] = useState<string>(DEFAULT_SEARCH_AT);
  const debounceRef = useRef<number | null>(null);
  const selectedSuggestionRef = useRef<string>("");
  const requestIdRef = useRef(0);
  const addressValidationCacheRef = useRef<Map<string, boolean>>(new Map());

  const validateAddressExists = async (address: string): Promise<boolean> => {
    if (!HERE_API_KEY) {
      return true;
    }

    const normalized = normalizeAddress(address);
    if (!normalized) return false;

    if (addressValidationCacheRef.current.has(normalized)) {
      return addressValidationCacheRef.current.get(normalized) ?? false;
    }

    try {
      const params = new URLSearchParams({
        q: address,
        limit: "1",
        lang: "pt-BR",
        in: "countryCode:BRA",
        apiKey: HERE_API_KEY,
      });

      const response = await fetch(`https://geocode.search.hereapi.com/v1/geocode?${params.toString()}`);
      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as {
        items?: Array<{
          title?: string;
          address?: {
            label?: string;
          };
        }>;
      };

      const found = (data.items?.length ?? 0) > 0;
      addressValidationCacheRef.current.set(normalized, found);
      return found;
    } catch {
      return false;
    }
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    try {
      const base64 = await fileToBase64(files[0]);
      setImage(base64);
    } catch (error) {
      console.error(error);
      toast.error("Nao foi possivel processar a imagem");
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!description || !location) {
      toast.error("Por favor, preencha todos os campos obrigatorios");
      return;
    }

    const locationExists = await validateAddressExists(location);
    if (!locationExists) {
      toast.error("Endereco nao encontrado. Escolha um endereco valido da lista ou refine o texto.");
      return;
    }

    try {
      setSubmitting(true);
      await occurrenceService.create({
        description,
        address: location,
        imageBase64: image,
      });

      toast.success("Ocorrencia criada com sucesso!");
      setDescription("");
      setLocation("");
      setSuggestions([]);
      setImage(null);
    } catch (error) {
      console.error(error);
      toast.error("Nao foi possivel criar a ocorrencia");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const prefillCurrentAddress = async () => {
      if (!HERE_API_KEY) {
        if (mounted) setLoadingCurrentAddress(false);
        return;
      }

      if (!navigator.geolocation) {
        if (mounted) setLoadingCurrentAddress(false);
        return;
      }

      try {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 30000,
          });
        });

        const at = `${position.coords.latitude},${position.coords.longitude}`;
        if (mounted) {
          setSearchAt(at);
        }

        try {
          window.localStorage.setItem(
            LAST_LOCATION_STORAGE_KEY,
            JSON.stringify({ lat: position.coords.latitude, lng: position.coords.longitude }),
          );
        } catch {
          // Ignore storage failures.
        }

        const params = new URLSearchParams({
          at,
          limit: "1",
          lang: "pt-BR",
          apiKey: HERE_API_KEY,
        });

        const response = await fetch(`https://revgeocode.search.hereapi.com/v1/revgeocode?${params.toString()}`);
        if (!response.ok) {
          if (mounted) setLoadingCurrentAddress(false);
          return;
        }

        const data = (await response.json()) as {
          items?: Array<{
            address?: {
              street?: string;
              houseNumber?: string;
              label?: string;
            };
            title?: string;
          }>;
        };

        if (!mounted) return;

        const item = data.items?.[0];
        const street = item?.address?.street?.trim() ?? "";
        const number = item?.address?.houseNumber?.trim() ?? "";
        const shortAddress = [street, number].filter(Boolean).join(", ");

        if (shortAddress) {
          setLocation(shortAddress);
        } else if (item?.address?.label) {
          setLocation(item.address.label);
        } else if (item?.title) {
          setLocation(item.title);
        }
      } catch {
        // Keep manual input when user denies permission or reverse lookup fails.
      } finally {
        if (mounted) setLoadingCurrentAddress(false);
      }
    };

    void prefillCurrentAddress();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }

    const query = location.trim();
    const normalizedQuery = normalizeAddress(query);
    if (query.length < 3) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    if (normalizedQuery === normalizeAddress(selectedSuggestionRef.current)) {
      setSuggestions([]);
      setLoadingSuggestions(false);
      return;
    }

    const currentRequestId = ++requestIdRef.current;

    debounceRef.current = window.setTimeout(async () => {
      try {
        if (!HERE_API_KEY) {
          setSuggestions([]);
          return;
        }

        setLoadingSuggestions(true);
        const params = new URLSearchParams({
          q: query,
          at: searchAt,
          in: "countryCode:BRA",
          lang: "pt-BR",
          limit: "5",
          apiKey: HERE_API_KEY,
        });

        const response = await fetch(`https://autosuggest.search.hereapi.com/v1/autosuggest?${params.toString()}`);
        if (!response.ok) {
          if (currentRequestId !== requestIdRef.current) return;
          setSuggestions([]);
          return;
        }

        const data = (await response.json()) as Array<{
          id?: string;
          title?: string;
          resultType?: string;
          address?: {
            label?: string;
            street?: string;
            houseNumber?: string;
          };
        }> | { items?: Array<{
          id?: string;
          title?: string;
          resultType?: string;
          address?: {
            label?: string;
            street?: string;
            houseNumber?: string;
          };
        }> };

        const items = Array.isArray(data) ? data : data.items ?? [];

        const nextSuggestions = items
          .filter((item) => item.resultType !== "chain")
          .map((item, index) => {
            const street = item.address?.street?.trim() ?? "";
            const number = item.address?.houseNumber?.trim() ?? "";
            const shortAddress = [street, number].filter(Boolean).join(", ");
            const fallbackLabel = item.address?.label || item.title || "";

            return {
              id: item.id || `${index}-${fallbackLabel}`,
              displayName: fallbackLabel,
              value: shortAddress || fallbackLabel,
            };
          })
          .filter((suggestion) => suggestion.value.trim().length > 0)
          .filter((suggestion) => normalizeAddress(suggestion.value) !== normalizedQuery);

        if (currentRequestId !== requestIdRef.current) {
          return;
        }

        setSuggestions(nextSuggestions);
      } catch {
        if (currentRequestId !== requestIdRef.current) return;
        setSuggestions([]);
      } finally {
        if (currentRequestId !== requestIdRef.current) return;
        setLoadingSuggestions(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [location, searchAt]);

  return (
    <div className="h-[calc(100vh-3.5rem-4rem)] overflow-y-auto pb-6">
      <div className="max-w-md mx-auto px-4 pt-6">
        <div className="mb-6">
          <h2 className="text-2xl font-semibold mb-2">Criar Ocorrencia</h2>
          <p className="text-muted-foreground text-sm">Reporte problemas que voce encontrou em sua rua</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="description">Descricao *</Label>
            <Textarea
              id="description"
              placeholder="Descreva o problema em detalhes..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="bg-input-background border-0 min-h-[120px]"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Localizacao *</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                id="location"
                type="text"
                placeholder="Rua, bairro ou endereco"
                value={location}
                onChange={(event) => {
                  selectedSuggestionRef.current = "";
                  setLocation(event.target.value);
                }}
                className="pl-10 bg-input-background border-0"
                required
              />
            </div>
            {loadingCurrentAddress && (
              <p className="text-xs text-muted-foreground">Tentando preencher com sua localização atual...</p>
            )}
            {(loadingSuggestions || suggestions.length > 0) && (
              <div className="rounded-md border border-border bg-background shadow-sm overflow-hidden">
                {loadingSuggestions ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Buscando sugestões de endereço...</p>
                ) : (
                  suggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      onClick={() => {
                        selectedSuggestionRef.current = suggestion.value;
                        requestIdRef.current += 1;
                        if (debounceRef.current) {
                          window.clearTimeout(debounceRef.current);
                        }
                        setLocation(suggestion.value);
                        setLoadingSuggestions(false);
                        setSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
                    >
                      {suggestion.value}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Fotos do Problema</Label>
            <div className="space-y-3">
              {image && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="relative aspect-square rounded-lg overflow-hidden">
                    <img src={image} alt="Preview" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}

              <label htmlFor="image-upload">
                <Card className="cursor-pointer hover:bg-accent transition-colors">
                  <CardContent className="p-4">
                    <div className="flex flex-col items-center justify-center text-center gap-2">
                      <div className="p-3 bg-muted rounded-full">
                        <Camera className="h-6 w-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium text-sm">Adicionar Fotos</p>
                        <p className="text-xs text-muted-foreground">Tire ou selecione fotos do problema</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <input
                  id="image-upload"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-semibold hover:bg-opacity-90 transition-all flex items-center justify-center gap-2"
          >
            <Send className="h-5 w-5" />
            {submitting ? "Enviando..." : "Enviar Ocorrencia"}
          </button>
        </form>
      </div>
    </div>
  );
}
