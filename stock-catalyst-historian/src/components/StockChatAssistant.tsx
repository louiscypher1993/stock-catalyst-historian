import React, { useState, useRef, useEffect } from "react";
import { StockPoint } from "../types";
import { Send, Sparkles, MessageSquare, Bot, User, Loader2, ArrowRight } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface StockChatAssistantProps {
  symbol: string;
  anomalies: StockPoint[];
}

export default function StockChatAssistant({ symbol, anomalies }: StockChatAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: `Hello! I am your AI Stock Historian. I have integrated ${anomalies.length} statistical price anomaly records for **${symbol.toUpperCase()}**. Ask me anything about its historical catalysts, structural risks, or specific date spikes!`,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll to bottom on updates
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Reset chat when symbol changes
  useEffect(() => {
    setMessages([
      {
        role: "assistant",
        content: `Hello! I am your AI Stock Historian. I have integrated ${anomalies.length} statistical price anomaly records for **${symbol.toUpperCase()}**. Ask me anything about its historical catalysts, structural risks, or specific date spikes!`,
      },
    ]);
  }, [symbol, anomalies.length]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const userMessageText = inputValue.trim();
    setInputValue("");

    const newMessages = [...messages, { role: "user" as const, content: userMessageText }];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const response = await fetch("/api/stock-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          messages: newMessages,
          anomalies,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to reach out to the stock assistant model.");
      }

      const data = await response.json();
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply || "No reply generated." }]);
    } catch (error: any) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `System Error: ${error.message || "Failed to communicate with Gemini AI."}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // Simple Markdown-like formatter for bolding, line breaks, and list bullets
  const formatMessageText = (text: string) => {
    return text.split("\n").map((line, idx) => {
      let formattedLine = line;

      // Handle bold blocks: **text** -> strong
      const boldRegex = /\*\*(.*?)\*\*/g;
      const parts = [];
      let lastIndex = 0;
      let match;

      while ((match = boldRegex.exec(line)) !== null) {
        if (match.index > lastIndex) {
          parts.push(line.substring(lastIndex, match.index));
        }
        parts.push(<strong key={match.index} className="text-emerald-300 font-semibold">{match[1]}</strong>);
        lastIndex = boldRegex.lastIndex;
      }
      if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex));
      }

      const content = parts.length > 0 ? parts : formattedLine;

      // Unordered lists: - text or * text
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        return (
          <li key={idx} className="ml-4 list-disc text-xs text-slate-300 mb-1 leading-relaxed">
            {typeof content === 'string' ? content.substring(2) : content}
          </li>
        );
      }

      // Headers: ### Text
      if (line.trim().startsWith("### ")) {
        return (
          <h4 key={idx} className="text-sm font-semibold text-emerald-400 mt-3 mb-1.5 flex items-center gap-1.5">
            <ArrowRight className="w-3.5 h-3.5 text-emerald-500" />
            {typeof content === 'string' ? content.substring(4) : content}
          </h4>
        );
      }

      // Empty spaces
      if (line.trim() === "") {
        return <div key={idx} className="h-2" />;
      }

      return (
        <p key={idx} className="text-xs text-slate-300 mb-1 leading-relaxed font-sans">
          {content}
        </p>
      );
    });
  };

  const presetQuestions = [
    `Summarize major historical risks for ${symbol}`,
    `Explain the biggest price outlier day`,
    `Identify key catalyst tags`,
  ];

  return (
    <div id="stock-chat-container" className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-zinc-800/60">
        <MessageSquare className="w-4 h-4 text-blue-500 animate-pulse" />
        <div>
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block">Context Companion</span>
          <h2 className="text-xs font-bold text-zinc-150 uppercase tracking-wider">AI Historian Consultant</h2>
        </div>
      </div>

      {/* Messages Scroll pane */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4 h-[300px] scrollbar-thin scrollbar-thumb-zinc-800"
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`flex gap-2.5 items-start ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            {/* Avatar badge */}
            <div
              className={`p-1.5 rounded-lg shrink-0 ${
                msg.role === "user" ? "bg-blue-500/10 text-blue-400" : "bg-zinc-800 text-zinc-300"
              }`}
            >
              {msg.role === "user" ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
            </div>

            {/* Bubble contents */}
            <div
              className={`rounded px-4 py-3 max-w-[85%] text-xs shadow-sm ${
                msg.role === "user"
                  ? "bg-zinc-800 text-zinc-100 rounded-tr-none border border-zinc-700"
                  : "bg-zinc-950 text-zinc-300 rounded-tl-none border border-zinc-800"
              }`}
            >
              {msg.role === "assistant" ? formatMessageText(msg.content) : <p className="leading-relaxed whitespace-pre-line">{msg.content}</p>}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2.5 items-start">
            <div className="p-1.5 rounded-lg shrink-0 bg-zinc-800 text-zinc-300">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="rounded px-4 py-3 bg-zinc-950 text-xs text-zinc-500 flex items-center gap-2 border border-zinc-800 italic rounded-tl-none animate-pulse font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
              Formulating analysis matrix...
            </div>
          </div>
        )}
      </div>

      {/* Quick Presets */}
      <div className="mb-4">
        <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-mono block mb-1.5">
          Tactical Prompts
        </label>
        <div className="flex flex-col gap-1.5">
          {presetQuestions.map((q, idx) => (
            <button
              id={`preset-prompt-${idx}`}
              key={idx}
              onClick={() => setInputValue(q)}
              className="text-[10px] font-mono text-left px-3 py-1.5 rounded bg-zinc-950 border border-zinc-805 text-zinc-400 hover:text-blue-400 hover:border-zinc-700 transition-all truncate cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Input box */}
      <form onSubmit={handleSend} className="relative">
        <input
          id="chat-input-field"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Inquire about corporate timeline data..."
          className="w-full bg-zinc-950 text-zinc-200 rounded pl-3.5 pr-11 py-2.5 text-xs border border-zinc-800 focus:outline-none focus:ring-1 focus:ring-blue-500/40 font-sans"
        />
        <button
          id="btn-chat-send"
          type="submit"
          className="absolute right-1.5 top-1.5 p-1.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-400 hover:text-blue-400 transition-all focus:outline-none disabled:opacity-50 cursor-pointer"
          disabled={!inputValue.trim() || isLoading}
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
