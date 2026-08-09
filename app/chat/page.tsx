import type { Metadata } from "next";
import { ChatApp } from "@/components/chat/ChatApp";

export const metadata: Metadata = {
  title: "Chat — Hamro AI",
  description: "Chat with free AI models, routed with automatic failover.",
};

export default function ChatPage() {
  return <ChatApp />;
}
