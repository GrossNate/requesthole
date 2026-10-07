#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
docker compose config --format json | node -e '
  const assert = require("node:assert/strict");
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const config = JSON.parse(input);
    const services = config.services;
    assert.ok(services.backend.healthcheck, "backend must have a healthcheck");
    assert.ok(services.nginx.healthcheck, "nginx must have a healthcheck");
    assert.equal(
      services.nginx.depends_on.backend.condition,
      "service_healthy",
      "nginx must wait for a healthy backend",
    );
    assert.deepEqual(Object.keys(services.backend.networks), ["backend_private"]);
    assert.deepEqual(Object.keys(services.nginx.networks), ["backend_private"]);
    assert.ok(config.networks.backend_private.ipam.config[0].subnet);
    assert.equal(
      services.backend.environment.TRUSTED_PROXY_ADDRESS,
      services.nginx.networks.backend_private.ipv4_address,
      "backend must trust only the configured proxy address",
    );
  });
'
