import type { LoggerService, LogLevel } from "@nestjs/common";
import { redactSecrets } from "./redact";

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => process.stdout.write(line + "\n");

/**
 * Structured (JSON) logger that runs every payload through {@link redactSecrets}
 * before emitting, so a `token` (or other credential) in a request/response/error
 * object can never reach a log line (NFR-11, FR-4). Implements Nest's
 * LoggerService so it is the app-wide logger.
 *
 * The sink is injectable so tests can capture emitted lines.
 */
export class RedactingLogger implements LoggerService {
  constructor(private readonly sink: LogSink = defaultSink) {}

  private emit(level: LogLevel, message: unknown, meta: unknown[]): void {
    const record: Record<string, unknown> = {
      level,
      message: typeof message === "string" ? message : redactSecrets(message),
    };
    if (meta.length > 0) record.meta = redactSecrets(meta);
    this.sink(JSON.stringify(record));
  }

  log(message: unknown, ...meta: unknown[]): void {
    this.emit("log", message, meta);
  }
  error(message: unknown, ...meta: unknown[]): void {
    this.emit("error", message, meta);
  }
  warn(message: unknown, ...meta: unknown[]): void {
    this.emit("warn", message, meta);
  }
  debug(message: unknown, ...meta: unknown[]): void {
    this.emit("debug", message, meta);
  }
  verbose(message: unknown, ...meta: unknown[]): void {
    this.emit("verbose", message, meta);
  }
}
