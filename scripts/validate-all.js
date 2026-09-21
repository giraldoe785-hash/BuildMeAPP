const fs = require('fs');
const path = require('path');
const { GoogleGenAI, Type, MediaResolution } = require('@google/genai');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
let apiKey = '', modelName = '';
for (const line of env.split('\n')) {
  if (line.startsWith('GEMINI_API_KEY=')) apiKey = line.split('=').slice(1).join('=').trim();
  if (line.startsWith('GEMINI_MODEL=')) modelName = line.split('=').slice(1).join('=').trim();
}

const ai = new GoogleGenAI({ apiKey });

const schema = {
  type: Type.OBJECT,
  properties: {
    canDiagnose: {
      type: Type.BOOLEAN,
      description: "true si la evidencia visual permite formular una hipótesis técnica; false únicamente si la imagen es completamente ilegible, oscura o ajena a la categoría."
    },
    title: {
      type: Type.STRING,
      description: "Título breve del diagnóstico técnico (máximo 80 caracteres)."
    },
    confidenceScore: {
      type: Type.INTEGER,
      description: "Porcentaje de certeza técnica entre 0 y 100."
    },
    confidenceLevel: {
      type: Type.STRING,
      description: "Nivel de certeza: high (>=80), medium (50-79), low (<50).",
      enum: ["high", "medium", "low"]
    },
    pricingType: {
      type: Type.STRING,
      description: "guaranteed_fixed si el precio puede fijarse con alta certeza; estimated_range si requiere inspección presencial.",
      enum: ["guaranteed_fixed", "estimated_range"]
    },
    severity: {
      type: Type.STRING,
      description: "Severidad de la avería.",
      enum: ["baja", "media", "alta", "critica"]
    },
    rootCause: {
      type: Type.STRING,
      description: "Causa raíz técnica probable del problema observado (2-3 oraciones)."
    },
    suggestedFix: {
      type: Type.STRING,
      description: "Solución técnica recomendada con pasos concretos (2-3 oraciones)."
    },
    requiredMaterials: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Lista de refacciones o materiales probables necesarios (2-5 items)."
    },
    estimatedHours: {
      type: Type.NUMBER,
      description: "Horas estimadas de trabajo (decimal, ej: 1.5)."
    },
    priceFixed: {
      type: Type.STRING,
      description: "Precio fijo estimado en USD como número simple (ej: '80') si pricingType es guaranteed_fixed."
    },
    priceRangeMin: {
      type: Type.STRING,
      description: "Precio mínimo estimado en USD como número simple (ej: '40') si pricingType es estimated_range."
    },
    priceRangeMax: {
      type: Type.STRING,
      description: "Precio máximo estimado en USD como número simple (ej: '120') si pricingType es estimated_range."
    }
  },
  required: [
    "canDiagnose",
    "title",
    "confidenceScore",
    "confidenceLevel",
    "pricingType",
    "severity",
    "rootCause",
    "suggestedFix",
    "requiredMaterials",
    "estimatedHours"
  ]
};

