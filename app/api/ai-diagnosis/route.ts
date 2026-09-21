import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type, MediaResolution, ThinkingLevel } from "@google/genai";

const ALLOWED_MIMES = ["image/jpeg", "image/png", "video/mp4"];
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30 MB
const VALID_CATEGORIES = [
  "electricidad",
  "plomeria",
  "carpinteria",
  "herreria",
  "pintura",
  "cerrajeria",
];

// Timeout único de seguridad en servidor para la llamada a Gemini.
const AI_TIMEOUT_MS = 30_000;

const CATEGORY_NAMES: Record<string, string> = {
  electricidad: "Electricidad",
  plomeria: "Plomería",
  carpinteria: "Carpintería",
  herreria: "Herrería",
  pintura: "Pintura / Impermeabilización",
  cerrajeria: "Cerrajería",
};

const DIAGNOSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canDiagnose: {
      type: Type.BOOLEAN,
      description:
        "true si la evidencia visual permite formular una hipótesis técnica; false únicamente si la imagen es completamente ilegible, oscura o ajena a la categoría.",
    },
    title: {
      type: Type.STRING,
      description: "Título breve del diagnóstico técnico (máximo 80 caracteres).",
    },
    confidenceScore: {
      type: Type.INTEGER,
      description: "Porcentaje entero de certeza técnica entre 0 y 100.",
    },
    confidenceLevel: {
      type: Type.STRING,
      description: "Nivel de certeza: high (>=80), medium (50-79), low (<50).",
      enum: ["high", "medium", "low"],
    },
    pricingType: {
      type: Type.STRING,
      description:
        "guaranteed_fixed si el precio puede fijarse con alta certeza; estimated_range si requiere inspección presencial.",
      enum: ["guaranteed_fixed", "estimated_range"],
    },
    priceRangeMin: {
      type: Type.INTEGER,
      description: "Costo mínimo estimado en USD (entero de 2 a 3 dígitos, ej: 40).",
    },
    priceRangeMax: {
      type: Type.INTEGER,
      description: "Costo máximo estimado en USD (entero de 2 a 3 dígitos, ej: 120).",
    },
    priceFixed: {
      type: Type.INTEGER,
      description:
        "Precio fijo en USD si pricingType es guaranteed_fixed (entero de 2 a 3 dígitos, ej: 80).",
    },
    estimatedHours: {
      type: Type.NUMBER,
      description: "Horas estimadas de trabajo (decimal, ej: 1.5).",
    },
    severity: {
      type: Type.STRING,
      description: "Severidad de la avería.",
      enum: ["baja", "media", "alta", "critica"],
    },
    rootCause: {
      type: Type.STRING,
      description:
        "Causa raíz técnica probable del problema observado (2-3 oraciones).",
    },
    suggestedFix: {
      type: Type.STRING,
      description:
        "Solución técnica recomendada con pasos concretos (2-3 oraciones).",
    },
    requiredMaterials: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description:
        "Lista de refacciones o materiales probables necesarios (2-5 items).",
    },
  },
  required: [
    "canDiagnose",
    "title",
    "confidenceScore",
    "confidenceLevel",
    "pricingType",
    "priceRangeMin",
    "priceRangeMax",
    "estimatedHours",
    "severity",
    "rootCause",
    "suggestedFix",
    "requiredMaterials",
  ],
};

const INCONCLUSIVE_ERROR =
  "ERROR: No ha sido posible generar un diagnóstico concluyente con la evidencia suministrada. Por favor intente con una fotografía más clara o escoja una falla del listado predefinido.";

const PROVIDER_ERROR =
  "El servicio de análisis de imágenes no está disponible en este momento. Intente de nuevo en unos minutos o escoja una falla del listado predefinido.";

