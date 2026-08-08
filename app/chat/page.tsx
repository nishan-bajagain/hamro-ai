import type { Metadata } from "next";
import { ChatClient } from "@/components/ChatClient";

export const metadata: Metadata = {
  title: "Playground — hamro.site",
  description: "Test the free models behind the hamro.site AI gateway.",
};

export default function ChatPage() {
  return <ChatClient />;
}
