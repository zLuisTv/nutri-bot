import { NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";

// Tipos más estrictos para mejor control
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

interface ConversationHistory {
  role: "user" | "model";
  parts: Part[];
}

interface Conversation {
  _id?: ObjectId;
  sessionId: string;
  userInfo: {
    name: string;
    age: string;
    weight: string;
    height: string;
  };
  history: ConversationHistory[];
  createdAt: Date;
  updatedAt: Date;
}

interface RequestBody {
  message: string;
  name: string;
  age: string;
  weight: string;
  height: string;
  sessionId: string;
}

// Tipo para los datos de entrada sin sanitizar
interface UnsanitizedData {
  message?: unknown;
  name?: unknown;
  age?: unknown;
  weight?: unknown;
  height?: unknown;
  sessionId?: unknown;
}

// Variables de entorno con validación
const uri = process.env.MONGODB_URI;
const apiKey = process.env.GEMINI_API_KEY;

if (!uri) {
  throw new Error("MONGODB_URI no está definida en las variables de entorno");
}
if (!apiKey) {
  throw new Error("GEMINI_API_KEY no está definida en las variables de entorno");
}

// Configuración de MongoDB
const dbName = "nutribot_db";
const collectionName = "conversations";

// Función helper para calcular IMC y generar contexto nutricional
const generateNutritionalContext = (age: string, weight: string, height: string): string => {
  const weightNum = parseFloat(weight);
  const heightNum = parseFloat(height) / 100; // convertir cm a metros
  
  const imc = weightNum / (heightNum * heightNum);
  let imcCategory = "";
  let recommendations = "";

  if (imc < 18.5) {
    imcCategory = "Bajo peso";
    recommendations = "Se recomienda aumentar la ingesta calórica con alimentos nutritivos.";
  } else if (imc >= 18.5 && imc < 25) {
    imcCategory = "Peso normal";
    recommendations = "Mantener una dieta equilibrada y actividad física regular.";
  } else if (imc >= 25 && imc < 30) {
    imcCategory = "Sobrepeso";
    recommendations = "Se recomienda reducir calorías y aumentar la actividad física.";
  } else {
    imcCategory = "Obesidad";
    recommendations = "Es importante consultar con un profesional y seguir un plan nutricional estructurado.";
  }

  return `IMC calculado: ${imc.toFixed(1)} (${imcCategory}). ${recommendations}`;
};

// Función para limpiar y validar datos de entrada - CORREGIDA
const sanitizeInput = (data: UnsanitizedData): RequestBody => {
  return {
    message: String(data.message || "").trim(),
    name: String(data.name || "").trim(),
    age: String(data.age || "").trim(),
    weight: String(data.weight || "").trim(),
    height: String(data.height || "").trim(),
    sessionId: String(data.sessionId || `session_${Date.now()}`).trim(),
  };
};

// Función para crear el prompt del sistema personalizado
const createSystemPrompt = (userData: Omit<RequestBody, 'message' | 'sessionId'>): string => {
  const nutritionalContext = generateNutritionalContext(userData.age, userData.weight, userData.height);
  
  return `Eres el Dr. NutriBot, un nutricionista experto y empático especializado en brindar consejos nutricionales personalizados.

DATOS DEL PACIENTE:
- Nombre: ${userData.name}
- Edad: ${userData.age} años
- Peso: ${userData.weight} kg
- Estatura: ${userData.height} cm
- ${nutritionalContext}

INSTRUCCIONES IMPORTANTES:
1. Siempre mantén el foco en nutrición, alimentación saludable y bienestar
2. Proporciona consejos prácticos y personalizados basados en los datos del paciente
3. Usa un tono profesional pero amigable y comprensible
4. Si te preguntan sobre temas no relacionados con nutrición, redirige amablemente hacia temas nutricionales
5. Nunca diagnostiques enfermedades, solo brinda consejos nutricionales generales
6. Si detectas una situación que requiere atención médica urgente, recomienda consultar a un profesional
7. Sé conciso pero informativo - evita respuestas demasiado largas a menos que se solicite información detallada
8. Incluye consejos prácticos que el paciente pueda implementar fácilmente
9. Considera la edad del paciente para ajustar las recomendaciones apropiadamente

Recuerda: Tu objetivo es educar y motivar hacia hábitos alimentarios más saludables de manera personalizada.`;
};

// Función principal del endpoint
export async function POST(req: Request) {
  let dbClient: MongoClient | null = null;
  
  try {
    const contentType = req.headers.get("content-type") || "";
    let requestData: RequestBody;
    let base64Image = "";
    let mimeType = "";

    // Procesamiento de datos según el tipo de contenido
    if (contentType.includes("application/json")) {
      const body: UnsanitizedData = await req.json();
      requestData = sanitizeInput(body);
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const formData: UnsanitizedData = {
        message: form.get("message"),
        name: form.get("name"),
        age: form.get("age"),
        weight: form.get("weight"),
        height: form.get("height"),
        sessionId: form.get("sessionId"),
      };
      requestData = sanitizeInput(formData);

      // Procesamiento de imagen
      const image = form.get("image") as File;
      if (image && image instanceof Blob && image.size > 0) {
        // Validar tamaño de imagen (máximo 10MB)
        if (image.size > 10 * 1024 * 1024) {
          return NextResponse.json(
            { reply: "❌ La imagen es demasiado grande. Tamaño máximo: 10MB." },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await image.arrayBuffer());
        base64Image = buffer.toString("base64");
        mimeType = image.type || "image/jpeg";
      }
    } else {
      return NextResponse.json(
        { reply: "❌ Tipo de contenido no soportado." },
        { status: 400 }
      );
    }

    // Validación de datos requeridos
    if (!requestData.message && !base64Image) {
      return NextResponse.json(
        { reply: "Por favor, envía un mensaje o una imagen." },
        { status: 400 }
      );
    }

    if (!requestData.name || !requestData.age || !requestData.weight || !requestData.height) {
      return NextResponse.json(
        { reply: "❌ Faltan datos del usuario. Por favor, completa toda la información." },
        { status: 400 }
      );
    }

    // Conexión a MongoDB
    dbClient = new MongoClient(uri as string);
    await dbClient.connect();
    const db = dbClient.db(dbName);
    const collection = db.collection<Conversation>(collectionName);

    // Buscar conversación existente
    let conversation = await collection.findOne({ sessionId: requestData.sessionId });
    
    if (!conversation) {
      // Crear nueva conversación con prompt del sistema
      const systemPrompt = createSystemPrompt(requestData);
      conversation = {
        _id: new ObjectId(),
        sessionId: requestData.sessionId,
        userInfo: {
          name: requestData.name,
          age: requestData.age,
          weight: requestData.weight,
          height: requestData.height,
        },
        history: [
          {
            role: "user",
            parts: [{ text: systemPrompt }]
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      await collection.insertOne(conversation);
    }

    // Preparar el mensaje del usuario
    const userMessage = requestData.message || "He enviado una imagen, por favor analízala desde una perspectiva nutricional.";
    const parts: Part[] = [{ text: `Consulta nutricional: ${userMessage}` }];
    
    if (base64Image) {
      parts.push({
        inlineData: {
          mimeType,
          data: base64Image,
        },
      });
    }

    // Agregar mensaje del usuario al historial
    const updatedHistory = [
      ...conversation.history,
      { role: "user" as const, parts }
    ];

    // Llamada a la API de Gemini
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: updatedHistory,
          generationConfig: {
            temperature: 0.7,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1024,
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
          ]
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.json().catch(() => ({}));
      console.error("Error de Gemini API:", errorData);
      
      let errorMessage = "❌ Error al procesar tu consulta nutricional.";
      if (geminiResponse.status === 429) {
        errorMessage = "⏳ El servicio está temporalmente ocupado. Intenta nuevamente en unos momentos.";
      } else if (geminiResponse.status === 400) {
        errorMessage = "❌ Error en el formato de la consulta. Por favor, reformula tu pregunta.";
      }
      
      return NextResponse.json({ reply: errorMessage }, { status: geminiResponse.status });
    }

    const geminiData = await geminiResponse.json();
    
    // Extraer respuesta de Gemini
    let botReply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!botReply) {
      botReply = "Lo siento, no pude generar una respuesta clara. ¿Podrías reformular tu pregunta nutricional?";
    }

    // Actualizar conversación en MongoDB
    const finalHistory = [
      ...updatedHistory,
      { role: "model" as const, parts: [{ text: botReply }] }
    ];

    await collection.updateOne(
      { sessionId: requestData.sessionId },
      {
        $set: {
          history: finalHistory,
          updatedAt: new Date(),
        }
      }
    );

    // Respuesta exitosa
    return NextResponse.json({
      reply: botReply,
      sessionId: requestData.sessionId,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Error en el endpoint de chat:", error);
    
    let errorMessage = "❌ Error interno del servidor. Por favor, intenta nuevamente.";
    
    if (error instanceof Error) {
      if (error.message.includes("fetch")) {
        errorMessage = "🌐 Error de conectividad. Verifica tu conexión a internet.";
      } else if (error.message.includes("MongoDB") || error.message.includes("mongo")) {
        errorMessage = "💾 Error de base de datos. Intenta nuevamente en unos momentos.";
      }
    }
    
    return NextResponse.json(
      { 
        reply: errorMessage,
        error: process.env.NODE_ENV === "development" ? error?.toString() : undefined
      },
      { status: 500 }
    );
  } finally {
    // Cerrar conexión de MongoDB
    if (dbClient) {
      try {
        await dbClient.close();
      } catch (closeError) {
        console.error("Error al cerrar conexión MongoDB:", closeError);
      }
    }
  }
}

// Endpoint GET para obtener el historial de conversación (opcional)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  
  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId es requerido" },
      { status: 400 }
    );
  }

  let dbClient: MongoClient | null = null;

  try {
    dbClient = new MongoClient(uri as string);
    await dbClient.connect();
    const db = dbClient.db(dbName);
    const collection = db.collection<Conversation>(collectionName);

    const conversation = await collection.findOne({ sessionId });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversación no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      sessionId: conversation.sessionId,
      userInfo: conversation.userInfo,
      messageCount: conversation.history.length,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    });

  } catch (error) {
    console.error("Error al obtener historial:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  } finally {
    if (dbClient) {
      await dbClient.close();
    }
  }
} 