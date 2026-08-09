/**
 * Minimal, spec-compliant Server-Sent Events parser. Returns complete
 * `data:` payloads (multi-line joined). Ignores comments/other fields.
 *
 * This module is intentionally dependency-free so it can be unit-tested
 * directly (no path aliases, no side effects).
 *
 * UTF-8 note: the `TextDecoder` is created ONCE per parser instance (per
 * stream) and fed with `{ stream: true }`. A decoder created inside `feed()`
 * would reset its internal state on every call, corrupting multi-byte UTF-8
 * characters (emoji, non-Latin text) that happen to be split across two
 * network chunks. `flush()` performs the final non-streaming decode so any
 * bytes still buffered inside the decoder are released.
 */
export class SseParser {
  private buffer = "";
  private dataLines: string[] = [];
  private decoder = new TextDecoder();

  feed(chunk: Uint8Array): string[] {
    const out: string[] = [];
    this.buffer += this.decoder.decode(chunk, { stream: true });
    while (true) {
      const nl = this.buffer.indexOf("\n");
      if (nl === -1) break;
      let line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        if (this.dataLines.length) {
          out.push(this.dataLines.join("\n"));
          this.dataLines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue; // comment
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon).trim();
      const value =
        colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "data") this.dataLines.push(value);
    }
    return out;
  }

  /** Flush any payload still in the buffer (stream ended without blank line). */
  flush(): string[] {
    // Final (non-streaming) decode releases any bytes the decoder was still
    // holding back while waiting for a complete multi-byte sequence.
    this.buffer += this.decoder.decode();
    const out = this.dataLines.length ? [this.dataLines.join("\n")] : [];
    this.dataLines = [];
    return out;
  }
}
