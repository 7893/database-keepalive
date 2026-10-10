FROM cloudflare/cloudflared:2026.9.3 AS tunnel
FROM golang:1.27.2-bookworm AS build
RUN curl -fsSL https://public.dhe.ibm.com/ibmdl/export/pub/software/data/db2/drivers/odbc_cli/v12.1.4/linuxx64_odbc_cli.tar.gz -o /tmp/cli.tar.gz \
    && echo '77b754d19be2cd5c55f6feb8bd951c2b17aa6646289944855612c5a2ac555f55  /tmp/cli.tar.gz' | sha256sum -c - \
    && mkdir -p /opt/ibm && tar -xzf /tmp/cli.tar.gz -C /opt/ibm && rm /tmp/cli.tar.gz
RUN curl -fsSL https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem -o /opt/ibm/db2-ca.pem \
    && echo '39fdcf28aeffe08d03251fccaf645e3c5de19fa4ebbafc89b4ede2a422148bab  /opt/ibm/db2-ca.pem' | sha256sum -c -
ENV CGO_ENABLED=1 \
    CGO_CFLAGS=-I/opt/ibm/clidriver/include \
    CGO_LDFLAGS=-L/opt/ibm/clidriver/lib
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/server/ ./cmd/server/
COPY internal/ ./internal/
RUN go build -tags db2 -trimpath -ldflags='-s -w' -o /keepalive ./cmd/server

FROM build AS native-test
RUN LD_LIBRARY_PATH=/opt/ibm/clidriver/lib go test -tags db2 ./internal/...

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libxml2 libpam0 libstdc++6 libcrypt1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=tunnel /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=build /opt/ibm/clidriver /opt/ibm/clidriver
COPY --from=build /opt/ibm/db2-ca.pem /app/vendor/db2-ca.pem
COPY --from=build /keepalive /app/keepalive
ENV LD_LIBRARY_PATH=/opt/ibm/clidriver/lib TZ=UTC DB2CODEPAGE=1208
WORKDIR /app
CMD ["/app/keepalive"]
