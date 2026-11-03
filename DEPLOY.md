# Деплой «Хто зверху»

Сайт: https://chtozwerchu.wtmelon.store. Coolify збирає Dockerfile з
`Kybikov/chtozwerchu`, гілка `master`, порт 3000. Реліз закріплюється за
перевіреним SHA. Автодеплой вимкнений, щоб проміжні push не переривали гру.

## Послідовність релізу

1. Оновити версію package.json, lock-файлу й /api/health.
2. Виконати npm test, npm run build, у server — go test ./... і go vet ./....
3. Перевірити змінені сценарії у браузері, телефон і TV-сцену.
4. Commit і push у master без force push.
5. У Coolify задати точний SHA та запустити deploy.
6. Дочекатися завершення, звірити образ, SOURCE_COMMIT, /api/health та оболонку.
7. Перевірити через HTTPS акаунти, Deezer, кімнати, пульт/сцену й аудіо.
8. Перевірити CI, включно з go test -race на Linux.

PWA-керування (`/sw.js`, `/pwa-update-guard.js`, `/manifest.webmanifest`, HTML) має відповідати з
`Cache-Control: no-store, no-cache, must-revalidate`. Не кешувати ці файли
правилами CDN. Якщо CDN уже тримає старий `/sw.js`, очистити тільки
`https://chtozwerchu.wtmelon.store/sw.js` у Cloudflare та перевірити оновлення
у вже відкритому PWA. Заголовок нового origin-відгуку не очищає старий кеш.

Для відкату вибрати попередній SHA у Coolify та повторити deploy. Бази й
постійні томи не видаляти. Міграції 1.4 додають таблиці, зберігаючи старі дані.

## Дані та середовище

PostgreSQL khz-game-postgres і Redis khz-game-redis керуються Coolify.
Їхні порти не публікуються; вони живуть у приватній мережі застосунку.
Прототип має окрему базу, без доступу до цих даних та бази WTAdmin.

Runtime-секрети Coolify: DATABASE_URL, REDIS_URL, JWT_SECRET, DEEZER_ARL
або DEEZER_ACCESS_TOKEN. Без префікса VITE_ та без build-time передачі.
ARL дозволяє поновлювати короткочасний JWT. Акаунт і плейлисти не змінюються.

| Змінна | Значення |
|---|---|
| PORT | 3000 |
| HOST | 0.0.0.0 |
| WEB_DIR | /app/web |
| LEGACY_WEB_DIR | /app/classic |
| STUDIO_STATE_DIR | /app/state/studio |
| PARTY_STATE_DIR | /app/state/party |
| PUBLIC_URL | https://chtozwerchu.wtmelon.store |

До /app/state підключено приватний постійний том. Він містить ключі учасників
і приховані відповіді; його не можна роздавати як статику. Кімнати після
перезапуску відновлюються на паузі, без автоматичного запуску звуку.

Health-check: /api/health → HTTP 200, ok:true, очікувані version і commit,
accounts:true. Налаштована, але недоступна база дає HTTP 503.
З REDIS_URL також очікується roomTransport:redis. Втрата координатора
закриває мережеві підключення; клієнти перепідключаються й відновлюють гру
на паузі. Налаштований, але недоступний Redis дає HTTP 503 замість окремої
неузгодженої гри в пам’яті.

Для кількох інстансів потрібні однакові Redis, DATABASE_URL, JWT_SECRET та
ROOM_CLUSTER_NAMESPACE (типово khz:rooms:v1). Sticky sessions не потрібні.
Стан кімнат приватний, не кешується CDN. Redis потребує постійного тому,
AOF appendonly yes, appendfsync everysec та noeviction. На VPS це перевірено.
Рішення розраховане на один основний Redis; Redis Cluster не налаштований.

Перехід з 1.8 на 1.9 виконувати із зупиненням старого інстансу перед
запуском нового: 1.8 не знає про координацію Redis. Перед зупиненням
зберегти приватний том і перевірити відсутність активної партії. Подальші
інстанси 1.9 можуть працювати разом. Lease власника — 6 секунд; після
аварійної втрати процесу потрібні його сплив і перепідключення клієнта.

Старі приватні файли імпортуються один раз на том і namespace. Маркер
.redis-bootstrap-* не видаляти під час звичайного релізу. Після переходу
основним є Redis: старий файл не відновлює закриту кімнату. Відновлення
з резервної копії Redis або файлів виконувати окремо, при зупинених вузлах.

## Локальний запуск

npm ci, npm run build, npm start. Сайт слухає 127.0.0.1:5599.
Без PostgreSQL гостьова гра працює, акаунти недоступні. npm run dev запускає
Vite на 5173. STUDIO_API_URL окремо визначає сервер акаунтів і кімнат,
MUSIC_API_URL — музичний API.

docker compose up --build піднімає локальний стек. Його тестові паролі слід
замінити для публічного використання. Coolify використовує окремі випадкові
runtime-секрети.

Функції та обмеження: [реліз 1.24](docs/release-1.24.md), [стан повного аудіо](docs/music-playback.md).
