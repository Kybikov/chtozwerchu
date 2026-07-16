# Деплой «Хто зверху? online»

Грі потрібні три контейнери: **app** (Go), **postgres**, **redis**.
Найпростіше — підняти весь `docker-compose.yml` одним стеком.

Гілка з кодом: `claude/king-of-hill-online-game-4hb9i0`.

---

## Варіант A — Coolify через Docker Compose (рекомендовано)

1. Coolify → **+ New** → **Resource** → **Docker Compose** (Empty / from Git).
2. Source: цей GitHub-репозиторій, **Branch:** `claude/king-of-hill-online-game-4hb9i0`.
3. Compose file: `docker-compose.yml` (у корені).
4. У сервісі `app` Coolify сам візьме `build: .` (Dockerfile у корені).
5. Домен: признач домен на сервіс **app**, внутрішній порт **3000**.
6. (Опційно) Env для `app`:
   - `PUBLIC_URL=https://твій-домен` (для інвайт-лінків; без нього береться домен із браузера).
7. **Deploy.** Postgres мігрує й засівається автоматично при першому старті.

Health-чек: `GET /health` та `/api/health` → `{"ok":true}`.

> Якщо Coolify вимагає прибрати `ports:` (він сам проксує) — можна видалити
> блок `ports:` у сервісі `app`; решта лишається як є.

---

## Варіант B — SSH вручну (docker compose)

На сервері (де є Docker + Compose):

```bash
git clone -b claude/king-of-hill-online-game-4hb9i0 <URL_репозиторію> khz
cd khz
docker compose up -d --build
```

Відкрити: `http://СЕРВЕР:3000` (або постав nginx/Caddy як reverse-proxy на 80/443).

Перевірка:

```bash
docker compose ps
docker compose logs -f app       # має бути "listening on :3000"
curl -s localhost:3000/api/health
```

Оновлення після нового пушу:

```bash
git pull
docker compose up -d --build
```

---

## Змінні середовища (app)

| Змінна | Значення у compose | Нащо |
|---|---|---|
| `PORT` | `3000` | порт HTTP |
| `DATABASE_URL` | `postgres://khz:khz@postgres:5432/khz?sslmode=disable` | Postgres |
| `REDIS_URL` | `redis://redis:6379/0` | Redis |
| `WEB_DIR` | `/app/web` | статика |
| `PUBLIC_URL` | (порожньо) | базовий URL для інвайтів |
| `JWT_SECRET` | *(задай свій!)* | підпис токенів акаунтів |

> **Важливо для проду:** признач власний `JWT_SECRET` (довгий випадковий рядок)
> у сервісі `app`, інакше використовується дефолт `dev-secret-change-me`.

---

## Постійні дані

- Postgres тримає дані у volume `pgdata` (акаунти, історія матчів, каталог).
- Кімнати живуть у пам’яті app; після рестарту активні кімнати очищаються
  (нормально для пати-гри). Акаунти й історія — у Postgres, зберігаються.

---

## Типові проблеми

- **app рестартиться / «postgres connect»** — БД ще піднімається; app робить
  ретраї ~30с. Якщо довше — перевір `docker compose logs postgres`.
- **Реєстрація віддає 503** — `DATABASE_URL` порожній/недоступний, гра працює в
  embedded-режимі без акаунтів. Перевір env і мережу до postgres.
- **Мелодія без аудіо** — сервер не має вихід у `api.deezer.com`. Раунд усе одно
  грається (ведучий наспівує). Відкрий вихідний трафік до Deezer, щоб було аудіо.
