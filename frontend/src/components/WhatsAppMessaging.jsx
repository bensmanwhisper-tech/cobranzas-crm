import React, { useState, useEffect, useRef } from "react";
import { endpoints } from "@/lib/api";
import { toast } from "sonner";
import { Send, User, Clock, Phone, AlertCircle, RefreshCw, MessageCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

export default function WhatsAppMessaging({ country }) {
  const [conversations, setConversations] = useState([]);
  const [selectedPhone, setSelectedPhone] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loadingConv, setLoadingConv] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  
  const loadConversations = async () => {
    try {
      setLoadingConv(true);
      const res = await endpoints.getConversations({ country });
      setConversations(res || []);
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar conversaciones");
    } finally {
      setLoadingConv(false);
    }
  };

  const loadMessages = async (phone) => {
    try {
      setLoadingMsgs(true);
      const res = await endpoints.getMessages({ phone });
      setMessages(res || []);
    } catch (err) {
      console.error(err);
      toast.error("Error al cargar mensajes");
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 10000); // refresh every 10s
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country]);

  useEffect(() => {
    if (selectedPhone) {
      loadMessages(selectedPhone);
      const interval = setInterval(() => loadMessages(selectedPhone), 5000); // poll active chat every 5s
      return () => clearInterval(interval);
    }
  }, [selectedPhone]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!inputText.trim() || !selectedPhone) return;
    
    setSending(true);
    const activeConv = conversations.find(c => c.phone === selectedPhone);
    const contactId = activeConv?.contact?.id;

    try {
      const res = await endpoints.whatsappMetaSend({
        phone: selectedPhone,
        message: inputText.trim(),
        country: country,
        contact_id: contactId
      });
      if (res.success) {
        setInputText("");
        loadMessages(selectedPhone);
        loadConversations();
      } else {
        toast.error(res.error || "Error al enviar el mensaje");
      }
    } catch (err) {
      toast.error("Error de conexión al enviar");
    } finally {
      setSending(false);
    }
  };

  const activeContact = conversations.find(c => c.phone === selectedPhone)?.contact;

  return (
    <div className="flex h-[calc(100vh-140px)] bg-[#0B0B0F] border border-white/10 rounded-xl overflow-hidden shadow-2xl">
      {/* Sidebar - Conversations */}
      <div className="w-1/3 border-r border-white/5 flex flex-col bg-[#101013]">
        <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#15151A]">
          <h2 className="font-display font-bold text-lg text-white flex items-center gap-2">
            Chats <span className="text-xs font-normal text-zinc-400 bg-black/40 px-2 py-0.5 rounded-full">{conversations.length}</span>
          </h2>
          <button onClick={loadConversations} className="text-zinc-400 hover:text-white transition-colors" title="Actualizar">
            <RefreshCw size={16} className={loadingConv ? "animate-spin" : ""} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
          {conversations.length === 0 && !loadingConv ? (
            <div className="text-center text-zinc-500 py-8 px-4 text-sm flex flex-col items-center">
              <AlertCircle size={32} className="mb-2 opacity-50" />
              No hay conversaciones activas. Los mensajes enviados y recibidos aparecerán aquí.
            </div>
          ) : (
            conversations.map((conv) => {
              const isSelected = selectedPhone === conv.phone;
              return (
                <button
                  key={conv.phone}
                  onClick={() => setSelectedPhone(conv.phone)}
                  className={`w-full flex flex-col p-3 rounded-lg text-left transition-all ${
                    isSelected ? "bg-emerald-500/10 border border-emerald-500/20" : "hover:bg-white/5 border border-transparent"
                  }`}
                >
                  <div className="flex justify-between items-start w-full">
                    <span className={`font-semibold truncate max-w-[70%] ${isSelected ? "text-emerald-400" : "text-zinc-200"}`}>
                      {conv.contact?.nombre || conv.phone}
                    </span>
                    <span className="text-[10px] text-zinc-500 whitespace-nowrap ml-2">
                      {format(parseISO(conv.last_message_at), "HH:mm")}
                    </span>
                  </div>
                  
                  <div className="flex justify-between items-center mt-1 w-full opacity-80">
                    <span className="text-xs text-zinc-400 truncate max-w-[80%]">
                      {conv.last_direction === 'outgoing' ? 'Tú: ' : ''}{conv.last_message}
                    </span>
                    {conv.message_count > 0 && (
                      <span className="text-[9px] bg-white/10 text-zinc-300 px-1.5 rounded-full">
                        {conv.message_count}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-[#050508] relative">
        {selectedPhone ? (
          <>
            {/* Chat Header */}
            <div className="h-16 px-6 border-b border-white/5 flex items-center justify-between bg-[#101013] shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500">
                  <User size={20} />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                    {activeContact?.nombre || selectedPhone}
                    {activeContact && (
                      <span className="text-[10px] font-normal uppercase px-2 py-0.5 rounded bg-white/5 text-zinc-400">
                        {activeContact.app_cliente || "CRM"}
                      </span>
                    )}
                  </h3>
                  <div className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                    <Phone size={10} /> {selectedPhone}
                    {activeContact && activeContact.monto > 0 && (
                      <span className="ml-2 text-rose-400 font-mono">Deuda: ${activeContact.monto}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((msg, idx) => {
                const isOut = msg.direction === 'outgoing';
                const showTime = true;
                return (
                  <div key={msg.id || idx} className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm relative group ${
                      isOut 
                        ? "bg-emerald-600 text-white rounded-br-sm" 
                        : "bg-[#1A1A24] text-zinc-200 border border-white/5 rounded-bl-sm"
                    }`}>
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                      {showTime && (
                        <div className={`text-[10px] mt-1 flex items-center justify-end gap-1 opacity-70 ${
                          isOut ? "text-emerald-100" : "text-zinc-500"
                        }`}>
                          {format(parseISO(msg.created_at), "HH:mm")}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 bg-[#101013] border-t border-white/5">
              <form onSubmit={handleSend} className="flex gap-2">
                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-full px-5 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
                  disabled={sending}
                />
                <button
                  type="submit"
                  disabled={!inputText.trim() || sending}
                  className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  <Send size={18} className={sending ? "opacity-0" : "opacity-100"} />
                  {sending && <RefreshCw size={18} className="absolute animate-spin" />}
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 opacity-60">
            <MessageCircle size={64} className="mb-4 text-emerald-500 opacity-50" />
            <p className="font-display text-xl">Selecciona un chat</p>
            <p className="text-sm mt-2">Los mensajes de WhatsApp Cloud API aparecerán aquí</p>
          </div>
        )}
      </div>
    </div>
  );
}
