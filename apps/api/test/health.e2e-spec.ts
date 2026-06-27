import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { DATABASE_POOL } from "../src/database/database.module";

describe("Health (e2e)", () => {
  let app: INestApplication;
  // Stub the pool so readiness can be driven both ways without a real Postgres.
  let dbUp = true;
  const poolStub = {
    query: async () => {
      if (!dbUp) throw new Error("connection refused");
      return { rows: [{ "?column?": 1 }] };
    },
    end: async () => {},
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DATABASE_POOL)
      .useValue(poolStub)
      .compile();
    // Use the real shared setup so the /api prefix under test is the one main.ts uses.
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/health -> 200 { status: ok }", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("GET /api/ready -> 200 when Postgres responds", async () => {
    dbUp = true;
    const res = await request(app.getHttpServer()).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", checks: { postgres: "ok" } });
  });

  it("GET /api/ready -> 503 when Postgres is unreachable", async () => {
    dbUp = false;
    const res = await request(app.getHttpServer()).get("/api/ready");
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ postgres: "down" });
    dbUp = true;
  });
});
