"use client";

import { useState, useRef, useEffect } from "react";
import { 
  Camera, 
  Send, 
  Square, 
  Volume2, 
  VolumeX,
  RefreshCw,
  User,
  Bot
} from "lucide-react";
import Image from "next/image";

// Tipo para los mensajes del chat
interface ChatMessage {
  sender: "user" | "bot";
  text: string;
  image?: string;
  timestamp: number;
}

// Tipo para los datos del usuario
interface UserData {
  name: string;
  age: string;
  weight: string;
  height: string;
}

// Componente para renderizar markdown simple
const SimpleMarkdown = ({ children }: { children: string }) => {
  const formatText = (text: string) => {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br/>');
  };

  return (
    <div 
      className="markdown-content"
      dangerouslySetInnerHTML={{ 
        __html: `<p>${formatText(children)}</p>` 
      }}
    />
  );
};

export default function NutriBot() {
  const [formData, setFormData] = useState<UserData>({
    name: "",
    age: "",
    weight: "",
    height: "",
  });
  
  const [showChat, setShowChat] = useState(false);
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);
  const [sessionId] = useState(() => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`);

  const inputFileRef = useRef<HTMLInputElement>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Scroll automático al último mensaje
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, loading]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowChat(true);
    // Mensaje de bienvenida
    setChatHistory([
      {
        sender: "bot",
        text: `¡Hola ${formData.name}! 👋 Soy Dr. NutriBot, tu asistente nutricional personalizado. He registrado tus datos y estoy listo para ayudarte con todas tus dudas sobre nutrición, alimentación y salud. ¿En qué puedo ayudarte hoy?`,
        timestamp: Date.now(),
      },
    ]);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      // Validar tamaño (máximo 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert("La imagen es demasiado grande. Máximo 5MB.");
        return;
      }
      setImage(file);
    }
  };

  const clearImage = () => {
    setImage(null);
    if (inputFileRef.current) inputFileRef.current.value = "";
  };

  const cancelResponse = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
      setChatHistory((prev) => [
        ...prev,
        { 
          sender: "bot", 
          text: "⏹️ Respuesta detenida por el usuario.",
          timestamp: Date.now()
        },
      ]);
    }
  };

  const sendMessage = async () => {
    if ((!message.trim() && !image) || loading) return;

    const userMessage = message.trim();
    const imageUrl = image ? URL.createObjectURL(image) : undefined;
    
    // Agregar mensaje del usuario
    setChatHistory(prev => [
      ...prev,
      { 
        sender: "user", 
        text: userMessage || "📷 Imagen enviada", 
        image: imageUrl,
        timestamp: Date.now()
      },
    ]);

    // Limpiar inputs
    setMessage("");
    const imageToSend = image;
    setImage(null);
    if (inputFileRef.current) inputFileRef.current.value = "";

    // Configurar abort controller
    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("name", formData.name);
      formDataToSend.append("age", formData.age);
      formDataToSend.append("weight", formData.weight);
      formDataToSend.append("height", formData.height);
      formDataToSend.append("message", userMessage);
      formDataToSend.append("sessionId", sessionId);
      
      if (imageToSend) {
        formDataToSend.append("image", imageToSend);
      }

      const res = await fetch("/api/chat", {
        method: "POST",
        body: formDataToSend,
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP Error: ${res.status}`);
      }

      const data = await res.json();
      
      setChatHistory((prev) => [
        ...prev, 
        { 
          sender: "bot", 
          text: data.reply || "No recibí una respuesta clara. ¿Puedes reformular tu pregunta?",
          timestamp: Date.now()
        }
      ]);

    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Error en el chat:", err);
        setChatHistory((prev) => [
          ...prev,
          { 
            sender: "bot", 
            text: "❌ Lo siento, hubo un error al procesar tu mensaje. Por favor, inténtalo nuevamente.",
            timestamp: Date.now()
          },
        ]);
      }
    } finally {
      setLoading(false);
      setAbortController(null);
    }
  };

  const speakText = (text: string, index: number) => {
    // Si ya está hablando, detener
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      currentUtterance.current = null;
      setSpeakingIndex(null);
      return;
    }

    // Limpiar el texto de markdown para speech
    const cleanText = text
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/[#*`]/g, '')
      .replace(/\n/g, '. ');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'es-ES';
    utterance.rate = 0.9;
    
    currentUtterance.current = utterance;
    utterance.onend = () => {
      setSpeakingIndex(null);
      currentUtterance.current = null;
    };
    
    utterance.onerror = () => {
      setSpeakingIndex(null);
      currentUtterance.current = null;
    };
    
    setSpeakingIndex(index);
    speechSynthesis.speak(utterance);
  };

  const resetChat = () => {
    if (window.confirm("¿Estás seguro de que quieres reiniciar el chat? Se perderán todos los mensajes.")) {
      setChatHistory([
        {
          sender: "bot",
          text: `¡Hola de nuevo ${formData.name}! 👋 He reiniciado nuestra conversación. ¿En qué puedo ayudarte ahora?`,
          timestamp: Date.now(),
        },
      ]);
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }
      setSpeakingIndex(null);
    }
  };

  // Cleanup al desmontar el componente
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (speechSynthesis.speaking) {
        speechSynthesis.cancel();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      handleBeforeUnload();
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  const inputFields = [
    { name: "name", type: "text", placeholder: "Nombre completo", icon: "👤" },
    { name: "age", type: "number", placeholder: "Edad (años)", icon: "🎂" },
    { name: "weight", type: "number", placeholder: "Peso (kg)", icon: "⚖️" },
    { name: "height", type: "number", placeholder: "Estatura (cm)", icon: "📏" },
  ];

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-green-50 to-blue-50 p-4 max-w-[430px] mx-auto">
      {!showChat ? (
        <div className="w-full space-y-6">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center text-3xl">
              🥗
            </div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">NutriBot</h1>
            <p className="text-gray-600">Tu asistente nutricional personalizado</p>
          </div>

          {/* Form */}
          <div
            onSubmit={handleSubmitForm}
            className="w-full space-y-4 bg-white p-6 rounded-2xl shadow-lg border border-gray-100"
          >
            <h2 className="text-xl font-semibold text-center text-gray-800 mb-4">
              Cuéntanos sobre ti
            </h2>
            
            {inputFields.map((field) => (
              <div key={field.name} className="relative">
                <span className="absolute left-3 top-3 text-lg">{field.icon}</span>
                <input
                  type={field.type}
                  name={field.name}
                  placeholder={field.placeholder}
                  value={formData[field.name as keyof UserData]}
                  onChange={handleChange}
                  className="w-full pl-12 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
                  required
                  min={field.type === "number" ? "1" : undefined}
                />
              </div>
            ))}
            
            <button
              type="button"
              onClick={handleSubmitForm}
              className="w-full bg-gradient-to-r from-green-500 to-blue-500 text-white py-3 rounded-xl hover:from-green-600 hover:to-blue-600 transition-all transform hover:scale-[1.02] font-medium"
            >
              Comenzar Chat 💬
            </button>
          </div>

          <p className="text-xs text-center text-gray-500 px-4">
            Tu información se usa solo para personalizar las recomendaciones nutricionales
          </p>
        </div>
      ) : (
        <div className="w-full flex flex-col h-[calc(100dvh-2rem)] bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
          {/* Header del chat */}
          <div className="bg-gradient-to-r from-green-500 to-blue-500 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center text-lg">
                🤖
              </div>
              <div>
                <h2 className="font-semibold">Dr. NutriBot</h2>
                <p className="text-xs opacity-90">Nutricionista IA</p>
              </div>
            </div>
            <button
              onClick={resetChat}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="Reiniciar chat"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          {/* Área de mensajes */}
          <div 
            ref={chatContainerRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50"
          >
            {chatHistory.map((msg, i) => (
              <div
                key={`${msg.timestamp}-${i}`}
                className={`flex gap-2 ${
                  msg.sender === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.sender === "bot" && (
                  <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}
                
                <div className="relative group max-w-[80%]">
                  <div
                    className={`rounded-2xl p-3 text-sm shadow-sm ${
                      msg.sender === "user"
                        ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-br-md"
                        : "bg-white text-gray-800 rounded-bl-md border border-gray-100"
                    }`}
                  >
                    {msg.image && (
                      <Image
                        src={msg.image}
                        alt="Imagen enviada"
                        className="w-full max-w-[200px] h-auto rounded-xl mb-2 border border-gray-200"
                        width={200}
                        height={200}
                      />
                    )}
                    
                    {msg.sender === "bot" ? (
                      <SimpleMarkdown>{msg.text}</SimpleMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    )}
                  </div>
                  
                  {msg.sender === "bot" && (
                    <button
                      onClick={() => speakText(msg.text, i)}
                      className="absolute -right-8 top-2 opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-blue-500 transition-all"
                      title="Leer en voz alta"
                    >
                      {speakingIndex === i ? (
                        <VolumeX className="w-4 h-4" />
                      ) : (
                        <Volume2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </div>
                
                {msg.sender === "user" && (
                  <div className="w-8 h-8 bg-gray-300 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                    <User className="w-4 h-4 text-gray-600" />
                  </div>
                )}
              </div>
            ))}
            
            {loading && (
              <div className="flex justify-start gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-white p-3 rounded-2xl rounded-bl-md border border-gray-100 shadow-sm">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Preview de imagen */}
          {image && (
            <div className="p-3 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <Image
                  src={URL.createObjectURL(image)}
                  alt="Vista previa"
                  className="w-12 h-12 object-cover rounded-lg border border-gray-200"
                  width={12}
                  height={12}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-700">{image.name}</p>
                  <p className="text-xs text-gray-500">
                    {(image.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <button
                  onClick={clearImage}
                  className="text-red-500 hover:text-red-700 text-sm font-medium"
                >
                  Quitar
                </button>
              </div>
            </div>
          )}

          {/* Botón cancelar */}
          {loading && (
            <div className="p-3 border-t border-gray-200 bg-yellow-50">
              <button
                onClick={cancelResponse}
                className="flex items-center gap-2 text-sm text-red-600 hover:text-red-800 font-medium"
              >
                <Square className="w-4 h-4" />
                Detener respuesta
              </button>
            </div>
          )}

          {/* Input area */}
          <div className="p-4 border-t border-gray-200 bg-white">
            <div className="flex items-end gap-2">
              <label className="p-2 text-gray-500 hover:text-blue-500 cursor-pointer transition-colors">
                <Camera className="w-5 h-5" />
                <input
                  ref={inputFileRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="hidden"
                />
              </label>
              
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Pregúntame sobre nutrición..."
                  className="w-full p-3 pr-12 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  disabled={loading}
                />
              </div>
              
              <button
                onClick={sendMessage}
                disabled={loading || (!message.trim() && !image)}
                className="p-3 bg-gradient-to-r from-green-500 to-blue-500 text-white rounded-xl hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-105"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-xs text-center text-gray-500 mt-2">
              ⚠️ Esta IA puede cometer errores. Verifica información importante con un profesional.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}