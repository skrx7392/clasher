import {
  BadRequestException,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Post,
} from "@nestjs/common";
import { normalizeCocTag } from "@clasher/shared";

/**
 * Internal-only surface consumed by apps/api over the cluster network (never
 * exposed publicly). Real implementations land in M1 (verifytoken) and M2 (clan
 * lookups) — they will use the token pool, rate limiter, and RoyaleAPI proxy.
 */
@Controller("internal")
export class InternalController {
  /**
   * Proxy `POST /players/{tag}/verifytoken`. The in-game token is NEVER persisted
   * and is redacted from all logs (NFR-11, FR-4). Placeholder until M1.
   */
  @Post("verifytoken")
  verifyToken(): never {
    throw new NotImplementedException("verifytoken not implemented yet");
  }

  /** Proxy `GET /clans/{tag}`. Placeholder until M2. */
  @Get("clan/:tag")
  clan(@Param("tag") tag: string): never {
    // SSRF / path-injection guard at the boundary: reject anything that is not a
    // well-formed tag before it could ever reach an outbound URL (DESIGN §4).
    if (normalizeCocTag(tag) === null) {
      throw new BadRequestException("invalid clan tag");
    }
    throw new NotImplementedException("clan lookup not implemented yet");
  }
}
