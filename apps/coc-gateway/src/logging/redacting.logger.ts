import type { LoggerService, LogLevel } from "@nestjs/common";
import { redactSecrets } from "./redact";

export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => process.stdout.write(line + "\n");

export interface RedactingLoggerOptions {
  /** Where lines go (default stdout). Tests inject a capturing sink. */
  sink?: LogSink;
  /** Literal secrets (e.g. the official key) to scrub from EVERY string logged. */
  secrets?: readonly string[];
}

/**
 * Structured (JSON) logger that runs every payload — including string messages,
 * error stacks, and metadata — through {@link redactSecrets} before emitting, so
 * a token or the official key can never reach a log line (NFR-11, FR-4).
 * Implements Nest's LoggerService so it is the app-wide logger.
 */
export class RedactingLogger implements LoggerService {
  private readonly sink: LogSink;
  private readonly redactOpts: { secrets: readonly string[] };

  constructor(options: RedactingLoggerOptions = {}) {
    this.sink = options.sink ?? defaultSink;
    this.redactOpts = { secrets: options.secrets ?? [] };
  }

  private emit(level: LogLevel, message: unknown, meta: unknown[]): void {
    const record: Record<string, unknown> = {
      level,
      // Strings are scrubbed too — never passed through verbatim.
      message: redactSecrets(message, this.redactOpts),
    };
    if (meta.length > 0) record.meta = redactSecrets(meta, this.redactOpts);
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
