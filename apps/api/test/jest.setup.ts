import "reflect-metadata";

// Dummy-but-valid env so AppModule's zod validation passes when the e2e test
// boots the full app. Real values are injected via k8s Secrets at deploy time.
process.env.DATABASE_URL ??= "postgres://clasher:clasher@localhost:5432/clasher_test";
process.env.REDIS_QUEUE_URL ??= "redis://localhost:6379/0";
process.env.REDIS_CACHE_URL ??= "redis://localhost:6379/1";
process.env.NODE_ENV ??= "test";
