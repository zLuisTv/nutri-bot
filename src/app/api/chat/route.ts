import { NextResponse } from "next/server";
import { MongoClient, ObjectId } from "mongodb";
import { z } from "zod";

// 1. CONNECTION POOLING - Singleton para MongoDB
class DatabaseConnection {
  private static instance: MongoClient | null = null;
  private static isConnecting: boolean = false;

  static async getInstance(): Promise<MongoClient> {
    // Usar .isConnected() ya no es válido, así que comprobamos si el cliente está conectado usando .db() y un ping
    if (this.instance) {
      try {
        // Si el cliente responde al ping, está conectado
        await this.instance.db().command({ ping: 1 });
        return this.instance;
      } catch {
        // Si falla el ping, se crea una nueva instancia
        this.instance = null;
      }
    }

    if (this.isConnecting) {
      // Esperar a que termine la conexión en curso
      while (this.isConnecting) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return this.instance!;
    }

    this.isConnecting = true;

    try {
      const uri = process.env.MONGODB_URI;
      if (!uri) {
        throw new Error(
          "MONGODB_URI no está definida en las variables de entorno"
        );
      }

      this.instance = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        // bufferMaxEntries: 0,
        maxIdleTimeMS: 30000,
      });

      await this.instance.connect();
      console.log("✅ Conexión MongoDB establecida");

      // Manejar eventos de conexión
      this.instance.on("close", () => {
        console.log("⚠️ Conexión MongoDB cerrada");
        this.instance = null;
      });

      this.instance.on("error", (error) => {
        console.error("❌ Error en conexión MongoDB:", error);
        this.instance = null;
      });

      return this.instance;
    } finally {
      this.isConnecting = false;
    }
  }

  static async closeConnection() {
    if (this.instance) {
      await this.instance.close();
      this.instance = null;
    }
  }
}

// 2. RATE LIMITING - Simple en memoria (para producción usar Redis)
class RateLimiter {
  private static requests: Map<string, { count: number; resetTime: number }> =
    new Map();
  private static readonly MAX_REQUESTS = 50;
  private static readonly WINDOW_MS = 60 * 60 * 1000; // 1 hora

  static isAllowed(identifier: string): {
    allowed: boolean;
    resetTime?: number;
  } {
    const now = Date.now();
    const record = this.requests.get(identifier);

    if (!record || now > record.resetTime) {
      // Nueva ventana de tiempo
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.WINDOW_MS,
      });
      return { allowed: true };
    }

    if (record.count >= this.MAX_REQUESTS) {
      return { allowed: false, resetTime: record.resetTime };
    }

    // Incrementar contador
    record.count++;
    this.requests.set(identifier, record);
    return { allowed: true };
  }

  static cleanup() {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

// Cleanup periódico cada 5 minutos
setInterval(() => {
  RateLimiter.cleanup();
}, 5 * 60 * 1000);

// 3. INPUT VALIDATION con Zod
const UserDataSchema = z.object({
  name: z
    .string()
    .min(2, "Nombre debe tener al menos 2 caracteres")
    .max(100, "Nombre demasiado largo")
    .regex(/^[a-zA-ZáéíóúÁÉÍÓÚñÑ\s]+$/, "Nombre contiene caracteres inválidos"),
  age: z
    .string()
    .regex(/^\d+$/, "Edad debe ser numérica")
    .transform((val) => parseInt(val))
    .refine(
      (val) => val >= 1 && val <= 120,
      "Edad debe estar entre 1 y 120 años"
    ),
  weight: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Peso debe ser numérico")
    .transform((val) => parseFloat(val))
    .refine(
      (val) => val >= 20 && val <= 300,
      "Peso debe estar entre 20 y 300 kg"
    ),
  height: z
    .string()
    .regex(/^\d+$/, "Altura debe ser numérica")
    .transform((val) => parseInt(val))
    .refine(
      (val) => val >= 100 && val <= 250,
      "Altura debe estar entre 100 y 250 cm"
    ),
});

const RequestBodySchema = z
  .object({
    message: z
      .string()
      .max(2000, "Mensaje demasiado largo")
      .optional()
      .transform((val) => val?.trim() || ""),
    sessionId: z
      .string()
      .min(1, "SessionId requerido")
      .max(100, "SessionId demasiado largo")
      .regex(/^[a-zA-Z0-9_-]+$/, "SessionId contiene caracteres inválidos"),
  })
  .merge(UserDataSchema);

// Tipos mejorados
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
    age: number;
    weight: number;
    height: number;
  };
  history: ConversationHistory[];
  createdAt: Date;
  updatedAt: Date;
}

// Validación de variables de entorno
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error(
    "GEMINI_API_KEY no está definida en las variables de entorno"
  );
}

// Configuración de MongoDB
const dbName = "nutribot_db";
const collectionName = "conversations";

