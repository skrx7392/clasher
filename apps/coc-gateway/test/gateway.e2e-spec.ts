import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("coc-gateway (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health -> 200", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /internal/verifytoken -> 501 (placeholder)", async () => {
    const res = await request(app.getHttpServer()).post("/internal/verifytoken").send({});
    expect(res.status).toBe(501);
  });

  it("GET /internal/clan/:tag -> 400 for an invalid tag (SSRF guard)", async () => {
    const res = await request(app.getHttpServer()).get("/internal/clan/not-a-tag");
    expect(res.status).toBe(400);
  });

  it("GET /internal/clan/:tag -> 501 for a valid tag (placeholder)", async () => {
    // %23 == '#'
    const res = await request(app.getHttpServer()).get("/internal/clan/%23PYL");
    expect(res.status).toBe(501);
  });
});
