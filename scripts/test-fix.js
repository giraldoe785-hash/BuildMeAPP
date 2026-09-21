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

const casoBPath = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
const casoBBase64 = fs.readFileSync(casoBPath).toString('base64');

async function testVariation(name, schema, sysInstExtra = '', maxTokens = 1500) {
  console.log('\n--- Testing:', name, '---');
  const t0 = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: modelName,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: casoBBase64 } },
          { text: 'Descripción del usuario: "Se observa una fuga o rotura de agua en una tubería."\n\nAnaliza esta evidencia visual para la categoría "Plomería" y genera un diagnóstico técnico estructurado.' }
        ]
      }],
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
- Si puedes diagnosticar, detalla causa raíz técnica probable, solución recomendada, materiales, horas estimadas y costo estimado.
${sysInstExtra}`,
        responseMimeType: 'application/json',
        responseSchema: schema,
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        maxOutputTokens: maxTokens,
      }
    });
    const duration = Date.now() - t0;
    console.log(name, 'COMPLETED in', duration, 'ms');
    console.log('Result text:\n', res.text);
    const p = JSON.parse(res.text);
    console.log('Parsed prices:', { pricingType: p.pricingType, fixed: p.priceFixed, min: p.priceRangeMin, max: p.priceRangeMax });
  } catch (err) {
    console.log(name, 'FAILED in', Date.now() - t0, 'ms:', err.message);
  }
}

// Variation 1: Integer with descriptions and clear prompt rule
const schema1 = {
  type: Type.OBJECT,
  properties: {
    canDiagnose: { type: Type.BOOLEAN },
    title: { type: Type.STRING },
    confidenceScore: { type: Type.INTEGER, description: 'Porcentaje entero de certeza técnica entre 0 y 100.' },
    confidenceLevel: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
    pricingType: { type: Type.STRING, enum: ['guaranteed_fixed', 'estimated_range'] },
    severity: { type: Type.STRING, enum: ['baja', 'media', 'alta', 'critica'] },
    rootCause: { type: Type.STRING },
    suggestedFix: { type: Type.STRING },
    requiredMaterials: { type: Type.ARRAY, items: { type: Type.STRING } },
    estimatedHours: { type: Type.NUMBER },
    priceFixed: { type: Type.INTEGER, description: 'Precio fijo estimado en USD (número entero razonable, ej: 75) si pricingType es guaranteed_fixed.' },
    priceRangeMin: { type: Type.INTEGER, description: 'Precio mínimo estimado en USD (número entero razonable, ej: 40) si pricingType es estimated_range.' },
    priceRangeMax: { type: Type.INTEGER, description: 'Precio máximo estimado en USD (número entero razonable, ej: 120) si pricingType es estimated_range.' },
  },
  required: [
    'canDiagnose', 'title', 'confidenceScore', 'confidenceLevel',
    'pricingType', 'severity', 'rootCause', 'suggestedFix',
    'requiredMaterials', 'estimatedHours',
  ],
};

const promptRule = `
- Estimación económica: Los precios deben ser números enteros en USD de 2 a 3 dígitos (por ejemplo 40 a 150 USD). Nunca agregues ceros excesivos ni notación científica.`;

testVariation('Explicit Price Descriptions & Rules', schema1, promptRule);