// Helper functions (sin cambios significativos)
const generateNutritionalContext = (
  age: number,
  weight: number,
  height: number
): string => {
  const heightNum = height / 100; // convertir cm a metros
  const imc = weight / (heightNum * heightNum);
  let imcCategory = "";
  let recommendations = "";

  if (imc < 18.5) {
    imcCategory = "Bajo peso";
    recommendations =
      "Se recomienda aumentar la ingesta calórica con alimentos nutritivos.";
  } else if (imc >= 18.5 && imc < 25) {
    imcCategory = "Peso normal";
    recommendations =
      "Mantener una dieta equilibrada y actividad física regular.";
  } else if (imc >= 25 && imc < 30) {
    imcCategory = "Sobrepeso";
    recommendations =
      "Se recomienda reducir calorías y aumentar la actividad física.";
  } else {
    imcCategory = "Obesidad";
    recommendations =
      "Es importante consultar con un profesional y seguir un plan nutricional estructurado.";
  }

  return `IMC calculado: ${imc.toFixed(
    1
  )} (${imcCategory}). ${recommendations}`;
};

const createSystemPrompt = (userData: {
  name: string;
  age: number;
  weight: number;
  height: number;
}): string => {
  const nutritionalContext = generateNutritionalContext(
    userData.age,
    userData.weight,
    userData.height
  );

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

// Función para obtener IP del cliente
const getClientIP = (req: Request): string => {
  const forwarded = req.headers.get("x-forwarded-for");
  const realIP = req.headers.get("x-real-ip");
  const cloudflareIP = req.headers.get("cf-connecting-ip");

  if (cloudflareIP) return cloudflareIP;
  if (realIP) return realIP;
  if (forwarded) return forwarded.split(",")[0].trim();

  return "unknown";
};

// Función principal del endpoint POST
export async function POST(req: Request) {
  let dbClient: MongoClient | null = null;

  try {
    // 1. RATE LIMITING
    const clientIP = getClientIP(req);
    const rateLimitResult = RateLimiter.isAllowed(clientIP);

    if (!rateLimitResult.allowed) {
      const resetDate = new Date(rateLimitResult.resetTime!);
      return NextResponse.json(
        {
          reply:
            "⏰ Has superado el límite de mensajes por hora. Intenta más tarde.",
          resetTime: resetDate.toISOString(),
        },
        {
          status: 429,
          headers: {
            "Retry-After": Math.ceil(
              (rateLimitResult.resetTime! - Date.now()) / 1000
            ).toString(),
            "X-RateLimit-Limit": "50",
            "X-RateLimit-Reset": resetDate.toISOString(),
          },
        }
      );
    }

    // Obtener datos de la request
    const contentType = req.headers.get("content-type") || "";
    let requestData: z.infer<typeof RequestBodySchema>;
    let base64Image = "";
    let mimeType = "";

    // Procesamiento de datos según el tipo de contenido
    if (contentType.includes("application/json")) {
      const body = await req.json();
      requestData = RequestBodySchema.parse(body);
    } else if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const formData = {
        message: form.get("message")?.toString(),
        name: form.get("name")?.toString(),
        age: form.get("age")?.toString(),
        weight: form.get("weight")?.toString(),
        height: form.get("height")?.toString(),
        sessionId: form.get("sessionId")?.toString(),
      };

      // 2. VALIDACIÓN ESTRICTA con Zod
      try {
        requestData = RequestBodySchema.parse(formData);
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errorMessages = error.errors
            .map((err) => `${err.path.join(".")}: ${err.message}`)
            .join(", ");
          return NextResponse.json(
            { reply: `❌ Datos inválidos: ${errorMessages}` },
            { status: 400 }
          );
        }
        throw error;
      }

      // Procesamiento de imagen con validación mejorada
      const image = form.get("image") as File;
      if (image && image instanceof Blob && image.size > 0) {
        // Validar tipo de imagen
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/webp",
        ];
        if (!allowedTypes.includes(image.type)) {
          return NextResponse.json(
            { reply: "❌ Tipo de imagen no válido. Usa JPG, PNG o WebP." },
            { status: 400 }
          );
        }

        // Validar tamaño de imagen (máximo 5MB)
        if (image.size > 5 * 1024 * 1024) {
          return NextResponse.json(
            { reply: "❌ La imagen es demasiado grande. Tamaño máximo: 5MB." },
            { status: 400 }
          );
        }

        const buffer = Buffer.from(await image.arrayBuffer());
        base64Image = buffer.toString("base64");
        mimeType = image.type;
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

    // 3. CONEXIÓN MEJORADA a MongoDB
    dbClient = await DatabaseConnection.getInstance();
    const db = dbClient.db(dbName);
    const collection = db.collection<Conversation>(collectionName);

    // Buscar conversación existente
    let conversation = await collection.findOne({
      sessionId: requestData.sessionId,
    });

    if (!conversation) {
      // Crear nueva conversación con prompt del sistema
      const systemPrompt = createSystemPrompt({
        name: requestData.name,
        age: requestData.age,
        weight: requestData.weight,
        height: requestData.height,
      });

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
            parts: [{ text: systemPrompt }],
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await collection.insertOne(conversation);
    }

    // Preparar el mensaje del usuario
    const userMessage =
      requestData.message ||
      "He enviado una imagen, por favor analízala desde una perspectiva nutricional.";

    // Sanitizar mensaje para prevenir inyecciones
    const sanitizedMessage = userMessage
      .replace(/<script[^>]*>.*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, "")
      .trim();

    const parts: Part[] = [
      { text: `Consulta nutricional: ${sanitizedMessage}` },
    ];

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
      { role: "user" as const, parts },
    ];

    // Llamada a la API de Gemini con timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
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
                threshold: "BLOCK_MEDIUM_AND_ABOVE",
              },
              {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_MEDIUM_AND_ABOVE",
              },
              {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE",
              },
              {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_MEDIUM_AND_ABOVE",
              },
            ],
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      if (!geminiResponse.ok) {
        const errorData = await geminiResponse.json().catch(() => ({}));
        console.error("Error de Gemini API:", errorData);

        let errorMessage = "❌ Error al procesar tu consulta nutricional.";
        if (geminiResponse.status === 503) {
          errorMessage = "🤖 El servicio de IA está temporalmente sobrecargado. Por favor, intenta nuevamente en unos minutos.";
        } else if (geminiResponse.status === 429) {
          errorMessage =
            "⏳ El servicio está temporalmente ocupado. Intenta nuevamente en unos momentos.";
        } else if (geminiResponse.status === 400) {
          errorMessage =
            "❌ Error en el formato de la consulta. Por favor, reformula tu pregunta.";
        }

        return NextResponse.json(
          { reply: errorMessage },
          { status: geminiResponse.status }
        );
      }

      const geminiData = await geminiResponse.json();

      // Extraer respuesta de Gemini
      let botReply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!botReply) {
        botReply =
          "Lo siento, no pude generar una respuesta clara. ¿Podrías reformular tu pregunta nutricional?";
      }

      // Sanitizar respuesta del bot
      botReply = botReply
        .replace(/<script[^>]*>.*?<\/script>/gi, "")
        .replace(/javascript:/gi, "")
        .trim();

      // Actualizar conversación en MongoDB
      const finalHistory = [
        ...updatedHistory,
        { role: "model" as const, parts: [{ text: botReply }] },
      ];

      await collection.updateOne(
        { sessionId: requestData.sessionId },
        {
          $set: {
            history: finalHistory,
            updatedAt: new Date(),
          },
        }
      );

      // Respuesta exitosa
      return NextResponse.json({
        reply: botReply,
        sessionId: requestData.sessionId,
        timestamp: new Date().toISOString(),
      });
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === "AbortError") {
        return NextResponse.json(
          {
            reply:
              "⏰ La solicitud tardó demasiado. Intenta con un mensaje más corto.",
          },
          { status: 408 }
        );
      }
      throw fetchError;
    }
  } catch (error) {
    console.error("Error en el endpoint de chat:", error);

    let errorMessage =
      "❌ Error interno del servidor. Por favor, intenta nuevamente.";
    let statusCode = 500;

    if (error instanceof z.ZodError) {
      const errorMessages = error.errors
        .map((err) => `${err.path.join(".")}: ${err.message}`)
        .join(", ");
      errorMessage = `❌ Datos inválidos: ${errorMessages}`;
      statusCode = 400;
    } else if (error instanceof Error) {
      if (error.message.includes("fetch")) {
        errorMessage =
          "🌐 Error de conectividad. Verifica tu conexión a internet.";
      } else if (
        error.message.includes("MongoDB") ||
        error.message.includes("mongo")
      ) {
        errorMessage =
          "💾 Error de base de datos. Intenta nuevamente en unos momentos.";
      }
    }

    return NextResponse.json(
      {
        reply: errorMessage,
        error:
          process.env.NODE_ENV === "development"
            ? error?.toString()
            : undefined,
      },
      { status: statusCode }
    );
  }
  // No cerramos la conexión aquí porque usamos pooling
}

// Endpoint GET mejorado
export async function GET(req: Request) {
  try {
    // Rate limiting también para GET
    const clientIP = getClientIP(req);
    const rateLimitResult = RateLimiter.isAllowed(clientIP);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429 }
      );
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId es requerido" },
        { status: 400 }
      );
    }

    // Validar sessionId
    if (!/^[a-zA-Z0-9_-]+$/.test(sessionId) || sessionId.length > 100) {
      return NextResponse.json(
        { error: "sessionId inválido" },
        { status: 400 }
      );
    }

    const dbClient = await DatabaseConnection.getInstance();
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
  }
}

// Cleanup al cerrar la aplicación
process.on("SIGTERM", async () => {
  await DatabaseConnection.closeConnection();
  process.exit(0);
});

process.on("SIGINT", async () => {
  await DatabaseConnection.closeConnection();
  process.exit(0);
});
