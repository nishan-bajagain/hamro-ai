import type { Metadata } from "next";
import { StatusDashboard } from "@/components/StatusDashboard";

export const metadata: Metadata = {
  title: "Status — hamro.site",
  description: "Live telemetry and provider health for the hamro.site AI gateway.",
};

export default function StatusPage() {
  return <StatusDashboard />;
}
