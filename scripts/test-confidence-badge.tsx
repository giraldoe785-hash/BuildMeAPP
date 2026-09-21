import React from "react";
import ReactDOMServer from "react-dom/server";
import { ConfidenceBadge } from "../components/ui/ConfidenceBadge";

const cases = [
  { name: "CASO A", pricingType: "guaranteed_fixed" as const, confidenceScore: 95, expected: "PRECIO FIJO GARANTIZADO" },
  { name: "CASO B", pricingType: "estimated_range" as const, confidenceScore: 90, expected: "RANGO ESTIMADO (+ INSPECCIÓN)" },
  { name: "CASO C", pricingType: "estimated_range" as const, confidenceScore: 95, expected: "RANGO ESTIMADO (+ INSPECCIÓN)" },
  { name: "CASO D", pricingType: "guaranteed_fixed" as const, confidenceScore: 80, expected: "PRECIO FIJO GARANTIZADO" },
];

console.log("==================================================");
console.log("PRUEBAS DE RENDERIZADO DE CONFIDENCEBADGE");
console.log("==================================================");

let allPassed = true;
for (const c of cases) {
  const html = ReactDOMServer.renderToString(
    React.createElement(ConfidenceBadge, {
      score: c.confidenceScore,
      type: c.pricingType,
    })
  );

  const containsExpected = html.includes(c.expected);
  const containsScore = html.includes(`Certeza IA:`) && html.includes(`${c.confidenceScore}`);
  const status = containsExpected && containsScore ? "PASSED" : "FAILED";
  if (status === "FAILED") allPassed = false;

  console.log(`\n[${c.name}] status: ${status}`);
  console.log(`- pricingType: "${c.pricingType}" | confidenceScore: ${c.confidenceScore}`);
  console.log(`- Esperado: "${c.expected}" -> Encontrado: ${containsExpected}`);
  console.log(`- Certeza mostrada: ${containsScore}`);
  console.log(`- HTML renderizado: ${html}`);
}

console.log("\n==================================================");
console.log(`RESULTADO GENERAL: ${allPassed ? "TODAS LAS PRUEBAS PASARON" : "HUBO FALLOS"}`);
console.log("==================================================");

if (!allPassed) process.exit(1);
