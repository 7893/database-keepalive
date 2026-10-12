.PHONY: all build build-amd64 test tick run serve deploy clean

all: build

build:
	CGO_ENABLED=0 go build -ldflags="-s -w" -o database-keepalive .

build-amd64:
	mkdir -p bin
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o bin/database-keepalive-linux-amd64 .

tick: build
	./database-keepalive tick

run: build
	./database-keepalive daemon

serve: build
	./database-keepalive serve

deploy:
	./scripts/deploy.sh use --force

clean:
	rm -rf database-keepalive bin/
