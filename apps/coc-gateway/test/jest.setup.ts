import "reflect-metadata";

// Dummy-but-valid env so AppModule boots in e2e. The key is fake; never a real one.
process.env.COC_API_KEY ??= "test-coc-key-not-real";
process.env.COC_PROXY_BASE_URL ??= "https://cocproxy.royaleapi.dev/v1";
process.env.NODE_ENV ??= "test";