function getImageDimensions(
  buffer: Buffer
): { width: number; height: number } | null {
  try {
    // PNG check
    if (
      buffer.length >= 24 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    // JPEG check
    if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let i = 2;
      while (i < buffer.length - 8) {
        if (buffer[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buffer[i + 1];
        if (
          (marker >= 0xc0 && marker <= 0xc3) ||
          (marker >= 0xc5 && marker <= 0xc7) ||
          (marker >= 0xc9 && marker <= 0xcb) ||
          (marker >= 0xcd && marker <= 0xcf)
        ) {
          const height = buffer.readUInt16BE(i + 5);
          const width = buffer.readUInt16BE(i + 7);
          return { width, height };
        }
        if (marker === 0xd9 || marker === 0xda) break;
        const len = buffer.readUInt16BE(i + 2);
        if (len <= 0) break;
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const reqStart = Date.now();
  let fileReadMs = 0;
  let base64Ms = 0;
  let geminiMs = 0;
  let parseMs = 0;
  let geminiStartTime = 0;
  let dimensions: { width: number; height: number } | null = null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY no configurada en el servidor." },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Request inválido. Se esperaba multipart/form-data." },
      { status: 400 }
    );
  }

  const file = formData.get("file") as File | null;
  const category = formData.get("category") as string | null;
  const userPrompt = formData.get("userPrompt") as string | null;

  // --- Validaciones de entrada ---

  if (!file) {
    return NextResponse.json(
      { error: "No se recibió ningún archivo." },
      { status: 400 }
    );
  }

  if (!category || !VALID_CATEGORIES.includes(category)) {
    return NextResponse.json(
      { error: "Categoría técnica inválida o no proporcionada." },
      { status: 400 }
    );
  }

  if (!ALLOWED_MIMES.includes(file.type)) {
    return NextResponse.json(
      {
        error: `Formato de archivo no permitido (${file.type}). Solo se aceptan: JPG, PNG, MP4.`,
      },
      { status: 400 }
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      {
        error: `El archivo excede el tamaño máximo de 30 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).`,
      },
      { status: 400 }
    );
  }

  // --- Medición de lectura y conversión ---

  const tRead = Date.now();
  const arrayBuffer = await file.arrayBuffer();
  fileReadMs = Date.now() - tRead;

  const buffer = Buffer.from(arrayBuffer);
  dimensions = getImageDimensions(buffer);

  const tBase64 = Date.now();
  const base64Data = buffer.toString("base64");
  base64Ms = Date.now() - tBase64;

  const categoryName = CATEGORY_NAMES[category] || category;
  const promptText = userPrompt?.trim()
    ? `Descripción del usuario: "${userPrompt.trim()}"`
    : "El usuario no proporcionó una descripción adicional.";

  const systemInstruction = `Eres Fixi Vision AI, un sistema experto de diagnóstico técnico para servicios del hogar.
Tu tarea es analizar la evidencia visual (imagen o video) y generar un diagnóstico técnico profesional.
Contexto:
- Categoría de servicio: ${categoryName}
- Moneda: Dólares estadounidenses (USD).
- Rango de precios: Todos los precios deben ser números enteros en USD de 2 a 3 dígitos (por ejemplo entre 30 y 300 USD). No uses monedas locales ni agregues ceros excesivos.
Reglas:
- canDiagnose=true si la evidencia permite formular cualquier hipótesis técnica razonable (la incertidumbre se expresa en confidenceScore bajo).
- canDiagnose=false ÚNICAMENTE si la evidencia es totalmente ilegible, oscura o no corresponde a la categoría ${categoryName}.
- Si puedes diagnosticar, detalla causa raíz técnica probable, solución recomendada, materiales, horas estimadas y costo estimado (con priceRangeMin y priceRangeMax si es estimated_range, o priceFixed si es guaranteed_fixed).
- Seguridad en Electricidad: Cuando la categoría sea Electricidad y exista evidencia de daño, sobrecalentamiento, cableado expuesto, arco eléctrico o componentes quemados:
  * Priorizar la seguridad en la recomendación técnica.
  * Indicar que no se debe manipular una instalación potencialmente energizada.
  * Recomendar la desenergización mediante un procedimiento seguro antes de intervenir.
  * No instruir a usuarios no especializados a manipular conductores, barras, acometidas o componentes energizados.`;

  // --- Llamar a Gemini ---

  const modelName = process.env.GEMINI_MODEL;
  if (!modelName) {
    console.error("[AI-DIAGNOSIS] GEMINI_MODEL no está configurado en .env.local");
    return NextResponse.json(
      { error: "Modelo de IA no configurado en el servidor." },
      { status: 500 }
    );
  }

  const abortController = new AbortController();
  let timeoutTriggered = false;
  const timeoutHandle = setTimeout(() => {
    timeoutTriggered = true;
    abortController.abort();
  }, AI_TIMEOUT_MS);

  try {
    const ai = new GoogleGenAI({ apiKey });

    let responseText: string;
    geminiStartTime = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: file.type,
                  data: base64Data,
                },
              },
              {
                text: `${promptText}\n\nAnaliza esta evidencia visual para la categoría "${categoryName}" y genera un diagnóstico técnico estructurado.`,
              },
            ],
          },
        ],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: DIAGNOSIS_SCHEMA,
          mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: abortController.signal,
        },
      });

      geminiMs = Date.now() - geminiStartTime;
      responseText = response.text ?? "";
    } finally {
      clearTimeout(timeoutHandle);
    }

    // --- Medir y validar respuesta parseada ---

    const tParse = Date.now();

    if (!responseText || responseText.trim() === "") {
      console.error("[AI-DIAGNOSIS] Respuesta vacía de Gemini");
      return NextResponse.json(
        { error: INCONCLUSIVE_ERROR },
        { status: 422 }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      console.error("[AI-DIAGNOSIS] Error parseando JSON de Gemini");
      return NextResponse.json(
        { error: INCONCLUSIVE_ERROR },
        { status: 422 }
      );
    }

    if (!parsed.canDiagnose) {
      const totalMs = Date.now() - reqStart;
      console.log(
        "[AI-DIAGNOSIS] timing (inconclusive):",
        JSON.stringify({
          fileReadMs,
          base64Ms,
          geminiMs,
          parseMs: Date.now() - tParse,
          totalMs,
          mime: file.type,
          fileSizeBytes: file.size,
          width: dimensions?.width,
          height: dimensions?.height,
        })
      );
      return NextResponse.json(
        { error: INCONCLUSIVE_ERROR },
        { status: 422 }
      );
    }

    // Validar campos obligatorios y tipos
    if (
      typeof parsed.title !== "string" || !parsed.title.trim() ||
      typeof parsed.confidenceScore !== "number" ||
      typeof parsed.rootCause !== "string" || !parsed.rootCause.trim() ||
      typeof parsed.suggestedFix !== "string" || !parsed.suggestedFix.trim() ||
      typeof parsed.estimatedHours !== "number"
    ) {
      return NextResponse.json(
        { error: INCONCLUSIVE_ERROR },
        { status: 422 }
      );
    }

    // Normalizar confidenceScore (maneja tanto 0.95 como 95)
    const rawScore =
      parsed.confidenceScore <= 1 && parsed.confidenceScore > 0
        ? parsed.confidenceScore * 100
        : parsed.confidenceScore;
    const confidenceScore = Math.min(
      100,
      Math.max(0, Math.round(rawScore))
    );

    // Validar coherencia de precios
    const pricingType: string =
      parsed.pricingType === "guaranteed_fixed" ? "guaranteed_fixed" : "estimated_range";

    const sanitizePrice = (val: any): number | undefined => {
      if (typeof val === "number" && Number.isFinite(val) && val >= 10 && val <= 5000) {
        return Math.round(val);
      }
      return undefined;
    };

    const priceFixed: number | undefined = sanitizePrice(parsed.priceFixed);
    let finalPriceRangeMin: number | undefined = sanitizePrice(parsed.priceRangeMin);
    let finalPriceRangeMax: number | undefined = sanitizePrice(parsed.priceRangeMax);
    let finalPriceFixed: number | undefined = priceFixed;

    if (pricingType === "guaranteed_fixed") {
      finalPriceFixed =
        priceFixed ??
        (finalPriceRangeMin && finalPriceRangeMax
          ? Math.round((finalPriceRangeMin + finalPriceRangeMax) / 2)
          : 75);
    } else {
      finalPriceRangeMin = finalPriceRangeMin ?? 40;
      finalPriceRangeMax = finalPriceRangeMax ?? 120;
      if (finalPriceRangeMin > finalPriceRangeMax) {
        const temp = finalPriceRangeMin;
        finalPriceRangeMin = finalPriceRangeMax;
        finalPriceRangeMax = temp;
      }
    }

    parseMs = Date.now() - tParse;
    const totalMs = Date.now() - reqStart;

    console.log(
      "[AI-DIAGNOSIS] timing:",
      JSON.stringify({
        fileReadMs,
        base64Ms,
        geminiMs,
        parseMs,
        totalMs,
        mime: file.type,
        fileSizeBytes: file.size,
        width: dimensions?.width,
        height: dimensions?.height,
      })
    );

    return NextResponse.json({
      title: parsed.title.trim(),
      confidenceScore,
      confidenceLevel: (["high", "medium", "low"].includes(parsed.confidenceLevel)
        ? parsed.confidenceLevel
        : "medium") as "high" | "medium" | "low",
      pricingType: (["guaranteed_fixed", "estimated_range"].includes(pricingType)
        ? pricingType
        : "estimated_range") as "guaranteed_fixed" | "estimated_range",
      severity: (["baja", "media", "alta", "critica"].includes(parsed.severity)
        ? parsed.severity
        : "media") as "baja" | "media" | "alta" | "critica",
      rootCause: parsed.rootCause.trim(),
      suggestedFix: parsed.suggestedFix.trim(),
      requiredMaterials: Array.isArray(parsed.requiredMaterials)
        ? parsed.requiredMaterials.filter((m: any) => typeof m === "string")
        : [],
      estimatedHours: Math.max(0.5, parsed.estimatedHours),
      priceFixed: finalPriceFixed,
      priceRangeMin: finalPriceRangeMin,
      priceRangeMax: finalPriceRangeMax,
      method: "Análisis_IA",
    });

  } catch (err: any) {
    clearTimeout(timeoutHandle);
    const totalMs = Date.now() - reqStart;

    console.error("[AI-DIAGNOSIS] Error en llamada a Gemini:", {
      name: err?.name,
      message: err?.message?.slice(0, 300),
      status: err?.status,
    });

    // 1. Timeout real: SOLO si fue activado por nuestro timer
    if (timeoutTriggered) {
      console.log(
        "[AI-DIAGNOSIS] timing (timeout):",
        JSON.stringify({
          fileReadMs,
          base64Ms,
          geminiMs: geminiStartTime > 0 ? Date.now() - geminiStartTime : 0,
          parseMs: 0,
          totalMs,
          mime: file.type,
          fileSizeBytes: file.size,
          width: dimensions?.width,
          height: dimensions?.height,
        })
      );
      return NextResponse.json(
        {
          error:
            "El análisis está tardando más de lo esperado. Intente nuevamente en unos segundos.",
        },
        { status: 408 }
      );
    }

    // 2. Errores del proveedor Gemini (404, 429, 401, 403, 500 de Google, etc.)
    const httpStatus: number | undefined = err?.status;
    if (
      httpStatus !== undefined ||
      err?.message?.includes("GoogleGenAI") ||
      err?.name === "GoogleGenAIError"
    ) {
      return NextResponse.json(
        { error: PROVIDER_ERROR },
        { status: 502 }
      );
    }

    // 3. Error interno inesperado del endpoint
    return NextResponse.json(
      { error: PROVIDER_ERROR },
      { status: 500 }
    );
  }
}
