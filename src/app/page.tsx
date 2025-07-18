"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import Image from "next/image";
import {
  CameraIcon,
  SendHorizonalIcon,
  SquareIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { motion } from "framer-motion";

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
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);
  const [chatHistory, setChatHistory] = useState<
    { sender: "user" | "bot"; text: string; image?: string }[]
  >([]);
  const [speakingIndex, setSpeakingIndex] = useState<number | null>(null);

  const inputFileRef = useRef<HTMLInputElement>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmitForm = (e: React.FormEvent) => {
    e.preventDefault();
    setShowChat(true);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setImage(e.target.files[0]);
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
        { sender: "bot", text: "Se detuvo la respuesta." },
      ]);
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
      formDataToSend.append("message", userMessage);
      if (image) formDataToSend.append("image", image);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: image ? undefined : { "Content-Type": "application/json" },
        body: image
          ? formDataToSend
          : JSON.stringify({ ...formData, message: userMessage }),
        signal: controller.signal,
      });

      const data = await res.json();
      setChatHistory((prev) => [...prev, { sender: "bot", text: data.reply }]);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error("Gemini Error:", err);
        setChatHistory((prev) => [
          ...prev,
          { sender: "bot", text: "Error al conectar con Gemini" },
        ]);
      }
    } finally {
      setLoading(false);
    }
  };

  const speakText = (text: string, index: number) => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      currentUtterance.current = null;
      setSpeakingIndex(null);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    currentUtterance.current = utterance;
    utterance.onend = () => setSpeakingIndex(null);
    setSpeakingIndex(index);
    speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    window.addEventListener("beforeunload", () => speechSynthesis.cancel());
    return () => speechSynthesis.cancel();
  }, []);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4 max-w-[430px] mx-auto">
      {!showChat ? (
        <form
          onSubmit={handleSubmitForm}
          className="w-full space-y-4 bg-white p-6 rounded-xl shadow"
        >
          <h2 className="text-2xl font-bold text-center">Datos del Usuario</h2>
          {["name", "age", "weight", "height"].map((field) => (
            <input
              key={field}
              type={field === "name" ? "text" : "number"}
              name={field}
              placeholder={
                field === "name"
                  ? "Nombre"
                  : field === "age"
                  ? "Edad"
                  : field === "weight"
                  ? "Peso (kg)"
                  : "Talla (cm)"
              }
              value={formData[field as keyof typeof formData]}
              onChange={handleChange}
              className="w-full p-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          ))}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-3 rounded-xl hover:bg-blue-700"
          >
            Siguiente
          </button>
        </form>
      ) : (
        <div className="w-full flex flex-col h-[90vh] bg-white p-4 rounded-xl shadow">
          <h2 className="text-xl font-semibold mb-3 text-center">
            Chat con NutriBot
          </h2>
          <div className="flex-1 overflow-y-auto space-y-2 px-1 mb-2">
            {chatHistory.map((msg, i) => (
              <div
                key={i}
                className={`rounded-2xl max-w-[85%] whitespace-pre-wrap flex items-start gap-2 p-3 ${
                  msg.sender === "user"
                    ? "bg-blue-100 self-end ml-auto text-right"
                    : "bg-gray-200 self-start mr-auto text-left"
                }`}
              >
                <div className="flex-1">
                  {msg.image && (
                    <Image
                      src={msg.image}
                      alt="imagen"
                      className="w-32 rounded mb-2 border"
                      width={128}
                      height={128}
                    />
                  )}
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
                {msg.sender === "bot" && (
                  <motion.button
                    whileTap={{ scale: 1.3 }}
                    onClick={() => speakText(msg.text, i)}
                    className="text-gray-600 hover:text-black"
                  >
                    {speakingIndex === i ? <VolumeXIcon /> : <Volume2Icon />}
                  </motion.button>
                )}
              </div>
            ))}
            {loading && (
              <div className="text-gray-400 text-center">
                NutriBot está escribiendo...
              </div>
            )}
          </div>
          {image && (
            <div className="mb-2 flex flex-col items-center">
              <Image
                src={URL.createObjectURL(image)}
                alt="preview"
                className="w-24 border rounded"
                width={96}
                height={96}
              />
              <button
                onClick={clearImage}
                className="text-sm text-red-500 hover:underline mt-1"
              >
                Quitar imagen
              </button>
            </div>
          )}
          {loading && (
            <button
              onClick={cancelResponse}
              className="text-sm text-red-600 hover:text-red-800 flex items-center gap-1 mb-2"
            >
              <SquareIcon className="w-4 h-4" /> Detener respuesta
            </button>
          )}

          <div className="flex items-center gap-2 mt-auto">
            <label className="text-gray-600 p-2 rounded-full border cursor-pointer">
              <CameraIcon className="w-5 h-5" />
              <input
                ref={inputFileRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Escribe un mensaje..."
              className="flex-1 p-2 border rounded-xl focus:outline-none"
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
              className="bg-green-600 text-white p-2 rounded-full hover:bg-green-700 disabled:opacity-50"
            >
              <SendHorizonalIcon className="w-5 h-5" />
            </button>
          </div>
          <p className="text-[10px] text-center text-gray-500 mt-2">
            ⚠️ Esta IA puede cometer errores. Verifica la información
            importante.
          </p>
        </div>
      )}
    </main>
  );
}
