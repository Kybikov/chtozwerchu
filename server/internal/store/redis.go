package store

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Cache wraps Redis. The server coordinator uses a private client for canonical
// room snapshots, ownership fencing and per-connection pub/sub delivery.
type Cache struct {
	rdb *redis.Client
}

// RedisClient is for the server's private room coordinator. It is never exposed
// through an HTTP response or embedded in frontend configuration.
func (c *Cache) RedisClient() *redis.Client { return c.rdb }

// ConnectRedis dials Redis, retrying briefly for docker-compose startup.
func ConnectRedis(ctx context.Context, url string) (*Cache, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	rdb := redis.NewClient(opt)
	var pingErr error
	for attempt := 0; attempt < 15; attempt++ {
		if pingErr = rdb.Ping(ctx).Err(); pingErr == nil {
			return &Cache{rdb: rdb}, nil
		}
		select {
		case <-ctx.Done():
			rdb.Close()
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	rdb.Close()
	return nil, pingErr
}

func (c *Cache) Close() error { return c.rdb.Close() }

func (c *Cache) Ping(ctx context.Context) error { return c.rdb.Ping(ctx).Err() }

// SaveRoomSnapshot stores a JSON snapshot under room:{code} with a TTL so
// abandoned rooms expire automatically. Best-effort: errors are non-fatal.
func (c *Cache) SaveRoomSnapshot(ctx context.Context, code string, payload []byte, ttl time.Duration) {
	_ = c.rdb.Set(ctx, "room:"+code, payload, ttl).Err()
}

// DeleteRoom removes a room snapshot.
func (c *Cache) DeleteRoom(ctx context.Context, code string) {
	_ = c.rdb.Del(ctx, "room:"+code).Err()
}

// RoomExists reports whether a room snapshot is registered cluster-wide.
func (c *Cache) RoomExists(ctx context.Context, code string) bool {
	n, err := c.rdb.Exists(ctx, "room:"+code).Result()
	return err == nil && n > 0
}
