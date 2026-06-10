/**
 * KLIM Pixel Art Server
 * Usa Replicate API con google/gemini-2.5-flash-image
 */

const express = require('express');
const cors = require('cors');
const Replicate = require('replicate');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// Pre-load KLIM background as base64
let klimBgBase64 = null;
try {
  const bgPath = path.join(__dirname, 'public', 'FONDO_KLIM.png');
  if (fs.existsSync(bgPath)) {
    const bgBuffer = fs.readFileSync(bgPath);
    klimBgBase64 = `data:image/png;base64,${bgBuffer.toString('base64')}`;
    console.log('✅ KLIM background loaded');
  }
} catch (e) {
  console.log('⚠️ No KLIM background found, using prompt-only approach');
}

// POST /api/pixel-art
app.post('/api/pixel-art', async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ error: 'REPLICATE_API_TOKEN no configurado' });
    }

    const { imageDataUrl, detectedEmotion, emotionScore } = req.body;
    if (!imageDataUrl) {
      return res.status(400).json({ error: 'imageDataUrl es obligatorio' });
    }

    console.log('🧠 Enviando imagen al modelo Gemini para pixel art...');

    const emotionMap = {
      happy: 'a clear joyful smile',
      surprise: 'a genuine surprised expression with open mouth and raised brows',
      disgust: 'a genuine disgusted expression',
      serious: 'a neutral serious expression'
    };
    const expressionHint = emotionMap[detectedEmotion] || 'the exact facial expression from the uploaded image';
    const expressionGuard = detectedEmotion
      ? `The facial expression must match the uploaded image and stay faithful to the detected emotion: ${detectedEmotion} (${emotionScore || 0}%). Specifically keep ${expressionHint}. Do not replace it with a generic soft smile, neutral face, or a different mood.`
      : `The facial expression must match the uploaded image exactly. If the person is smiling, preserve the smile clearly with lifted cheeks and smiling mouth. If the person is neutral, keep them neutral. If the person is surprised or disgusted, preserve that expression faithfully. Do not replace the source expression with a generic pleasant smile.`;
    const negativeGuard = `Avoid changing the mouth shape, cheek lift, eyebrow position, or overall emotion from the source face. Avoid generic grin, neutralizing the expression, beauty-retouch smile, expression drift, stiff face, dead eyes, exaggerated cartoon face, deformed face, asymmetrical features, extra limbs, messy details, text, logos, watermark, or UI.`;

    const input = {
      prompt: `A high-end 3D cinematic character portrait of the person in the uploaded image, rendered in a sophisticated stylized animation style inspired by premium family animation films. Hyper-detailed facial features: large expressive eyes with realistic iris reflections, a meticulously sculpted nose and lips, and soft-touch skin texture with subtle subsurface scattering for a lifelike glow. Masterfully preserve the original facial expression, emphasizing micro-movements in the eyebrows and corners of the mouth to convey the same emotion from the source image. Detailed, flowing natural hair with rich strand detail and warm golden rim lighting. Soft, warm volumetric lighting. Chest-up portrait, centered composition, vertical 9:16 framing. Background: a dreamy, ethereal sky with fluffy iridescent clouds, shimmering sparkles, and a soft pastel palette. Premium 3D render look, magical atmosphere, vibrant yet elegant, polished and cinematic. ${expressionGuard} ${negativeGuard}`,
      image_input: [imageDataUrl],
    };

    // Retry logic - up to 3 attempts
    const MAX_RETRIES = 3;
    let lastError = null;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`🔄 Intento ${attempt}/${MAX_RETRIES}...`);
        
        const output = await replicate.run('google/gemini-2.5-flash-image', { input });

        let url;
        if (output && typeof output.url === 'function') {
          url = String(output.url());
        } else if (typeof output === 'string') {
          url = output;
        } else if (Array.isArray(output) && output.length > 0) {
          const first = output[0];
          url = typeof first === 'string' ? first : (first.url ? String(first.url()) : String(first));
        } else if (output && output.output) {
          url = Array.isArray(output.output) ? output.output[0] : output.output;
        }

        if (!url || !/^https?:\/\//i.test(url)) {
          throw new Error('URL generada no válida: ' + JSON.stringify(output).substring(0, 200));
        }

        console.log('✅ Pixel art generado:', url);
        return res.json({ success: true, outputUrl: url });
        
      } catch (attemptErr) {
        lastError = attemptErr;
        console.error(`❌ Intento ${attempt} falló:`, attemptErr.message);
        if (attempt < MAX_RETRIES) {
          const delay = attempt * 2000; // 2s, 4s wait
          console.log(`⏳ Esperando ${delay/1000}s antes de reintentar...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    // All retries failed
    console.error('❌ Todos los intentos fallaron:', lastError?.message);
    res.status(500).json({ error: lastError?.message || 'Error generando pixel art después de varios intentos' });

  } catch (err) {
    console.error('❌ Error general:', err.message);
    res.status(500).json({ error: err.message || 'Error generando pixel art' });
  }
});

// POST /api/save-photo — Download image from URL and save locally for QR
const photosDir = path.join(__dirname, 'public', 'photos');
if (!fs.existsSync(photosDir)) fs.mkdirSync(photosDir, { recursive: true });

app.post('/api/save-photo', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl required' });
    
    const filename = `klim_${Date.now()}_${Math.random().toString(36).substr(2,6)}.jpg`;
    const filePath = path.join(photosDir, filename);
    
    if (imageUrl.startsWith('data:')) {
      // Base64 data URL
      const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    } else if (imageUrl.startsWith('http')) {
      // Remote URL — download with native https/http
      const proto = imageUrl.startsWith('https') ? require('https') : require('http');
      await new Promise((resolve, reject) => {
        const request = proto.get(imageUrl, (response) => {
          // Follow redirects
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            const rProto = response.headers.location.startsWith('https') ? require('https') : require('http');
            rProto.get(response.headers.location, (r2) => {
              const chunks = [];
              r2.on('data', c => chunks.push(c));
              r2.on('end', () => { fs.writeFileSync(filePath, Buffer.concat(chunks)); resolve(); });
              r2.on('error', reject);
            }).on('error', reject);
            return;
          }
          const chunks = [];
          response.on('data', c => chunks.push(c));
          response.on('end', () => { fs.writeFileSync(filePath, Buffer.concat(chunks)); resolve(); });
          response.on('error', reject);
        });
        request.on('error', reject);
      });
    } else {
      return res.status(400).json({ error: 'Invalid URL format' });
    }
    
    // Build public download URL
    const host = req.headers.host || `localhost:${PORT}`;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const downloadUrl = `${protocol}://${host}/photos/${filename}`;
    
    console.log(`📸 Photo saved: ${filename} → ${downloadUrl}`);
    res.json({ success: true, downloadUrl, filename });
    
  } catch (err) {
    console.error('❌ Save photo error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Serve saved photos
app.use('/photos', express.static(photosDir));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'google/gemini-2.5-flash-image',
    hasToken: !!process.env.REPLICATE_API_TOKEN,
    hasBackground: !!klimBgBase64
  });
});

app.listen(PORT, () => {
  console.log(`🥛 KLIM Pixel Art Server running on port ${PORT}`);
  console.log(`   Model: google/gemini-2.5-flash-image`);
  console.log(`   Token: ${process.env.REPLICATE_API_TOKEN ? '✅' : '❌ MISSING'}`);
  console.log(`   KLIM Background: ${klimBgBase64 ? '✅' : '⚠️ Not found'}`);
  console.log(`   Open: http://localhost:${PORT}`);
});
