-- Apply once per MySQL instance with an administrative migration account.
CREATE DATABASE IF NOT EXISTS keepalive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS keepalive.keepalive_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    ping_time DATETIME(6) NOT NULL DEFAULT (UTC_TIMESTAMP(6)),
    status VARCHAR(16) NOT NULL,
    request_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    UNIQUE KEY keepalive_request_id (request_id),
    KEY keepalive_latest (ping_time DESC, id DESC)
) ENGINE=InnoDB;

-- Provision a dedicated TLS-required user restricted to the connection source.
-- Grant SELECT and INSERT on keepalive.keepalive_logs to that user only.
-- Do not give the service database/user creation or UPDATE/DELETE permissions.
