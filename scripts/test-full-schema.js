const fs = require('fs');
const path = require('path');
const { GoogleGenAI, Type, MediaResolution, ThinkingLevel } = require('@google/genai');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
let apiKey = '', modelName = '';
for (const line of env.split('\n')) {
  if (line.startsWith('GEMINI_API_KEY=')) apiKey = line.split('=').slice(1).join('=').trim();
  if (line.startsWith('GEMINI_MODEL=')) modelName = line.split('=').slice(1).join('=').trim();
}

const ai = new GoogleGenAI({ apiKey });

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
      description: "Porcentaje de certeza técnica entre 0 y 100.",
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
      description: "Precio fijo en USD si pricingType es guaranteed_fixed (entero de 2 a 3 dígitos, ej: 80).",
    },
    estimatedHours: {
      type: Type.NUMBER,
      description: "Horas estimadas de trabajo (ej: 1.5).",
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

async function testCase(name, imgPath, desc, category) {
  console.log(`\n==================================================`);
  console.log(`TEST: ${name}`);
  console.log(`==================================================`);
  const t0 = Date.now();
  const fileBuf = fs.readFileSync(imgPath);
  const tRead = Date.now() - t0;

  const tB64Start = Date.now();
  const base64Data = fileBuf.toString('base64');
  const tB64 = Date.now() - tB64Start;

  const promptText = `Descripción del usuario: "${desc}"`;
  const systemInstruction = `Eres Fixi Vision AI, un sistema experto de diagnóstico técnico para servicios del hogar.
Tu tarea es analizar la evidencia visual (imagen o video) y generar un diagnóstico técnico profesional.
Contexto:
- Categoría de servicio: ${category}
- Moneda: Dólares estadounidenses (USD).
- Rango de precios: Todos los precios deben ser números enteros en USD de 2 a 3 dígitos (por ejemplo entre 30 y 300 USD). No uses monedas locales ni agregues ceros excesivos.
Reglas:
- canDiagnose=true si la evidencia permite formular cualquier hipótesis técnica razonable (la incertidumbre se expresa en confidenceScore bajo).
- canDiagnose=false ÚNICAMENTE si la evidencia es totalmente ilegible, oscura o no corresponde a la categoría ${category}.
- Si puedes diagnosticar, detalla causa raíz técnica probable, solución recomendada, materiales, horas estimadas y costo estimado (con priceRangeMin y priceRangeMax si es estimated_range, o priceFixed si es guaranteed_fixed).`;

  const tGeminiStart = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            { text: `${promptText}\n\nAnaliza esta evidencia visual para la categoría "${category}" y genera un diagnóstico técnico estructurado.` }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: DIAGNOSIS_SCHEMA,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      }
    });

    const tGemini = Date.now() - tGeminiStart;
    const tParseStart = Date.now();
    const text = res.text;
    const parsed = JSON.parse(text);
    const tParse = Date.now() - tParseStart;
    const totalMs = Date.now() - t0;

    console.log(`${name} RESULTADO:`);
    console.log(`- fileReadMs: ${tRead} ms`);
    console.log(`- base64Ms: ${tB64} ms`);
    console.log(`- geminiMs: ${tGemini} ms`);
    console.log(`- parseMs: ${tParse} ms`);
    console.log(`- totalMs: ${totalMs} ms`);
    console.log(`- canDiagnose: ${parsed.canDiagnose}`);
    console.log(`- title: ${parsed.title}`);
    console.log(`- confidenceScore: ${parsed.confidenceScore}% (${parsed.confidenceLevel})`);
    console.log(`- pricingType: ${parsed.pricingType}`);
    console.log(`- prices: fixed=${parsed.priceFixed}, min=${parsed.priceRangeMin}, max=${parsed.priceRangeMax}`);
    console.log(`- severity: ${parsed.severity}`);
    console.log(`- estimatedHours: ${parsed.estimatedHours}`);
    console.log(`- rootCause: ${parsed.rootCause.slice(0, 80)}...`);
    console.log(`- suggestedFix: ${parsed.suggestedFix.slice(0, 80)}...`);
    console.log(`- requiredMaterials: ${JSON.stringify(parsed.requiredMaterials)}`);
    console.log(`- HTTP Status: ${parsed.canDiagnose ? 200 : 422}`);
    return { name, status: parsed.canDiagnose ? 200 : 422, tRead, tB64, tGemini, tParse, totalMs, parsed };
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`${name} FAILED after ${totalMs} ms:`, err.message);
    return { name, status: 500, totalMs, error: err.message };
  }
}

async function run() {
  const fA = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1789960715914.jpg';
  const fB = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
  const fC = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1788312195124.jpg';

  const rA = await testCase('CASO A (Latiguillo)', fA, 'Goteo y hernia en latiguillo de grifo', 'Plomería');
  const rB = await testCase('CASO B (Tubería rota)', fB, 'Tubería rota con fuga activa a presión', 'Plomería');
  const rC = await testCase('CASO C (Logo no relacionado)', fC, 'Problema en tubería de agua', 'Plomería');

  console.log(`\n==================================================`);
  console.log(`RESUMEN FINAL`);
  console.log(`==================================================`);
  console.log(`CASO A: HTTP ${rA.status} (geminiMs: ${rA.tGemini} ms, totalMs: ${rA.totalMs} ms)`);
  console.log(`CASO B: HTTP ${rB.status} (geminiMs: ${rB.tGemini} ms, totalMs: ${rB.totalMs} ms)`);
  console.log(`CASO C: HTTP ${rC.status} (geminiMs: ${rC.tGemini} ms, totalMs: ${rC.totalMs} ms)`);
}

run();
