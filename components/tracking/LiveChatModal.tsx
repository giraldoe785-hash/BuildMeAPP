"use client";

import React, { useState, useRef, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { useFixiStore } from "@/store/useFixiStore";
import { Send, Phone, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

const QUICK_PROMPTS = [
  "Ya estoy en la puerta",
  "Toca el timbre blanco 4B",
  "¿Traes todos los repuestos?",
  "¿A cuánto tiempo estás?",
];

export const LiveChatModal: React.FC = () => {
  const {
    isChatModalOpen,
    setChatModalOpen,
    activeOrder,
    sendChatMessage,
  } = useFixiStore();

  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const technician = activeOrder?.technician;
  const messages = activeOrder?.chatMessages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isChatModalOpen) {
      scrollToBottom();
    }
  }, [isChatModalOpen, messages]);

  if (!technician) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;
    sendChatMessage(inputMessage.trim());
    setInputMessage("");
  };

  const handleQuickPromptClick = (prompt: string) => {
    sendChatMessage(prompt);
  };

  return (
    <Modal
      isOpen={isChatModalOpen}
      onClose={() => setChatModalOpen(false)}
      title={
        <div className="flex items-center gap-2">
          <img
            src={technician.avatar}
            alt={technician.name}
            className="w-8 h-8 rounded-full object-cover border border-emerald-500"
          />
          <div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-slate-900">{technician.name}</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <span className="text-[10px] text-emerald-600 font-semibold">
              ● En línea (Fixi Messenger)
            </span>
          </div>
        </div>
      }
    >
      <div className="flex flex-col h-[400px]">
        {/* Messages List */}
        <div className="flex-1 overflow-y-auto space-y-2.5 p-1">
          {messages.map((msg) => {
            const isMe = msg.sender === "user";
            const isSystem = msg.sender === "system";

            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-1">
                  <span className="bg-slate-100 text-slate-600 text-[10px] px-3 py-1 rounded-full text-center max-w-[90%] font-medium">
                    {msg.text}
                  </span>
                </div>
              );
            }

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                    isMe
                      ? "bg-emerald-600 text-white rounded-br-xs"
                      : "bg-slate-100 text-slate-900 rounded-bl-xs"
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[9px] text-slate-400 mt-0.5 px-1 font-mono">
                  {msg.timestamp}
                </span>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick prompt chips */}
        <div className="pt-2 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-slate-100">
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleQuickPromptClick(prompt)}
              className="shrink-0 text-[10px] bg-slate-50 hover:bg-slate-100 text-slate-700 font-medium px-2.5 py-1 rounded-lg border border-slate-200 transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Input box */}
        <form onSubmit={handleSend} className="flex items-center gap-2 pt-1">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder={`Escribe a ${technician.name.split(" ")[0]}...`}
            className="flex-1 text-xs px-3.5 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 text-slate-900"
          />
          <button
            type="submit"
            className="w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-xs transition-colors shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </Modal>
  );
};
