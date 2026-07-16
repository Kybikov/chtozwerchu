# ---- build stage ----
FROM golang:1.24-alpine AS build
WORKDIR /src/server

COPY server/go.mod server/go.sum ./
RUN go mod download

COPY server/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ---- run stage ----
FROM alpine:3.20
RUN adduser -D -H app && apk add --no-cache wget
WORKDIR /app

COPY --from=build /out/server /app/server
COPY web /app/web

ENV PORT=3000 WEB_DIR=/app/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

USER app
CMD ["/app/server"]
