import { connect, type Socket } from "node:net";
import type { DisplayFrame } from "./display.ts";
import { encodeFrame, encodeMessage, type ServiceRequest, type ServiceResponse } from "./protocol.ts";

interface PendingResponse {
  resolve: (response: ServiceResponse) => void;
  reject: (error: Error) => void;
}

/** Minimal JSONL client for the pi-display service. Requests are serialized; one response is awaited at a time. */
export class DisplayClient {
  private readonly socket: Socket;
  private queue: Promise<unknown> = Promise.resolve();
  private responseBuffer = "";
  private pending?: PendingResponse;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk) => this.handleData(chunk.toString("utf8")));
    socket.on("close", () => this.failPending(new Error("pi-display service connection closed")));
    socket.on("error", () => undefined);
  }

  static connect(socketPath: string, timeoutMs = 1000): Promise<DisplayClient> {
    return new Promise((resolve, reject) => {
      const socket = connect(socketPath);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`timed out connecting to the pi-display service at ${socketPath}`));
      }, timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(new DisplayClient(socket));
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`pi-display service not reachable at ${socketPath} (${error.message})`));
      });
    });
  }

  /** Render a frame on the service's display. Resolves once the service confirms. */
  async showFrame(frame: DisplayFrame): Promise<void> {
    const response = await this.request({ type: "show", frame: encodeFrame(frame) });
    if (response.type === "error") {
      throw new Error(`pi-display service rejected the frame: ${response.message}`);
    }
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.socket.end(() => resolve()));
  }

  private request(message: ServiceRequest): Promise<ServiceResponse> {
    const attempt = () =>
      new Promise<ServiceResponse>((resolve, reject) => {
        if (this.socket.destroyed) {
          reject(new Error("pi-display service connection closed"));
          return;
        }
        this.pending = { resolve, reject };
        this.socket.write(encodeMessage(message));
      });
    const result = this.queue.then(attempt, attempt);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private handleData(chunk: string): void {
    this.responseBuffer += chunk;
    let index: number;
    while ((index = this.responseBuffer.indexOf("\n")) >= 0) {
      const line = this.responseBuffer.slice(0, index).trim();
      this.responseBuffer = this.responseBuffer.slice(index + 1);
      if (!line || !this.pending) continue;
      const pending = this.pending;
      this.pending = undefined;
      try {
        pending.resolve(JSON.parse(line) as ServiceResponse);
      } catch {
        pending.reject(new Error("invalid response from the pi-display service"));
      }
    }
  }

  private failPending(error: Error): void {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    pending.reject(error);
  }
}
