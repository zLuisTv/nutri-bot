"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

import Image from "next/image";

export default function Home() {
  const [formData, setFormData] = useState({
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
  const [chatHistory, setChatHistory] = useState<
    { sender: "user" | "bot"; text: string; image?: string }[]
  >([]);

  const inputFileRef = useRef<HTMLInputElement>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowChat(true);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setImage(e.target.files[0]);
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
      const cancelText = "Se detuvo la respuesta.";
      setChatHistory((prev) => [...prev, { sender: "bot", text: cancelText }]);
    }
  };

  const sendMessage = async () => {
    if (!message.trim() && !image) return;

    const userMessage = message;
    const imageUrl = image ? URL.createObjectURL(image) : undefined;
    setChatHistory([
      ...chatHistory,
      { sender: "user", text: userMessage, image: imageUrl },
    ]);

    setMessage("");
    setImage(null);
    if (inputFileRef.current) inputFileRef.current.value = "";

    const controller = new AbortController();
    setAbortController(controller);
    setLoading(true);

    try {
      const formDataToSend = new FormData();
      formDataToSend.append("name", formData.name);
      formDataToSend.append("age", formData.age);
      formDataToSend.append("weight", formData.weight);
      formDataToSend.append("height", formData.height);
      formDataToSend.append("message", message);
      if (image) formDataToSend.append("image", image);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: image ? undefined : { "Content-Type": "application/json" },
        body: image ? formDataToSend : JSON.stringify({ ...formData, message: userMessage }),
        signal: controller.signal,
      });

      const data = await res.json();
      setChatHistory((prev) => [...prev, { sender: "bot", text: data.reply }]);
    } catch (err) {
       if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Gemini Error:", err);
        const errorText = "Error al conectar con Gemini";
        setChatHistory((prev) => [...prev, { sender: "bot", text: errorText }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const speakText = (text: string) => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      currentUtterance.current = null;
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance.current = utterance;
    speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    window.addEventListener("beforeunload", () => {
      speechSynthesis.cancel();
    });

    return () => {
      speechSynthesis.cancel();
      currentUtterance.current = null;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-100">
      {!showChat ? (
        <form
          onSubmit={handleSubmitForm}
          className="space-y-4 w-full max-w-sm bg-white p-6 rounded shadow"
        >
          <h2 className="text-xl font-semibold">Datos del Usuario</h2>
          <input
            type="text"
            name="name"
            placeholder="Nombre"
            value={formData.name}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
          <input
            type="number"
            name="age"
            placeholder="Edad"
            value={formData.age}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
          <input
            type="number"
            name="weight"
            placeholder="Peso (kg)"
            value={formData.weight}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
          <input
            type="number"
            name="height"
            placeholder="Talla (cm)"
            value={formData.height}
            onChange={handleChange}
            className="w-full p-2 border rounded"
            required
          />
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Siguiente
          </button>
        </form>
      ) : (
        <div className="w-full max-w-md bg-white p-4 rounded shadow flex flex-col h-[80vh]">
          <h2 className="text-xl font-semibold mb-4">Chat con NutriBot</h2>
          <div className="flex-1 overflow-y-auto space-y-2 mb-4">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`p-2 rounded max-w-[80%] whitespace-pre-wrap flex items-start gap-2 ${
                  msg.sender === "user"
                    ? "bg-blue-100 self-end text-right ml-auto"
                    : "bg-gray-200 self-start text-left mr-auto"
                }`}
              >
                <div className="flex-1">
                  {msg.image && (
                    <Image
                      src={msg.image}
                      alt="imagen"
                      className="w-32 h-auto rounded mb-2 border"
                      width={200}
                      height={200}
                    />
                  )}
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                {msg.sender === "bot" && (
                  <button
                    onClick={() => speakText(msg.text)}
                    className="text-gray-600 hover:text-gray-800"
                    title="Escuchar"
                  >
                    🔊
                  </button>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-gray-400">NutriBot está escribiendo...</div>
            )}
          </div>
          {image && (
            <div className="mb-2 flex flex-col items-center">
              <Image
                src={URL.createObjectURL(image)}
                alt="Previsualización"
                className="w-24 h-auto rounded border mx-auto"
                width={50}
                height={50}
              />
              <button
                onClick={clearImage}
                className="text-xs text-red-600 mt-1 hover:underline"
              >
                Quitar imagen
              </button>
            </div>
          )}
          {loading && (
            <button
              onClick={cancelResponse}
              className="text-lg rounded mt-2 hover:underline w-24 h-6 border mr-6 mb-3"
            >
              ■ Detener
            </button>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe tu consulta..."
              className="flex-1 p-2 border rounded"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button
              onClick={sendMessage}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? "..." : "Enviar"}
            </button>
            <label className="w-1/5 bg-gray-100 text-lg border border-gray-300 rounded px-2 py-1 cursor-pointer text-center self-center">
              Foto
              <input
                ref={inputFileRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
          </div>
        </div>
      )}
    </main>
  );
}
