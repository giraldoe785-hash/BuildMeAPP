const fs = require('fs');
const path = require('path');

// We test by importing the route or mocking NextRequest
async function test() {
  const fA = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1789960715914.jpg';
  const fB = 'C:\\Users\\Shalom\\Downloads\\Gemini_Generated_Image_pvb1fcpvb1fcpvb1.jpg';
  const fC = 'C:/Users/Shalom/.gemini/antigravity/brain/5451b178-13f5-41cb-a608-155f5731e34d/.user_uploaded/media_1788312195124.jpg';

  console.log('Verifying test files existence:');
  console.log('CASO A:', fs.existsSync(fA), fs.statSync(fA).size, 'bytes');
  console.log('CASO B:', fs.existsSync(fB), fs.statSync(fB).size, 'bytes');
  console.log('CASO C:', fs.existsSync(fC), fs.statSync(fC).size, 'bytes');
}

test();
