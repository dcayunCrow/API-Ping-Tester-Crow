import React, { useState, useCallback, useEffect } from 'react';
import { Plus, Play, Trash2, Activity, AlertCircle, RefreshCw, CheckCircle2, XCircle, Info, X, Sparkles, Bot, Wand2, FileText, Pencil, Check, FileJson } from 'lucide-react';

export default function App() {
  const [baseUrl, setBaseUrl] = useState(() => {
    return localStorage.getItem('crow_baseUrl') || '';
  });
  const [customHeaders, setCustomHeaders] = useState(() => {
    const saved = localStorage.getItem('crow_customHeaders');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return [{ id: crypto.randomUUID(), key: 'ngrok-skip-browser-warning', value: '1' }];
  });
  const [newHeaderKey, setNewHeaderKey] = useState('');
  const [newHeaderValue, setNewHeaderValue] = useState('');
  const [newPath, setNewPath] = useState('');
  const [endpointDetails, setEndpointDetails] = useState(null);
  
  // Nuevos estados para la IA
  const [suggestingPaths, setSuggestingPaths] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [showYamlModal, setShowYamlModal] = useState(false);
  const [yamlInput, setYamlInput] = useState('');

  // Estados para la edición de endpoints
  const [editingId, setEditingId] = useState(null);
  const [editPathValue, setEditPathValue] = useState('');

  const [endpoints, setEndpoints] = useState(() => {
    const saved = localStorage.getItem('crow_endpoints');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return parsed.map(ep => ({
          ...ep,
          status: null,
          loading: false,
          latency: null,
          errorDetail: null,
          responseData: null
        }));
      } catch (e) {}
    }
    return [];
  });

  // Guardar en localStorage cuando cambien
  useEffect(() => {
    localStorage.setItem('crow_baseUrl', baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    localStorage.setItem('crow_customHeaders', JSON.stringify(customHeaders));
  }, [customHeaders]);

  useEffect(() => {
    const endpointsToSave = endpoints.map(ep => ({ id: ep.id, path: ep.path }));
    localStorage.setItem('crow_endpoints', JSON.stringify(endpointsToSave));
  }, [endpoints]);

  // Manejar el cambio de la URL base
  const handleBaseUrlChange = (e) => {
    let url = e.target.value;
    // Evitar que termine en barra para no duplicar luego
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    setBaseUrl(url);
  };

  // Agregar un nuevo header personalizado
  const handleAddHeader = (e) => {
    e.preventDefault();
    if (!newHeaderKey.trim()) return;
    setCustomHeaders(prev => [
      ...prev,
      { id: crypto.randomUUID(), key: newHeaderKey.trim(), value: newHeaderValue.trim() }
    ]);
    setNewHeaderKey('');
    setNewHeaderValue('');
  };

  // Eliminar un header personalizado
  const handleDeleteHeader = (id) => {
    setCustomHeaders(prev => prev.filter(h => h.id !== id));
  };

  // Agregar un nuevo endpoint a la lista
  const handleAddEndpoint = (e) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    
    let formattedPath = newPath.trim();
    if (!formattedPath.startsWith('/')) {
      formattedPath = '/' + formattedPath;
    }

    setEndpoints([
      ...endpoints,
      { id: crypto.randomUUID(), path: formattedPath, status: null, loading: false, latency: null, errorDetail: null }
    ]);
    setNewPath('');
  };

  // Eliminar un endpoint
  const handleDeleteEndpoint = (id) => {
    setEndpoints(endpoints.filter(ep => ep.id !== id));
  };

  // Iniciar edición
  const handleStartEdit = (ep) => {
    setEditingId(ep.id);
    setEditPathValue(ep.path);
  };

  // Guardar edición
  const handleSaveEdit = (id) => {
    if (!editPathValue.trim()) return;
    
    let formattedPath = editPathValue.trim();
    if (!formattedPath.startsWith('/')) {
      formattedPath = '/' + formattedPath;
    }

    setEndpoints(currentEndpoints => 
      currentEndpoints.map(ep => 
        ep.id === id 
          ? { ...ep, path: formattedPath, status: null, latency: null, errorDetail: null } 
          : ep
      )
    );
    setEditingId(null);
  };

  // Cancelar edición
  const handleCancelEdit = () => {
    setEditingId(null);
    setEditPathValue('');
  };

  // Función de reintento para la API de Gemini (Exponential Backoff)
  const fetchWithRetry = async (url, options, retries = 5) => {
    const delays = [1000, 2000, 4000, 8000, 16000];
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, delays[i]));
      }
    }
  };

  // Novedad IA: Importar endpoints desde YAML OpenAPI
  const importEndpointsFromYaml = async () => {
    if (!yamlInput.trim()) return;
    setSuggestingPaths(true);
    setShowYamlModal(false);
    
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; // Se provee en local por .env, o en producción en tiempo de ejecución
      const apiUrl = import.meta.env.VITE_GEMINI_API_URL || "";
      //const url = `${apiUrl}?key=${apiKey}`;

      // AQUÍ ESTÁ EL CAMBIO: Llamamos a nuestra propia API y le pasamos el modelo
      const url = `/api/gemini?model=gemini-2.5-flash-lite`;
      
      const payload = {
        contents: [{
          parts: [{ text: `Extrae todas las rutas (paths) de los endpoints definidos en este documento OpenAPI YAML. Devuelve SOLO un JSON con un array 'paths' que contenga las rutas exactas como strings (ejemplo: ["/locations", "/locations/{id}", "/locations/nearby"]).\n\nYAML:\n${yamlInput}` }]
        }],
        systemInstruction: {
          parts: [{ text: "Eres un experto en APIs. Devuelve únicamente la estructura JSON solicitada sin markdown extra ni texto adicional." }]
        },
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              paths: {
                type: "ARRAY",
                items: { type: "STRING" }
              }
            }
          }
        }
      };

      const data = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (resultText) {
        const parsed = JSON.parse(resultText);
        if (parsed.paths && Array.isArray(parsed.paths)) {
          const newEndpoints = parsed.paths.map(path => ({
            id: crypto.randomUUID(),
            path: path.startsWith('/') ? path : `/${path}`,
            status: null,
            loading: false,
            latency: null,
            errorDetail: null
          }));
          setEndpoints(prev => [...prev, ...newEndpoints]);
        }
      }
    } catch (error) {
      console.error("Error al procesar el YAML:", error);
    } finally {
      setSuggestingPaths(false);
      setYamlInput('');
    }
  };

  // Novedad IA: Analizar un error específico
  const analyzeErrorWithAI = async (endpoint) => {
    setAnalyzingAi(true);
    setAiAnalysis(null);
    
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; // Se provee en local por .env, o en producción en tiempo de ejecución
      const apiUrl = import.meta.env.VITE_GEMINI_API_URL || "";
      //const url = `${apiUrl}?key=${apiKey}`;

      // AQUÍ ESTÁ EL CAMBIO: Llamamos a nuestra propia API y le pasamos el modelo
      const url = `/api/gemini?model=gemini-2.5-flash-lite`;
      
      const prompt = `Analiza el siguiente error de una petición HTTP a una API y explica de forma breve y amigable (en español) por qué podría estar ocurriendo y cómo solucionarlo.
      
      URL probada: ${baseUrl}${endpoint.path}
      Detalles del error: ${endpoint.errorDetail}`;

      const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: {
          parts: [{ text: "Eres un desarrollador senior ayudando a depurar una API. Sé conciso y directo." }]
        }
      };

      const data = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      setAiAnalysis(text || "No se pudo generar un análisis.");
    } catch (error) {
      setAiAnalysis("Ocurrió un error al intentar comunicar con la IA para el análisis. Por favor, intenta de nuevo.");
    } finally {
      setAnalyzingAi(false);
    }
  };

  // Función para probar un solo endpoint
  const testEndpoint = async (id) => {
    setEndpoints(currentEndpoints => 
      currentEndpoints.map(ep => ep.id === id ? { ...ep, loading: true, status: null, latency: null, errorDetail: null, responseData: null } : ep)
    );

    const endpointToTest = endpoints.find(ep => ep.id === id);
    if (!endpointToTest) return;

    const fullUrl = `${baseUrl}${endpointToTest.path}`;
    const startTime = Date.now();

    // Construir headers combinando los personalizados con Accept
    const headersToSend = { 'Accept': 'application/json' };
    customHeaders.forEach(h => {
      if (h.key) headersToSend[h.key] = h.value;
    });

    try {
      const response = await fetch(fullUrl, { 
        method: 'GET',
        headers: headersToSend
      });
      
      const latency = Date.now() - startTime;
      
      let errorDetail = null;
      let responseData = null;

      if (!response.ok) {
        errorDetail = `HTTP Error ${response.status}: ${response.statusText}`;
        try {
          const text = await response.text();
          if (text) errorDetail += `\n\nRespuesta del servidor:\n${text.substring(0, 300)}${text.length > 300 ? '...' : ''}`;
        } catch (e) { /* ignorar si no se puede leer el body */ }
      } else {
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            responseData = await response.json();
          } else {
            responseData = await response.text();
          }
        } catch (e) {
          responseData = "Respuesta recibida pero no se pudo parsear.";
        }
      }

      setEndpoints(currentEndpoints => 
        currentEndpoints.map(ep => 
          ep.id === id ? { ...ep, loading: false, status: response.status, latency, errorDetail, responseData } : ep
        )
      );
    } catch (error) {
      // Error de red, CORS, o servidor inalcanzable
      setEndpoints(currentEndpoints => 
        currentEndpoints.map(ep => 
          ep.id === id ? { ...ep, loading: false, status: 'ERR', latency: null, errorDetail: error.message || 'Error de conexión (CORS o Red)' } : ep
        )
      );
    }
  };

  // Probar todos los endpoints secuencialmente
  const testAllEndpoints = async () => {
    for (const ep of endpoints) {
      await testEndpoint(ep.id);
    }
  };

  // Helper para determinar colores basados en el status HTTP y diseño Crow
  const getStatusInfo = (status) => {
    if (status === null) return { color: 'bg-[#6E6E6E]', text: 'text-[#F0F0F0]', border: 'border-[#6E6E6E]/30', bgBadge: 'bg-[#212328]' };
    if (status === 'ERR') return { color: 'bg-[#ef4444]', text: 'text-[#f87171]', border: 'border-[#ef4444]/30', bgBadge: 'bg-[#ef4444]/10' };
    if (status >= 200 && status < 300) return { color: 'bg-[#22c55e]', text: 'text-[#4ade80]', border: 'border-[#4ade80]/30', bgBadge: 'bg-[#22c55e]/10' };
    if (status >= 300 && status < 400) return { color: 'bg-[#A64CCA]', text: 'text-[#d8a1f7]', border: 'border-[#A64CCA]/30', bgBadge: 'bg-[#A64CCA]/10' };
    if (status >= 400 && status < 500) return { color: 'bg-[#eab308]', text: 'text-[#facc15]', border: 'border-[#facc15]/30', bgBadge: 'bg-[#eab308]/10' };
    if (status >= 500) return { color: 'bg-[#ef4444]', text: 'text-[#f87171]', border: 'border-[#ef4444]/30', bgBadge: 'bg-[#ef4444]/10' };
    return { color: 'bg-[#6E6E6E]', text: 'text-[#F0F0F0]', border: 'border-[#6E6E6E]/30', bgBadge: 'bg-[#212328]' };
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-[#080111] to-[#200404] text-[#FFFFFF] p-6 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Cabecera */}
        <header className="flex items-center gap-4 border-b border-[#606060]/30 pb-4">
          <div className="flex items-center justify-center drop-shadow-xl hover:scale-105 transition-transform duration-300">
            {/* Logo Crow */}
            <img src="/crow-logo.svg" alt="API Ping Tester Crow" className="w-12 h-14 object-contain" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-[#FFFFFF] tracking-tight">API Ping Tester Crow</h1>
            <p className="text-[#F0F0F0] font-regular">Verifica el estado de tus endpoints en tiempo real</p>
          </div>
        </header>

        {/* Panel de Configuración y Agregar Path */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Base URL Input */}
          <div className="bg-[#2D2634] border border-[#606060]/30 rounded-[8px] p-5 shadow-sm flex flex-col">
            <label className="block text-sm font-semibold text-[#F0F0F0] mb-2">Base URL</label>
            <div className="flex bg-[#212328] rounded-[8px] border border-[#606060]/30 overflow-hidden focus-within:border-[#E12C2C] transition-all">
              <span className="px-3 py-2.5 bg-[#212328] text-[#6E6E6E] border-r border-[#606060]/30 select-none">URL</span>
              <input 
                type="url" 
                value={baseUrl}
                onChange={handleBaseUrlChange}
                placeholder="https://api.tu-servidor.com"
                className="flex-1 bg-transparent border-none outline-none px-3 py-2.5 text-[#FFFFFF] placeholder-[#6E6E6E] w-full"
              />
            </div>
            <div className="mt-4 flex items-start gap-2 text-xs text-[#F0F0F0]/70 bg-[#212328]/50 p-3 rounded-[8px] border border-[#606060]/20">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#A64CCA]" />
              <p>Asegúrate de incluir http:// o https://. Nota: Peticiones a dominios distintos pueden requerir configuración CORS en tu backend.</p>
            </div>

            {/* Headers Personalizados */}
            <div className="mt-4 pt-4 border-t border-[#606060]/30">
              <label className="block text-sm font-semibold text-[#F0F0F0] mb-2">Headers de la petición</label>

              {/* Lista de headers activos */}
              <div className="space-y-1.5 mb-3">
                {customHeaders.length === 0 && (
                  <p className="text-xs text-[#6E6E6E] italic">No hay headers configurados.</p>
                )}
                {customHeaders.map(h => (
                  <div key={h.id} className="flex items-center gap-2 bg-[#212328] border border-[#606060]/30 rounded-[8px] px-3 py-1.5 group">
                    <span className="text-xs font-mono text-[#A64CCA] shrink-0 truncate max-w-[45%]" title={h.key}>{h.key}</span>
                    <span className="text-xs text-[#6E6E6E] shrink-0">:</span>
                    <span className="text-xs font-mono text-[#F0F0F0] flex-1 truncate" title={h.value}>{h.value}</span>
                    <button
                      onClick={() => handleDeleteHeader(h.id)}
                      className="shrink-0 p-0.5 text-[#6E6E6E] hover:text-[#ef4444] transition-colors opacity-0 group-hover:opacity-100"
                      title="Eliminar header"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Formulario para agregar header */}
              <form onSubmit={handleAddHeader} className="flex gap-1.5">
                <input
                  type="text"
                  value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                  placeholder="Header"
                  className="w-2/5 bg-[#212328] border border-[#606060]/30 rounded-[8px] outline-none px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#6E6E6E] focus:border-[#E12C2C] transition-all font-mono"
                />
                <input
                  type="text"
                  value={newHeaderValue}
                  onChange={(e) => setNewHeaderValue(e.target.value)}
                  placeholder="Valor"
                  className="flex-1 bg-[#212328] border border-[#606060]/30 rounded-[8px] outline-none px-2.5 py-1.5 text-xs text-[#FFFFFF] placeholder-[#6E6E6E] focus:border-[#E12C2C] transition-all font-mono"
                />
                <button
                  type="submit"
                  disabled={!newHeaderKey.trim()}
                  className="shrink-0 bg-[#E12C2C] hover:opacity-90 disabled:opacity-40 disabled:bg-[#606060] text-white px-2.5 py-1.5 rounded-[8px] transition-all flex items-center justify-center"
                  title="Agregar header"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>

          {/* Add Path Input & YAML Import */}
          <div className="bg-[#2D2634] border border-[#606060]/30 rounded-[8px] p-5 shadow-sm flex flex-col justify-between gap-5">
            <div>
              <label className="block text-sm font-semibold text-[#F0F0F0] mb-2">Agregar un Endpoint</label>
              <form onSubmit={handleAddEndpoint} className="flex gap-2">
                <div className="flex-1 bg-[#212328] rounded-[8px] border border-[#606060]/30 overflow-hidden focus-within:border-[#E12C2C] transition-all flex">
                  <span className="px-3 py-2.5 text-[#6E6E6E] border-r border-[#606060]/30 select-none font-mono">/</span>
                  <input 
                    type="text" 
                    value={newPath}
                    onChange={(e) => setNewPath(e.target.value)}
                    placeholder="api/v1/usuarios"
                    className="flex-1 bg-transparent border-none outline-none px-3 py-2.5 text-[#FFFFFF] placeholder-[#6E6E6E] font-mono w-full"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={!newPath.trim()}
                  className="bg-[#E12C2C] hover:opacity-90 disabled:opacity-50 disabled:bg-[#606060] text-white px-4 py-2 rounded-[8px] font-semibold transition-all flex items-center justify-center shadow-lg"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </form>
            </div>

            {/* Botón IA: Importar YAML (AHORA DESTACADO) */}
            <div className="pt-5 border-t border-[#606060]/30">
              <button
                onClick={() => setShowYamlModal(true)}
                disabled={suggestingPaths}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#A64CCA] hover:opacity-90 disabled:opacity-50 text-white rounded-[8px] text-sm font-bold transition-all shadow-lg shadow-[#A64CCA]/20"
              >
                {suggestingPaths ? <RefreshCw className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                ✨ Importar endpoints desde YAML
              </button>
            </div>
          </div>
        </div>

        {/* Panel de Endpoints */}
        <div className="bg-[#2D2634] border border-[#606060]/30 rounded-[8px] overflow-hidden shadow-sm">
          <div className="px-5 py-4 border-b border-[#606060]/30 flex justify-between items-center bg-[#212328]">
            <h2 className="text-lg font-bold text-[#FFFFFF] flex items-center gap-2">
              <RefreshCw className="w-5 h-5 text-[#A64CCA]" />
              Listado de Endpoints
            </h2>
            <button 
              onClick={testAllEndpoints}
              disabled={endpoints.length === 0 || endpoints.some(ep => ep.loading)}
              className="flex items-center gap-2 px-4 py-2 bg-[#E12C2C] hover:opacity-90 text-white rounded-[8px] text-sm font-bold transition-all disabled:opacity-50 shadow-md"
            >
              <Play className="w-4 h-4 fill-current" />
              Probar Todos
            </button>
          </div>

          {endpoints.length === 0 ? (
            <div className="p-12 text-center text-[#6E6E6E] flex flex-col items-center">
              <Activity className="w-12 h-12 mb-3 opacity-20" />
              <p className="font-semibold text-[#F0F0F0]">No hay endpoints configurados.</p>
              <p className="text-sm mt-1">Agrega una ruta manual o importa un YAML.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#606060]/30">
              {endpoints.map((ep) => {
                const { color, text, border, bgBadge } = getStatusInfo(ep.status);
                const isEditing = editingId === ep.id;
                const hasError = ep.status === 'ERR' || (typeof ep.status === 'number' && ep.status >= 400);
                
                return (
                  <li key={ep.id} className="p-4 hover:bg-[#212328]/50 transition-colors group flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-col">
                    
                    {/* Info del Endpoint */}
                    {isEditing ? (
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[#6E6E6E] font-mono text-sm hidden sm:block truncate max-w-[150px]">
                          {baseUrl}
                        </span>
                        <input
                          type="text"
                          value={editPathValue}
                          onChange={(e) => setEditPathValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit(ep.id)}
                          className="flex-1 bg-[#212328] border border-[#A64CCA] rounded-[8px] outline-none px-3 py-2 text-[#FFFFFF] font-mono text-sm shadow-inner"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          {/* El LED Parpadeante */}
                          <div className="relative flex h-3 w-3 shrink-0">
                            {ep.status !== null && !ep.loading && (
                              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${color}`}></span>
                            )}
                            <span className={`relative inline-flex rounded-full h-3 w-3 ${ep.loading ? 'bg-[#A64CCA] animate-pulse' : color}`}></span>
                          </div>
                          <h3 className="text-base font-mono font-semibold text-[#FFFFFF] truncate" title={ep.path}>
                            {ep.path}
                          </h3>
                        </div>
                        <p className="text-xs text-[#6E6E6E] ml-6 truncate font-mono" title={`${baseUrl}${ep.path}`}>
                          {baseUrl}{ep.path}
                        </p>
                      </div>
                    )}

                    {/* Resultados y Acciones */}
                    <div className="flex items-center gap-4 ml-6 sm:ml-0 ml-[-2rem]">
                      {/* Badge de Status */}
                      {!isEditing && (
                        <div className="flex items-center gap-3 min-w-[140px] justify-end">
                          {ep.loading ? (
                            <div className="flex items-center gap-2 text-[#A64CCA] text-sm font-semibold">
                              <RefreshCw className="w-4 h-4 animate-spin" />
                              <span>Probando...</span>
                            </div>
                          ) : (
                            <>
                              {ep.latency && (
                                <span className="text-xs text-[#6E6E6E] font-mono">{ep.latency}ms</span>
                              )}
                              <div className={`px-2.5 py-1 rounded-[8px] text-sm font-bold font-mono border ${border} ${text} ${bgBadge} flex items-center justify-center min-w-[60px] shadow-inner`}>
                                {ep.status === null ? '-' : ep.status}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      {/* Botones de acción */}
                      <div className="flex items-center gap-1 border-l border-[#606060]/30 pl-4">
                        {isEditing ? (
                          <>
                            <button 
                              onClick={() => handleSaveEdit(ep.id)}
                              className="p-2 text-[#22c55e] hover:bg-[#212328] rounded-[8px] transition-colors"
                              title="Guardar"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={handleCancelEdit}
                              className="p-2 text-[#ef4444] hover:bg-[#212328] rounded-[8px] transition-colors"
                              title="Cancelar"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <>
                            {hasError && (
                              <button 
                                onClick={() => handleStartEdit(ep)}
                                className="p-2 text-[#F0F0F0] hover:text-[#A64CCA] hover:bg-[#212328] rounded-[8px] transition-colors"
                                title="Editar endpoint"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {ep.errorDetail && (
                              <button 
                                onClick={() => setEndpointDetails(ep)}
                                className="p-2 text-[#eab308] hover:bg-[#212328] rounded-[8px] transition-colors"
                                title="Ver detalles del error"
                              >
                                <Info className="w-4 h-4" />
                              </button>
                            )}
                            {ep.responseData && (
                              <button 
                                onClick={() => setEndpointDetails(ep)}
                                className="p-2 text-[#4ade80] hover:bg-[#212328] rounded-[8px] transition-colors"
                                title="Ver respuesta"
                              >
                                <FileJson className="w-4 h-4" />
                              </button>
                            )}
                            <button 
                              onClick={() => testEndpoint(ep.id)}
                              disabled={ep.loading}
                              className="p-2 text-[#F0F0F0] hover:text-[#4ade80] hover:bg-[#212328] rounded-[8px] transition-colors disabled:opacity-50"
                              title="Probar endpoint"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDeleteEndpoint(ep.id)}
                              disabled={ep.loading}
                              className="p-2 text-[#6E6E6E] hover:text-[#ef4444] hover:bg-[#212328] rounded-[8px] transition-colors disabled:opacity-50"
                              title="Eliminar endpoint"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Modal de Detalles de Endpoint (Error o Respuesta) */}
      {endpointDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm">
          <div className="bg-[#2D2634] border border-[#606060]/30 rounded-[8px] shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#606060]/30 bg-[#212328] shrink-0">
              <h3 className="text-lg font-bold text-[#FFFFFF] flex items-center gap-2">
                {endpointDetails.errorDetail ? (
                  <><AlertCircle className="w-5 h-5 text-[#ef4444]" /> Detalles del Error</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5 text-[#4ade80]" /> Respuesta del Servidor</>
                )}
              </h3>
              <button 
                onClick={() => {
                  setEndpointDetails(null);
                  setAiAnalysis(null);
                }}
                className="text-[#6E6E6E] hover:text-[#FFFFFF] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto">
              <div className="mb-4">
                <span className="text-sm text-[#F0F0F0] font-semibold block mb-1">Endpoint:</span>
                <code className="bg-[#212328] px-2 py-1 rounded-[8px] text-sm text-[#FFFFFF] border border-[#606060]/30 break-all block">
                  {baseUrl}{endpointDetails.path}
                </code>
              </div>
              
              {endpointDetails.errorDetail ? (
                <div className="mb-6">
                  <span className="text-sm text-[#F0F0F0] font-semibold block mb-1">Mensaje de error:</span>
                  <pre className="bg-[#212328] p-3 rounded-[8px] text-sm text-[#f87171] border border-[#ef4444]/20 whitespace-pre-wrap font-mono overflow-x-auto">
                    {endpointDetails.errorDetail}
                  </pre>
                </div>
              ) : (
                <div className="mb-6">
                  <span className="text-sm text-[#F0F0F0] font-semibold block mb-1">Cuerpo de la respuesta:</span>
                  <pre className="bg-[#212328] p-3 rounded-[8px] text-sm text-[#4ade80] border border-[#22c55e]/20 whitespace-pre-wrap font-mono overflow-x-auto">
                    {typeof endpointDetails.responseData === 'object' 
                      ? JSON.stringify(endpointDetails.responseData, null, 2) 
                      : endpointDetails.responseData}
                  </pre>
                </div>
              )}

              {/* Sección de Análisis de IA (Solo para errores) */}
              {endpointDetails.errorDetail && (
                <div className="bg-[#A64CCA]/10 border border-[#A64CCA]/30 rounded-[8px] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-[#d8a1f7] flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      Análisis Inteligente
                    </h4>
                    {!aiAnalysis && !analyzingAi && (
                      <button
                        onClick={() => analyzeErrorWithAI(endpointDetails)}
                        className="text-xs bg-[#A64CCA] hover:opacity-90 text-white px-3 py-1.5 rounded-[8px] font-semibold transition-all flex items-center gap-1.5 shadow-md"
                      >
                        <Sparkles className="w-3 h-3" />
                        ✨ Preguntar a Gemini
                      </button>
                    )}
                  </div>
                  
                  {analyzingAi && (
                    <div className="flex items-center gap-2 text-[#d8a1f7] font-semibold text-sm py-2">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Analizando el error con IA...
                    </div>
                  )}

                  {aiAnalysis && (
                    <div className="prose prose-invert prose-sm max-w-none text-[#F0F0F0] whitespace-pre-wrap leading-relaxed">
                      {aiAnalysis}
                    </div>
                  )}
                  
                  {!aiAnalysis && !analyzingAi && (
                    <p className="text-xs text-[#d8a1f7]/80">
                      ¿No estás seguro de por qué falló? Deja que la IA analice este error y te sugiera una solución.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#606060]/30 bg-[#212328] flex justify-end shrink-0">
              <button
                onClick={() => {
                  setEndpointDetails(null);
                  setAiAnalysis(null);
                }}
                className="px-4 py-2 bg-[#606060]/30 hover:bg-[#606060]/50 text-[#FFFFFF] rounded-[8px] text-sm font-bold transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Importar YAML */}
      {showYamlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#000000]/75 backdrop-blur-sm">
          <div className="bg-[#2D2634] border border-[#606060]/30 rounded-[8px] shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#606060]/30 bg-[#212328]">
              <h3 className="text-lg font-bold text-[#FFFFFF] flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#A64CCA]" />
                Pegar OpenAPI YAML
              </h3>
              <button 
                onClick={() => setShowYamlModal(false)}
                className="text-[#6E6E6E] hover:text-[#FFFFFF] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[#F0F0F0] mb-3 font-regular">Pega la definición de tu API en formato YAML (Swagger/OpenAPI) y la IA extraerá todos los endpoints automáticamente.</p>
              <textarea 
                value={yamlInput}
                onChange={(e) => setYamlInput(e.target.value)}
                placeholder={"openapi: 3.0.3\ninfo:\n  title: Mi API...\npaths:\n  /users:\n    get:\n..."}
                className="w-full h-64 bg-[#212328] text-[#FFFFFF] border border-[#606060]/30 rounded-[8px] p-3 font-mono text-sm focus:border-[#A64CCA] focus:ring-1 focus:ring-[#A64CCA] outline-none resize-none placeholder-[#6E6E6E]"
              />
            </div>
            <div className="px-5 py-4 border-t border-[#606060]/30 bg-[#212328] flex justify-end gap-3">
              <button
                onClick={() => setShowYamlModal(false)}
                className="px-4 py-2 bg-[#606060]/30 hover:bg-[#606060]/50 text-[#FFFFFF] rounded-[8px] text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={importEndpointsFromYaml}
                disabled={!yamlInput.trim()}
                className="px-4 py-2 bg-[#A64CCA] hover:opacity-90 disabled:opacity-50 text-white rounded-[8px] text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-[#A64CCA]/20"
              >
                <Sparkles className="w-4 h-4" />
                Interpretar y Agregar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
