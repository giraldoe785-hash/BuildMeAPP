// Limitador de ventana deslizante en memoria.
// Sin dependencias de Next ni de Prisma, para poder probarlo de forma aislada.
//
// Limitaciones (aceptables para un solo servidor): el estado se pierde al
// reiniciar, y si la clave viene de una cabecera (x-forwarded-for) solo es
// confiable cuando el hosting es quien la escribe.

export interface RateLimiter {
  /** ¿Esta clave ya alcanzó el máximo dentro de la ventana? (no consume nada) */
  isLimited(key: string): boolean;
  /** Registra un uso para la clave. */
  record(key: string): void;
  /** Cantidad de claves almacenadas (útil para pruebas). */
  size(): number;
}

export function createRateLimiter(options: {
  max: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): RateLimiter {
  const { max, windowMs, now = Date.now, maxKeys = 5000 } = options;
  const hits = new Map<string, number[]>();

  // Quita los usos vencidos de una clave y devuelve los que siguen vigentes.
  const prune = (key: string, t: number): number[] => {
    const recent = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (recent.length > 0) hits.set(key, recent);
    else hits.delete(key);
    return recent;
  };

  return {
    isLimited(key) {
      return prune(key, now()).length >= max;
    },

    record(key) {
      const t = now();

      // Evita que el mapa crezca sin límite: primero purga lo vencido y,
      // si sigue lleno, descarta la clave más antigua.
      if (hits.size >= maxKeys && !hits.has(key)) {
        for (const k of [...hits.keys()]) prune(k, t);
        if (hits.size >= maxKeys) {
          const oldest = hits.keys().next().value;
          if (oldest !== undefined) hits.delete(oldest);
        }
      }

      const recent = prune(key, t);
      recent.push(t);
      hits.set(key, recent);
    },

    size() {
      return hits.size;
    },
  };
}