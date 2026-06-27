import { Module } from "@nestjs/common";
import { AppConfigModule } from "./config/config.module";
import { CocModule } from "./coc/coc.module";
import { HealthController } from "./health/health.controller";
import { InternalController } from "./internal/internal.controller";

@Module({
  imports: [AppConfigModule, CocModule],
  controllers: [HealthController, InternalController],
})
export class AppModule {}
