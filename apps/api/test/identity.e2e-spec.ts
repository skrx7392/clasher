import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UserRole } from "@clasher/shared";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.setup";
import { UsersRepository, type User } from "../src/identity/users.repository";

/**
 * In-memory stand-in for {@link UsersRepository}. Mirrors the real contract: the
 * sign-in upsert creates new users with role `'none'` and NEVER changes an
 * existing user's role. (The real-Postgres proof of the SQL — DB default,
 * CHECK, no-elevation, seed — lives in `packages/db` identity tests.)
 */
class FakeUsersRepository {
  private readonly bySub = new Map<string, User>();

  /** Test helper: place a user at a specific role (stands in for the out-of-band seed). */
  seed(
    googleSub: string,
    role: UserRole,
    identity?: { email?: string | null; name?: string | null },
  ): User {
    const user: User = {
      id: randomUUID(),
      googleSub,
      email: identity?.email ?? null,
      name: identity?.name ?? null,
      role,
      createdAt: new Date(),
    };
    this.bySub.set(googleSub, user);
    return user;
  }

  upsertFromSignIn(input: {
    googleSub: string;
    email?: string | null;
    name?: string | null;
  }): Promise<User> {
    const existing = this.bySub.get(input.googleSub);
    const user: User = existing
      ? {
          ...existing, // role preserved; identity fields write-once (COALESCE)
          email: existing.email ?? input.email ?? null,
          name: existing.name ?? input.name ?? null,
        }
      : {
          id: randomUUID(),
          googleSub: input.googleSub,
          email: input.email ?? null,
          name: input.name ?? null,
          role: UserRole.None, // DB default
          createdAt: new Date(),
        };
    this.bySub.set(input.googleSub, user);
    return Promise.resolve(user);
  }

  findByGoogleSub(googleSub: string): Promise<User | null> {
    return Promise.resolve(this.bySub.get(googleSub) ?? null);
  }
}

describe("Identity + roles (e2e, #15)", () => {
  let app: INestApplication;
  let repo: FakeUsersRepository;

  beforeAll(async () => {
    repo = new FakeUsersRepository();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UsersRepository)
      .useValue(repo)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("upsert persists a NEW user with role 'none' (least privilege)", async () => {
    const res = await http()
      .post("/api/identity/users/upsert")
      .send({ googleSub: "sub-new", email: "a@example.com", name: "Ada" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("none");
    expect(res.body.id).toEqual(expect.any(String));
    // Minimal response: no email/name/googleSub harvested back to the caller.
    expect(res.body).not.toHaveProperty("email");
    expect(res.body).not.toHaveProperty("googleSub");
    expect((await repo.findByGoogleSub("sub-new"))?.role).toBe("none");
  });

  it("upsert is write-once on identity — cannot overwrite an existing email/name", async () => {
    repo.seed("sub-wo", UserRole.None, { email: "real@example.com", name: "Real" });
    await http()
      .post("/api/identity/users/upsert")
      .send({ googleSub: "sub-wo", email: "evil@example.com", name: "Evil" });
    const after = await repo.findByGoogleSub("sub-wo");
    expect(after?.email).toBe("real@example.com");
    expect(after?.name).toBe("Real");
  });

  it("rejects a `role` field in the upsert body (no request path sets role)", async () => {
    const res = await http()
      .post("/api/identity/users/upsert")
      .send({ googleSub: "sub-evil", role: "admin" });
    expect(res.status).toBe(400);
    // And nothing was created, so the subject still cannot reach an admin route.
    expect(await repo.findByGoogleSub("sub-evil")).toBeNull();
  });

  it("rejects any unknown field (strict schema)", async () => {
    const res = await http()
      .post("/api/identity/users/upsert")
      .send({ googleSub: "sub-x", isAdmin: true });
    expect(res.status).toBe(400);
  });

  it("upsert NEVER elevates an existing user's role", async () => {
    repo.seed("sub-mgr", UserRole.Manager);
    const res = await http()
      .post("/api/identity/users/upsert")
      .send({ googleSub: "sub-mgr", name: "Renamed" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("manager"); // unchanged by the upsert
  });

  it("GET /me resolves the current user with role read from the DB", async () => {
    await http().post("/api/identity/users/upsert").send({ googleSub: "sub-me" });
    const res = await http().get("/api/identity/me").set("x-clasher-google-sub", "sub-me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ googleSub: "sub-me", role: "none" });
  });

  it("GET /me is default-deny without a resolved user (403)", async () => {
    const res = await http().get("/api/identity/me");
    expect(res.status).toBe(403);
  });

  it("admin route denies a 'none' user (403) and allows a seeded admin (200)", async () => {
    await http().post("/api/identity/users/upsert").send({ googleSub: "sub-plain" });
    const denied = await http()
      .get("/api/identity/admin/ping")
      .set("x-clasher-google-sub", "sub-plain");
    expect(denied.status).toBe(403);

    repo.seed("sub-admin", UserRole.Admin); // out-of-band promotion
    const allowed = await http()
      .get("/api/identity/admin/ping")
      .set("x-clasher-google-sub", "sub-admin");
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ status: "ok" });
  });

  it("a client cannot self-assert a role: only the DB role governs the guard", async () => {
    await http().post("/api/identity/users/upsert").send({ googleSub: "sub-claims-admin" });
    // Even sending a bogus role-claiming header, the guard reads role from the DB ('none').
    const res = await http()
      .get("/api/identity/admin/ping")
      .set("x-clasher-google-sub", "sub-claims-admin")
      .set("x-clasher-role", "admin");
    expect(res.status).toBe(403);
  });
});

describe("Production: the M0 header seam is disabled (#15)", () => {
  let app: INestApplication;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = "production";
    const repo = new FakeUsersRepository();
    repo.seed("prod-admin", UserRole.Admin); // a real, DB-seeded admin
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UsersRepository)
      .useValue(repo)
      .compile();
    app = configureApp(moduleRef.createNestApplication());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = savedNodeEnv;
  });

  it("ignores x-clasher-google-sub so guarded routes stay default-deny (403)", async () => {
    // Even with a real seeded admin's subject, production refuses the spoofable header.
    const res = await request(app.getHttpServer())
      .get("/api/identity/admin/ping")
      .set("x-clasher-google-sub", "prod-admin");
    expect(res.status).toBe(403);
  });
});
