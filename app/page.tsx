"use client"

import type React from "react"
import { useState, useRef, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MessageSquare, Send, Bot, User, Trash2, Info, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Message = {
  role: "user" | "assistant"
  content: string
  id: string
}

const MODEL_INFO = {
  name: "Mistral 7B",
  description: "Мощная языковая модель с открытым исходным кодом",
  badge: "Бесплатный тариф",
}

// Запасные ответы на случай, если API не работает
const FALLBACK_RESPONSES = [
  "Извините, не удалось подключиться к сервису ИИ. Вот запасной ответ.",
  "Сервис ИИ в настоящее время недоступен. Пожалуйста, попробуйте позже.",
  "У меня проблемы с подключением к сервису ИИ, но я всё ещё здесь, чтобы помочь.",
  "Похоже, возникла проблема с сервисом ИИ. Позвольте мне предоставить простой ответ.",
]

// Генерируем уникальный ID для сообщений
function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Фокусируем поле ввода при загрузке страницы
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleClearChat = () => {
    setMessages([])
    setError(null)
    inputRef.current?.focus()
  }

  // Получаем случайный запасной ответ
  const getFallbackResponse = () => {
    const index = Math.floor(Math.random() * FALLBACK_RESPONSES.length)
    return FALLBACK_RESPONSES[index]
  }

  // Обрабатываем отправку сообщения
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      role: "user",
      content: input,
      id: generateId(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsLoading(true)
    setError(null)

    try {
      // Добавляем временное сообщение загрузки
      const assistantMessageId = generateId()
      setMessages((prev) => [...prev, { role: "assistant", content: "", id: assistantMessageId }])

      // Устанавливаем таймаут, чтобы не ждать слишком долго
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 60000) // 60 секунд таймаут

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: messages.concat(userMessage).map(({ role, content }) => ({ role, content })),
            model: "mistral", // Используем Mistral
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Ошибка сервера: ${response.status}. ${errorText}`)
        }

        // Проверяем тип ответа
        const contentType = response.headers.get("Content-Type") || ""

        if (contentType.includes("application/json")) {
          // Обрабатываем обычный JSON ответ
          const data = await response.json()

          if (data.error) {
            throw new Error(data.error)
          }

          // Обновляем сообщение ассистента
          setMessages((prev) => {
            const newMessages = [...prev]
            const lastMessage = newMessages.find((msg) => msg.id === assistantMessageId)
            if (lastMessage) {
              lastMessage.content = data.content || "Не удалось получить ответ от модели."
            }
            return newMessages
          })
        } else if (contentType.includes("text/event-stream")) {
          // Обрабатываем потоковый ответ
          const reader = response.body?.getReader()
          if (!reader) {
            throw new Error("Тело ответа отсутствует")
          }

          const decoder = new TextDecoder()
          let accumulatedContent = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split("\n\n").filter((line) => line.trim() !== "")

            for (const line of lines) {
              try {
                const trimmedLine = line.replace(/^data: /, "").trim()
                if (!trimmedLine) continue

                const parsedChunk = JSON.parse(trimmedLine)

                if (parsedChunk.type === "text") {
                  accumulatedContent += parsedChunk.value

                  // Обновляем сообщение ассистента с накопленным содержимым
                  setMessages((prev) => {
                    const newMessages = [...prev]
                    const lastMessage = newMessages.find((msg) => msg.id === assistantMessageId)
                    if (lastMessage) {
                      lastMessage.content = accumulatedContent
                    }
                    return newMessages
                  })
                } else if (parsedChunk.type === "error") {
                  throw new Error(parsedChunk.value)
                }
              } catch (e) {
                console.error("Ошибка при разборе фрагмента:", e)
              }
            }
          }
        } else {
          throw new Error("Неожиданный формат ответа от сервера")
        }
      } catch (fetchError) {
        console.error("Ошибка запроса:", fetchError)

        if ((fetchError as Error).name === "AbortError") {
          throw new Error("Время ожидания истекло. Пожалуйста, попробуйте снова.")
        }

        throw fetchError
      }
    } catch (err) {
      console.error("Ошибка при отправке сообщения:", err)
      setError(err instanceof Error ? err.message : "Произошла непредвиденная ошибка")

      // Обновляем сообщение ассистента запасным ответом
      setMessages((prev) => {
        const newMessages = [...prev]
        const lastMessage = newMessages[newMessages.length - 1]
        if (lastMessage && lastMessage.role === "assistant") {
          lastMessage.content = getFallbackResponse()
        }
        return newMessages
      })
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handlePromptClick = (promptText: string) => {
    setInput(promptText)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {/* Заголовок */}
      <header className="border-b p-3 sm:p-4 bg-white dark:bg-gray-800 shadow-sm">
        <div className="flex items-center justify-between max-w-screen-xl mx-auto">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <h1 className="text-lg sm:text-xl font-bold">AI Assistant</h1>
          </div>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" onClick={handleClearChat} aria-label="Clear conversation">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Очистить диалог</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Model information">
                    <Info className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-2">
                    <p className="font-medium">AI Assistant — Чат-бот с искусственным интеллектом для решения задач</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </header>

      {/* Основная область чата */}
      <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">
        <div className="max-w-screen-xl mx-auto space-y-4 sm:space-y-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 py-10 sm:py-20">
              <Bot className="h-12 w-12 sm:h-16 sm:w-16 mb-4 sm:mb-6" />
              <p className="text-xl sm:text-2xl font-medium mb-2">Начните диалог</p>
              <p className="text-base sm:text-lg mb-6 sm:mb-8">Отправьте сообщение, чтобы начать общение</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 w-full max-w-3xl px-2 sm:px-0">
                <div
                  className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handlePromptClick("Объясни, как работают промисы в JavaScript")}
                >
                  <p className="font-medium text-base sm:text-lg">Объясни промисы в JavaScript</p>
                </div>
                <div
                  className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() =>
                    handlePromptClick("Напиши функцию на Python для поиска самого длинного палиндрома в строке")
                  }
                >
                  <p className="font-medium text-base sm:text-lg">Найди палиндромы на Python</p>
                </div>
                <div
                  className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handlePromptClick("Сравни фреймворки React и Vue.js")}
                >
                  <p className="font-medium text-base sm:text-lg">Сравни React и Vue.js</p>
                </div>
                <div
                  className="p-4 sm:p-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handlePromptClick("Объясни концепцию рекурсии с примерами")}
                >
                  <p className="font-medium text-base sm:text-lg">Объясни рекурсию с примерами</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 sm:space-y-6 max-w-3xl mx-auto">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex items-start gap-3 sm:gap-4 rounded-xl p-3 sm:p-5",
                    message.role === "user"
                      ? "bg-primary/10 ml-auto max-w-[90%] sm:max-w-[85%]"
                      : "bg-white dark:bg-gray-800 mr-auto max-w-[90%] sm:max-w-[85%] shadow-sm",
                  )}
                >
                  <div className="flex-shrink-0">
                    {message.role === "user" ? (
                      <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
                        <User className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                    ) : (
                      <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-muted-foreground/20 flex items-center justify-center">
                        <Bot className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1 sm:space-y-2 min-w-0">
                    <div className="markdown-content break-words">
                      {message.role === "user" ? (
                        <div className="whitespace-pre-wrap text-sm sm:text-base">{message.content}</div>
                      ) : (
                        <ReactMarkdown
                          //className="prose dark:prose-invert prose-sm sm:prose-base max-w-none"
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code({ node, className, children, ...props }) {
                              const match = /language-(\w+)/.exec(className || "")
                              return match ? (
                                <div className="relative my-4 rounded-md overflow-hidden">
                                  <div className="flex items-center justify-between bg-gray-800 text-gray-200 px-4 py-1 text-xs">
                                    <span>{match[1]}</span>
                                    <button
                                      className="text-xs text-gray-400 hover:text-white"
                                      onClick={() => {
                                        navigator.clipboard.writeText(String(children).replace(/\n$/, ""))
                                      }}
                                    >
                                      Копировать
                                    </button>
                                  </div>
                                  {/* @ts-ignore */}
                                  <pre
                                    {...props}
                                    className="p-4 bg-gray-900 text-gray-100 overflow-x-auto text-xs sm:text-sm"
                                  >
                                    <code className={className}>{String(children).replace(/\n$/, "")}</code>
                                  </pre>
                                </div>
                              ) : (
                                <code
                                  {...props}
                                  className={cn(
                                    "bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-xs sm:text-sm",
                                    className,
                                  )}
                                >
                                  {children}
                                </code>
                              )
                            },
                            a: ({ node, ...props }) => (
                              <a
                                {...props}
                                className="text-blue-600 dark:text-blue-400 hover:underline"
                                target="_blank"
                                rel="noopener noreferrer"
                              />
                            ),
                            ul: ({ node, ...props }) => <ul {...props} className="list-disc pl-5 sm:pl-6 my-2" />,
                            ol: ({ node, ...props }) => <ol {...props} className="list-decimal pl-5 sm:pl-6 my-2" />,
                            li: ({ node, ...props }) => <li {...props} className="my-1" />,
                            h1: ({ node, ...props }) => (
                              <h1 {...props} className="text-xl sm:text-2xl font-bold my-3" />
                            ),
                            h2: ({ node, ...props }) => <h2 {...props} className="text-lg sm:text-xl font-bold my-3" />,
                            h3: ({ node, ...props }) => (
                              <h3 {...props} className="text-base sm:text-lg font-bold my-2" />
                            ),
                            p: ({ node, ...props }) => <p {...props} className="my-2" />,
                            blockquote: ({ node, ...props }) => (
                              <blockquote
                                {...props}
                                className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic my-3"
                              />
                            ),
                            table: ({ node, ...props }) => (
                              <div className="overflow-x-auto my-3 sm:my-4">
                                <table
                                  {...props}
                                  className="min-w-full divide-y divide-gray-300 dark:divide-gray-700"
                                />
                              </div>
                            ),
                            thead: ({ node, ...props }) => (
                              <thead {...props} className="bg-gray-100 dark:bg-gray-700" />
                            ),
                            tbody: ({ node, ...props }) => (
                              <tbody {...props} className="divide-y divide-gray-200 dark:divide-gray-800" />
                            ),
                            tr: ({ node, ...props }) => (
                              <tr {...props} className="hover:bg-gray-50 dark:hover:bg-gray-750" />
                            ),
                            th: ({ node, ...props }) => (
                              <th {...props} className="px-3 py-2 text-left text-xs sm:text-sm font-semibold" />
                            ),
                            td: ({ node, ...props }) => <td {...props} className="px-3 py-2 text-xs sm:text-sm" />,
                            hr: ({ node, ...props }) => (
                              <hr {...props} className="my-4 border-gray-300 dark:border-gray-700" />
                            ),
                          }}
                        >
                          {message.content || (isLoading ? "Думаю..." : "")}
                        </ReactMarkdown>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {isLoading &&
                messages.length > 0 &&
                messages[messages.length - 1].role === "assistant" &&
                messages[messages.length - 1].content === "" && (
                  <div className="flex items-center space-x-2 text-gray-500 ml-11 sm:ml-14">
                    <div className="animate-pulse text-sm sm:text-base">Думаю</div>
                    <div className="flex space-x-1">
                      <div
                        className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      ></div>
                      <div
                        className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      ></div>
                      <div
                        className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      ></div>
                    </div>
                  </div>
                )}
              {error && (
                <div className="p-4 sm:p-5 rounded-xl bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400 max-w-3xl mx-auto">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-sm sm:text-base">Ошибка</p>
                      <p className="text-sm">{error}</p>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      {/* Футер с полем ввода */}
      <footer className="border-t bg-white dark:bg-gray-800 p-3 sm:p-4 shadow-lg">
        <div className="max-w-screen-xl mx-auto">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2">
            <Input
              ref={inputRef}
              placeholder="Введите ваше сообщение..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              className="flex-1 py-5 sm:py-6 text-sm sm:text-base"
            />
            <Button
              type="submit"
              disabled={isLoading || !input.trim()}
              size="icon"
              className="h-10 w-10 sm:h-12 sm:w-12"
              aria-label="Send message"
            >
              <Send className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </form>
          <div className="mt-2 text-center text-xs text-gray-500">
            <p>AI Assistant может совершать ошибки. Проверьте важную информацию</p>
          </div>
        </div>
      </footer>
    </div>
  )
}