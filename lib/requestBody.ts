/**
 * Utilidades para lectura controlada del flujo HTTP (Route Handlers en Next.js 15).
 * Permite acotar el consumo de memoria ante peticiones multipart o cuerpos pesados.
 */

export type BoundedBodyResult =
  | { ok: true; request: Request }
  | { ok: false; status: 413 | 400; message: string };

/**
 * Lee el cuerpo de una solicitud Request limitando los bytes físicos leídos del stream.
 * Si el flujo supera `maxBytes`, cancela el lector de inmediato para no acumular
 * memoria innecesaria y rechaza con 413.
 *
 * Reconstruye una nueva instancia Request únicamente con los bytes leídos.
 * Conserva el Content-Type (incluyendo boundary multipart si aplica) pero no reutiliza
 * un Content-Length original no confiable.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number
): Promise<BoundedBodyResult> {
  const clHeader = request.headers.get("content-length");
  if (clHeader !== null && clHeader.trim() !== "") {
    const declaredLength = Number(clHeader);
    if (!Number.isNaN(declaredLength) && declaredLength > maxBytes) {
      return {
        ok: false,
        status: 413,
        message: "El cuerpo de la solicitud supera el tamaño máximo permitido.",
      };
    }
  }

  if (!request.body) {
    return { ok: true, request };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel("Límite de bytes excedido");
          } catch {
            // Ignorar errores al cancelar si el stream ya cerró
          }
          return {
            ok: false,
            status: 413,
            message: "El cuerpo de la solicitud supera el tamaño máximo permitido.",
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    try {
      await reader.cancel();
    } catch {
      // Ignorar errores de cleanup
    }
    return {
      ok: false,
      status: 400,
      message: "Error al leer el flujo de la solicitud.",
    };
  }

  const totalBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    totalBuffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const newHeaders = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) {
    newHeaders.set("content-type", contentType);
  }
  const cookie = request.headers.get("cookie");
  if (cookie) {
    newHeaders.set("cookie", cookie);
  }
  const authorization = request.headers.get("authorization");
  if (authorization) {
    newHeaders.set("authorization", authorization);
  }
  // Se asigna la longitud real leída y verificada
  newHeaders.set("content-length", String(totalBytes));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers: newHeaders,
    body: hasBody ? totalBuffer : undefined,
  });

  return { ok: true, request: boundedRequest };
}
