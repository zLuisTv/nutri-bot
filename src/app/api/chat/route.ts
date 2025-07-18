// Esta versión mejora los logs y el manejo de errores para identificar por qué falla en producción

import { NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";

// Define tipos seguros para las partes del contenido
type GeminiTextPart = {
  text: string;
};

type GeminiImagePart = {
  inlineData: {
    mimeType: string;
    data: string;
  };
};

type Part = GeminiTextPart | GeminiImagePart;

interface Conversation {
  _id?: ObjectId;
  sessionId: string;
  history: {
    role: string;
    parts: Part[];
  }[];
}

const uri = process.env.MONGODB_URI;
const apiKey = process.env.GEMINI_API_KEY;

if (!uri) throw new Error("Falta MONGODB_URI");
if (!apiKey) throw new Error("Falta GEMINI_API_KEY");

const client = new MongoClient(uri);
const dbName = "chatdb";
const collectionName = "conversations";

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";

  let message = "";
  let name = "";
  let age = "";
  let weight = "";
  let height = "";
  let base64Image = "";
  let mimeType = "";
  let sessionId = "default";

  try {
    if (contentType.includes("application/json")) {
      const body = await req.json();
      ({ message, name, age, weight, height, sessionId } = body);
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      message = form.get("message") as string;
      name = form.get("name") as string;
      age = form.get("age") as string;
      weight = form.get("weight") as string;
      height = form.get("height") as string;
      sessionId = (form.get("sessionId") as string) || "default";
      const image = form.get("image") as File;

      if (image && image instanceof Blob) {
        const buffer = Buffer.from(await image.arrayBuffer());
        base64Image = buffer.toString("base64");
        mimeType = image.type || "image/jpeg";
      }
    } else {
      return NextResponse.json(
        { reply: "Unsupported content type" },
        { status: 400 }
      );
    }

    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection<Conversation>(collectionName);

    await collection.deleteOne({ sessionId });

    const systemPrompt = `Eres un nutricionista experto llamado 'Dr. NutriBot'. No repitas siempre lo mismo, tus respuestas siempre deben estar enfocadas en brindar consejos sobre nutrición, alimentos, beneficios de las comidas, calorías, proteínas, vitaminas y cómo impactan en la salud.\n\nDatos del cliente:\n- Nombre: ${name}\n- Edad: ${age} años\n- Peso: ${weight} kg\n- Estatura: ${height} cm\n\nSolo brinda información detallada si es necesaria o si el cliente lo solicita, no envies demasiado texto.\nRecuerda mantener el enfoque nutricional incluso si las preguntas cambian de tema.`;

    const conversationHistory: Conversation = {
      sessionId,
      history: [{ role: "user", parts: [{ text: systemPrompt }] }],
    };
    await collection.insertOne(conversationHistory);

    const userPrompt = `Consulta: ${message}`;
    const parts: Part[] = [{ text: userPrompt }];
    if (base64Image) {
      parts.push({
        inlineData: {
          mimeType,
          data: base64Image,
        },
      });
    }

    conversationHistory.history.push({ role: "user", parts });

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: new Headers({
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey ?? "",
        }),
        body: JSON.stringify({ contents: conversationHistory.history }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Gemini API error:", data);
      throw new Error(
        data?.error?.message || "Error en la respuesta de Gemini"
      );
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sin respuesta clara.";

    try {
      await collection.updateOne(
        { sessionId },
        {
          $set: {
            history: conversationHistory.history.concat({
              role: "model",
              parts: [{ text: reply }],
            }),
          },
        }
      );
    } catch (mongoErr) {
      console.error("Error al guardar en MongoDB:", mongoErr);
    }

    return NextResponse.json({ reply, image: base64Image || null });
  } catch (err) {
    console.error("Error general:", err);
    return NextResponse.json({
      reply: "Error al procesar la solicitud con NutriBot.",
    });
  } finally {
    await client.close();
  }
}
