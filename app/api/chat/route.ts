import type { NextRequest } from "next/server"

// Определяем идентификаторы моделей с правильными идентификаторами OpenRouter
const MODEL_MAP = {
  mistral: "mistralai/mistral-7b-instruct", // Используем Mistral
  "base-free": "01-ai/yi-34b-chat",
}

// Резервные модели на случай, если основные недоступны
const FALLBACK_MODELS = {
  mistral: ["openai/gpt-3.5-turbo", "anthropic/claude-instant-v1"],
  "base-free": ["google/gemma-7b-it", "anthropic/claude-instant-v1"],
}

// Исправляем функцию fetchFromOpenRouter, чтобы правильно передавать API ключ
async function fetchFromOpenRouter(model: string, messages: any[], apiKey: string) {
  console.log("Используем API ключ:", apiKey.substring(0, 10) + "..." + apiKey.substring(apiKey.length - 5))
  console.log("Отправляем запрос к модели:", model)

  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.VERCEL_URL || "http://localhost:3000",
      "X-Title": "AI Assistant",
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000,
      stream: true,
    }),
  })
}

// Устанавливаем максимальную продолжительность для потоковых ответов
export const maxDuration = 60

// Добавляем неблокирующий вариант для случаев, когда потоковая передача не работает
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.API_KEY || "";

    console.log("Длина API ключа:", apiKey.length)

    if (!apiKey || apiKey.trim() === "") {
      console.error("API ключ отсутствует или пуст")
      return new Response(JSON.stringify({ error: "API ключ OpenRouter не настроен" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Разбираем тело запроса
    const { messages, model } = await req.json()

    if (!messages || !Array.isArray(messages) || !model) {
      return new Response(JSON.stringify({ error: "Неверный формат запроса" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Сопоставляем имя модели с фактическим идентификатором модели
    const modelId = MODEL_MAP[model as keyof typeof MODEL_MAP]

    if (!modelId) {
      return new Response(JSON.stringify({ error: "Указана неверная модель" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    // Форматируем сообщения для API OpenRouter
    const formattedMessages = messages.map((msg: any) => ({
      role: msg.role,
      content: msg.content,
    }))

    // Пробуем сначала неблокирующий запрос, если потоковая передача не работает
    try {
      console.log("Пробуем сначала неблокирующий запрос")
      const nonStreamingResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": process.env.VERCEL_URL || "http://localhost:3000",
          "X-Title": "AI Assistant",
        },
        body: JSON.stringify({
          model: modelId,
          messages: formattedMessages,
          temperature: 0.7,
          max_tokens: 1000,
          stream: false, // Не используем потоковую передачу
        }),
      })

      if (nonStreamingResponse.ok) {
        const data = await nonStreamingResponse.json()
        console.log("Неблокирующий ответ успешен:", data)

        if (data.choices && data.choices[0] && data.choices[0].message) {
          return new Response(JSON.stringify({ content: data.choices[0].message.content }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        }
      } else {
        console.error("Неблокирующий запрос не удался:", await nonStreamingResponse.text())
      }
    } catch (nonStreamingError) {
      console.error("Ошибка неблокирующего запроса:", nonStreamingError)
    }

    // Если неблокирующий запрос не сработал, возвращаем заглушку
    console.log("Возвращаем заглушку")
    return new Response(
      JSON.stringify({
        content:
          "Извините, в данный момент я не могу подключиться к API. Пожалуйста, проверьте ваш API ключ и попробуйте позже.",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    )
  } catch (error) {
    console.error("Ошибка в маршруте API чата:", error)
    return new Response(
      JSON.stringify({ error: "Произошла непредвиденная ошибка", content: "Произошла ошибка при обработке запроса." }),
      {
        status: 200, // Возвращаем 200, чтобы клиент мог обработать ошибку
        headers: { "Content-Type": "application/json" },
      },
    )
  }
}