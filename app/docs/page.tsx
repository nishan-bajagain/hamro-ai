import { promises as fs } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Documentation — hamro.site",
  description:
    "Full API reference, free-access guide and coding-agent setup for the hamro.site free AI gateway.",
};

export const dynamic = "force-dynamic";

export default async function DocsRoute() {
  let markdown = "";
  try {
    markdown = await fs.readFile(
      path.join(process.cwd(), "DOCS.md"),
      "utf8",
    );
  } catch {
    markdown =
      "# Documentation\n\nThe documentation file (DOCS.md) could not be loaded. Check that it exists in the project root.";
  }
  return <DocsPage markdown={markdown} />;
}
