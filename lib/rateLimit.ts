// Limitador de ventana deslizante en memoria.
// Sin dependencias de Next ni de Prisma, para poder probarlo de forma aislada.
//
// Limitaciones de arquitectura:
// - Vive en la memoria del proceso Node.js: si la aplicación se despliega en
//   múltiples instancias, contenedores réplica o funciones serverless efímeras
//   con cold-starts independientes, el conteo no se comparte entre nodos.
// - En un entorno distribuido de alta escala debe sustituirse por un almacén
//   centralizado (p. ej. Redis con scripts Lua atómicos o tabla en PostgreSQL).
// - Es adecuado para entornos monolíticos, instancias únicas o desarrollo/MVP.
// - Si la clave viene de x-forwarded-for, solo es confiable si el proxy inverso
//   del hosting elimina o sobreescribe dicha cabecera.

export interface RateLimiter {
  /** ¿Esta clave ya alcanzó el máximo dentro de la ventana? (no consume nada) */
  isLimited(key: string): boolean;
  /** Registra un uso para la clave. */
  record(key: string): void;
  /**
   * Comprueba y consume un intento en una sola operación sincrónica y atómica.
   * Si ya superó el límite, retorna false (rechazado). Si tiene cuota, registra
   * el intento de inmediato y retorna true.
   */
  consume(key: string): boolean;
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

  const recordAt = (key: string, t: number): void => {
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
  };

  return {
    isLimited(key) {
      return prune(key, now()).length >= max;
    },

    record(key) {
      recordAt(key, now());
    },

    consume(key) {
      const t = now();
      const recent = prune(key, t);
      if (recent.length >= max) {
        return false;
      }
      recordAt(key, t);
      return true;
    },

    size() {
      return hits.size;
    },
  };
}
