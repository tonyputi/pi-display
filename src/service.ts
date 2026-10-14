import { mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { DisplayDriver } from "./display.ts";
import { decodeFrame, encodeMessage, type EncodedFrame, type ServiceResponse } from "./protocol.ts";

/** Fixed socket path: the systemd unit provides /run/pi-display via RuntimeDirectory=. Override with PI_DISPLAY_SOCKET. */
export const DEFAULT_SOCKET_PATH = "/run/pi-display/pi-display.sock";

export function defaultSocketPath(): string {
  return process.env.PI_DISPLAY_SOCKET ?? DEFAULT_SOCKET_PATH;
}

export interface DisplayServiceOptions {
  socketPath?: string;
}

/**
 * Owns the display and serves JSONL requests from Pi extension clients.
 * The bound socket doubles as the single-instance lock: only one service
 * can listen on the path, so concurrent Pi processes never share the bus.
 */
export class DisplayService {
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private display?: DisplayDriver;

  private readonly path: string;

  private constructor(path: string, server: Server) {
    this.path = path;
    this.server = server;
    server.on("connection", (socket) => this.handleConnection(socket));
  }

  /** Bind the service socket. Throws when another service instance is already listening. */
  static async create(socketPath: string = defaultSocketPath()): Promise<DisplayService> {
    if (await isSocketAlive(socketPath)) {
      throw new Error(`another pi-display service is already listening on ${socketPath}`);
    }
    mkdirSync(dirname(socketPath), { recursive: true });
    try {
      unlinkSync(socketPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    return new DisplayService(socketPath, server);
  }

  get socketPath(): string {
    return this.path;
  }

  /** Attach the display after the socket lock is held, so a failed open never steals the bus. */
  setDisplay(display: DisplayDriver): void {
    this.display = display;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    try {
      unlinkSync(this.path);
    } catch {
      // The socket file may already be gone.
    }
  }

  /** Handle one decoded request; also usable by tests without a socket. */
  async handleRequest(request: unknown): Promise<ServiceResponse> {
    if (!request || typeof request !== "object") {
      return { type: "error", message: "invalid request" };
    }
    const { type, frame } = request as { type?: unknown; frame?: unknown };
    if (type !== "show") {
      return { type: "error", message: `unsupported message type ${String(type)}` };
    }
    if (!this.display) {
      return { type: "error", message: "no display attached" };
    }
    try {
      await this.display.render(decodeFrame(frame as EncodedFrame));
      return { type: "ok" };
    } catch (error) {
      return { type: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  private handleConnection(socket: Socket): void {
    this.sockets.add(socket);
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) void this.handleLine(socket, line);
      }
    });
    socket.on("error", () => socket.destroy());
    socket.on("close", () => this.sockets.delete(socket));
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      socket.write(encodeMessage({ type: "error", message: "invalid JSON message" } satisfies ServiceResponse));
      return;
    }
    socket.write(encodeMessage(await this.handleRequest(request)));
  }
}

async function isSocketAlive(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}
