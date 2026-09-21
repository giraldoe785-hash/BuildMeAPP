const fs = require('fs');

async function sendRequest(name, filePath, category, userPrompt) {
  console.log(`\n==================================================`);
  console.log(`PROBANDO ENDPOINT HTTP: ${name}`);
  console.log(`==================================================`);
  const t0 = Date.now();
  const fileBuf = fs.readFileSync(filePath);
  const blob = new Blob([fileBuf], { type: 'image/jpeg' });
  const formData = new FormData();
  formData.append('file', blob, 'test.jpg');
  formData.append('category', category);
  if (userPrompt) formData.append('userPrompt', userPrompt);

  try {
    const res = await fetch('http://localhost:3001/api/ai-diagnosis', {
      method: 'POST',
      body: formData,
    });
    const totalMs = Date.now() - t0;
    const status = res.status;
    const json = await res.json();
    console.log(`${name} HTTP RESPONSE: Status ${status} en ${totalMs} ms`);
    console.log(JSON.stringify(json, null, 2));
    return { name, status, totalMs, json };
  } catch (err) {
    const totalMs = Date.now() - t0;
    console.error(`${name} FETCH ERROR tras ${totalMs} ms:`, err.message);
    return { name, status: 0, totalMs, error: err.message };
  }
}

async function main() {
  const fA = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1789960715914.jpg';
  const fB = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
  const fC = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1788312195124.jpg';

  // Wait a bit for server to warm up
  await new Promise((r) => setTimeout(r, 2000));

  const rA = await sendRequest('CASO A (Latiguillo dañado)', fA, 'plomeria', 'Goteo y hernia en latiguillo de grifo');
  const rB = await sendRequest('CASO B (Tubería con fuga activa)', fB, 'plomeria', 'Tubería rota con fuga activa a presión');
  const rC = await sendRequest('CASO C (Logo no relacionado)', fC, 'plomeria', 'Problema en tubería de agua');

  console.log(`\n==================================================`);
  console.log(`TABLA RESUMEN HTTP REAL`);
  console.log(`==================================================`);
  console.log(`CASO A: HTTP ${rA.status} en ${rA.totalMs} ms`);
  console.log(`CASO B: HTTP ${rB.status} en ${rB.totalMs} ms`);
  console.log(`CASO C: HTTP ${rC.status} en ${rC.totalMs} ms`);
}

main();
