// Archivo: /api/gemini.js

export default async function handler(req, res) {
  // Solo permitimos peticiones POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Vercel inyectará esta variable de entorno de forma segura
  const apiKey = process.env.GEMINI_SECURE_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ error: 'La API Key no está configurada en el servidor' });
  }

  // Leemos qué modelo quiere usar el frontend (o usamos uno por defecto)
  const model = req.query.model || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    // Hacemos la petición real a Google desde los servidores de Vercel
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body) // Pasamos el payload exacto que mandó el frontend
    });

    const data = await response.json();
    
    // Le devolvemos la respuesta al frontend
    return res.status(200).json(data);
  } catch (error) {
    console.error("Error interno en el proxy de Vercel:", error);
    return res.status(500).json({ error: 'Error al procesar la solicitud con Gemini' });
  }
}