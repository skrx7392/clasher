import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { AuthModule } from "./auth/auth.module";
import { IdentityModule } from "./identity/identity.module";
import { ClansModule } from "./clans/clans.module";
import { WarModule } from "./war/war.module";
import { IngestModule } from "./ingest/ingest.module";
import { GiveawaysModule } from "./giveaways/giveaways.module";
import { RankingModule } from "./ranking/ranking.module";

@Module({
  imports: [
    // Global, zod-validated config — aborts startup on misconfig (NFR-6).
    AppConfigModule,
    // Global Postgres pool (lazy; no connection until first query).
    DatabaseModule,
    HealthModule,
    // Feature modules (DESIGN §2) — skeletons, filled in across M1–M4.
    AuthModule,
    IdentityModule,
    ClansModule,
    WarModule,
    IngestModule,
    GiveawaysModule,
    RankingModule,
  ],
})
export class AppModule {}
