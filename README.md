# Five Words Party Game

Локальна браузерна гра для двох команд у стилі "Хто зверху?".

## Local

```bash
npm start
```

Default local URL:

```text
http://127.0.0.1:5507
```

## Docker

```bash
docker build -t five-words-game .
docker run --rm -p 3000:3000 five-words-game
```

Open:

```text
http://127.0.0.1:3000
```

## Coolify

1. Push this folder to GitHub.
2. In Coolify create a new app from the GitHub repository.
3. Build Pack: `Dockerfile`.
4. Exposed port: `3000`.
5. Optional env:
   - `PUBLIC_URL=https://your-domain.com`

If `PUBLIC_URL` is empty, invite links use the current browser domain automatically.

Health checks:

```text
/health
/api/health
```

## Notes

Rooms are stored in memory. Restarting the container clears active rooms and scores.
