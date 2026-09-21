const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
let apiKey = '', modelName = '';
for (const line of env.split('\n')) {
  if (line.startsWith('GEMINI_API_KEY=')) apiKey = line.split('=').slice(1).join('=').trim();
  if (line.startsWith('GEMINI_MODEL=')) modelName = line.split('=').slice(1).join('=').trim();
}

const { GoogleGenAI, Type, MediaResolution } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey });

// CASO B image
const casoBPath = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
const casoBBuf = fs.readFileSync(casoBPath);
const casoBBase64 = casoBBuf.toString('base64');

console.log('CASO B size:', casoBBuf.length, 'bytes');

// Schema from route.ts
const ROUTE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    canDiagnose: { type: Type.BOOLEAN },
    title: { type: Type.STRING },
    confidenceScore: { type: Type.INTEGER },
    confidenceLevel: { type: Type.STRING, enum: ["high", "medium", "low"] },
    pricingType: { type: Type.STRING, enum: ["guaranteed_fixed", "estimated_range"] },
    severity: { type: Type.STRING, enum: ["baja", "media", "alta", "critica"] },
    rootCause: { type: Type.STRING },
    suggestedFix: { type: Type.STRING },
    requiredMaterials: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimatedHours: { type: Type.NUMBER },
    priceFixed: { type: Type.INTEGER },
    priceRangeMin: { type: Type.INTEGER },
    priceRangeMax: { type: Type.INTEGER },
  },
  required: [
    "canDiagnose", "title", "confidenceScore", "confidenceLevel",
    "pricingType", "severity", "rootCause", "suggestedFix",
    "requiredMaterials", "estimatedHours",
  ],
};

async function testCasoBRouteExactNoTimeout() {
  console.log('\n--- Experiment 1: CASO B with route.ts EXACT call, NO TIMEOUT ---');
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: casoBBase64 } },
            { text: 'Descripción del usuario: "Se observa una fuga o rotura de agua en una tubería."\n\nAnaliza esta evidencia visual para la categoría "Plomería" y genera un diagnóstico técnico estructurado.' }
          ]
        }
      ],
      config: {
        systemInstruction: `Eres Fixi Vision AI, un sistema experto de diagnóstico técnico para servicios del hogar.
Tu tarea es analizar la evidencia visual (imagen o video) y generar un diagnóstico técnico profesional.
Contexto:
- Categoría de servicio: Plomería
- Moneda: USD
- Los precios deben ser realistas para el mercado latinoamericano de servicios del hogar.
Reglas:
- canDiagnose=true si la evidencia permite formular cualquier hipótesis técnica razonable (la incertidumbre se expresa en confidenceScore bajo).
- canDiagnose=false ÚNICAMENTE si la evidencia es totalmente ilegible, oscura o no corresponde a la categoría Plomería.
- Si puedes diagnosticar, detalla causa raíz técnica probable, solución recomendada, materiales, horas estimadas y costo estimado.`,
        responseMimeType: "application/json",
        responseSchema: ROUTE_SCHEMA,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
      }
    });
    const ms = Date.now() - t0;
    console.log('Result in', ms, 'ms:');
    console.log(res.text);
  } catch (err) {
    console.error('Error in', Date.now() - t0, 'ms:', err.name, err.message);
  }
}

testCasoBRouteExactNoTimeout();