async function runTestCase(name, imgPath, userDesc, category) {
  console.log(`\n==================================================`);
  console.log(`EJECUTANDO ${name}`);
  console.log(`==================================================`);
  const t0 = Date.now();
  const fileBuf = fs.readFileSync(imgPath);
  const tRead = Date.now() - t0;

  const tB64Start = Date.now();
  const base64Data = fileBuf.toString('base64');
  const tB64 = Date.now() - tB64Start;

  const categoryName = category;
  const promptText = `Descripción del usuario: "${userDesc}"`;
  const systemInstruction = `Eres Fixi Vision AI, un sistema experto de diagnóstico técnico para servicios del hogar.
Tu tarea es analizar la evidencia visual (imagen o video) y generar un diagnóstico técnico profesional.
Contexto:
- Categoría de servicio: ${categoryName}
- Moneda: USD
- Los precios deben ser números enteros realistas en USD entre 20 y 800 (ej: 50, 120). No uses monedas locales ni agregues ceros excesivos.
Reglas:
- canDiagnose=true si la evidencia permite formular cualquier hipótesis técnica razonable (la incertidumbre se expresa en confidenceScore bajo).
- canDiagnose=false ÚNICAMENTE si la evidencia es totalmente ilegible, oscura o no corresponde a la categoría ${categoryName}.
- Si puedes diagnosticar, detalla causa raíz técnica probable, solución recomendada, materiales, horas estimadas y costo estimado (con priceRangeMin y priceRangeMax si es estimated_range, o priceFixed si es guaranteed_fixed).`;

  const tGeminiStart = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Data
              }
            },
            {
              text: `${promptText}\n\nAnaliza esta evidencia visual para la categoría "${categoryName}" y genera un diagnóstico técnico estructurado.`
            }
          ]
        }
      ],
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: schema,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        maxOutputTokens: 1200
      }
    });
    const tGemini = Date.now() - tGeminiStart;
    const tParseStart = Date.now();
    const text = res.text;
    console.log(`[RAW RESPONSE (${text.length} chars)]:\n${text}`);
    const parsed = JSON.parse(text);
    const parsePrice = (v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const clean = v.replace(/[^0-9.]/g, '');
        const n = parseFloat(clean);
        return isNaN(n) ? undefined : Math.round(n);
      }
      return undefined;
    };
    const priceFixed = parsePrice(parsed.priceFixed);
    const priceRangeMin = parsePrice(parsed.priceRangeMin);
    const priceRangeMax = parsePrice(parsed.priceRangeMax);
    const tParse = Date.now() - tParseStart;
    const totalMs = Date.now() - t0;

    console.log(`${name} COMPLETADO:`);
    console.log(`- fileReadMs: ${tRead} ms`);
    console.log(`- base64Ms: ${tB64} ms`);
    console.log(`- geminiMs: ${tGemini} ms`);
    console.log(`- parseMs: ${tParse} ms`);
    console.log(`- totalMs: ${totalMs} ms`);
    console.log(`- canDiagnose: ${parsed.canDiagnose}`);
    console.log(`- title: ${parsed.title}`);
    console.log(`- confidenceScore: ${parsed.confidenceScore}% (${parsed.confidenceLevel})`);
    console.log(`- pricingType: ${parsed.pricingType}`);
    console.log(`- parsed prices: fixed=${priceFixed}, min=${priceRangeMin}, max=${priceRangeMax}`);
    console.log(`- HTTP Simulada: ${parsed.canDiagnose ? 200 : 422}`);
    return {
      name,
      status: parsed.canDiagnose ? 200 : 422,
      tRead,
      tB64,
      tGemini,
      tParse,
      totalMs,
      parsed
    };
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`${name} ERROR tras ${totalMs} ms:`, err.name, err.message);
    return {
      name,
      status: 500,
      totalMs,
      error: err.message
    };
  }
}

async function main() {
  const fA = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1789960715914.jpg';
  const fB = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
  const fC = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1788312195124.jpg';

  const resA = await runTestCase('CASO A (Latiguillo dañado)', fA, 'Goteo y daño en latiguillo de lavabo', 'Plomería');
  const resB = await runTestCase('CASO B (Fuga tubería)', fB, 'Tubería rota con fuga activa', 'Plomería');
  const resC = await runTestCase('CASO C (Logo no relacionado)', fC, 'Problema de plomería en casa', 'Plomería');

  console.log('\n==================================================');
  console.log('RESUMEN DE PRUEBAS DIRECTAS');
  console.log('==================================================');
  console.log(`CASO A: HTTP ${resA.status} (geminiMs: ${resA.tGemini} ms, totalMs: ${resA.totalMs} ms)`);
  console.log(`CASO B: HTTP ${resB.status} (geminiMs: ${resB.tGemini} ms, totalMs: ${resB.totalMs} ms)`);
  console.log(`CASO C: HTTP ${resC.status} (geminiMs: ${resC.tGemini} ms, totalMs: ${resC.totalMs} ms)`);
}

main();
