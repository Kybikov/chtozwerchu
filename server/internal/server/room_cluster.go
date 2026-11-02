package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

var (
	errRoomMissing        = errors.New("room not found")
	errRoomOwner          = errors.New("room ownership changed")
	errClusterUnavailable = errors.New("room coordination unavailable")
	clusterNamespace      = regexp.MustCompile(`^[A-Za-z0-9:_-]{1,100}$`)
)

type clusterHooks struct {
	restore func(roomBinding, []byte) error
	suspend func(roomBinding)
	accept  func(string, roomConnection, string)
	end     func(context.Context, roomBinding, string) (int, []byte)
}
type clusterOwned struct {
	binding  roomBinding
	sequence uint64
	loading  chan struct{}
}
type relayPacket struct {
	Op            string      `json:"op"`
	From          string      `json:"from"`
	ID            string      `json:"id"`
	Binding       roomBinding `json:"binding"`
	Sequence      uint64      `json:"sequence"`
	Data          []byte      `json:"data,omitempty"`
	Cookie        string      `json:"cookie,omitempty"`
	Authorization string      `json:"authorization,omitempty"`
	Status        int         `json:"status,omitempty"`
}
type clusterRemote struct {
	socket *clusterSocket
	from   string
}
type clusterHTTPReply struct {
	status int
	body   []byte
}
type clusterHTTPWaiter struct {
	owner string
	reply chan clusterHTTPReply
}

type roomCluster struct {
	id, prefix string
	ttl        time.Duration
	rdb        *redis.Client
	ctx        context.Context
	cancel     context.CancelFunc
	ready      atomic.Bool
	closed     sync.Once
	mu         sync.Mutex
	sub        *redis.PubSub
	owned      map[string]*clusterOwned
	remote     map[string]*clusterRemote
	peers      map[string]*clusterPeer
	waiters    map[string]clusterHTTPWaiter
	hooks      clusterHooks
}

func newRoomCluster(base *redis.Client, prefix string, ttl time.Duration, hooks clusterHooks) (*roomCluster, error) {
	if !clusterNamespace.MatchString(prefix) {
		return nil, errors.New("invalid room namespace")
	}
	if ttl <= 0 {
		ttl = 6 * time.Second
	}
	id := studioSecret()
	options := *base.Options()
	options.ClientName = "khz-room-" + id
	options.MaxRetries = -1 // A lost command is recovered by reconnecting, not replayed blindly.
	options.DialTimeout = time.Second
	options.ReadTimeout = 1500 * time.Millisecond
	options.WriteTimeout = 1500 * time.Millisecond
	options.ContextTimeoutEnabled = true
	ctx, cancel := context.WithCancel(context.Background())
	c := &roomCluster{id: id, prefix: prefix, ttl: ttl, rdb: redis.NewClient(&options), ctx: ctx, cancel: cancel, hooks: hooks, owned: map[string]*clusterOwned{}, remote: map[string]*clusterRemote{}, peers: map[string]*clusterPeer{}, waiters: map[string]clusterHTTPWaiter{}}
	sub, err := c.subscribe()
	if err != nil {
		cancel()
		c.rdb.Close()
		return nil, err
	}
	c.sub = sub
	c.ready.Store(true)
	go c.listen(sub)
	go c.heartbeat()
	return c, nil
}
func (c *roomCluster) channel(node string) string    { return c.prefix + ":bus:" + node }
func (c *roomCluster) nodeKey(node string) string    { return c.prefix + ":node:" + node }
func (c *roomCluster) key(b roomBinding) string      { return b.Kind + ":" + b.Code }
func (c *roomCluster) ownerKey(b roomBinding) string { return c.prefix + ":owner:" + c.key(b) }
func (c *roomCluster) stateKey(b roomBinding) string { return c.prefix + ":state:" + c.key(b) }
func validRoomBinding(b roomBinding) bool {
	return b.Kind == "party" && partyCode.MatchString(b.Code) || b.Kind == "studio" && validStudioCode(b.Code)
}
func ownerNode(epoch string) string { return strings.SplitN(epoch, ".", 2)[0] }

func (c *roomCluster) subscribe() (*redis.PubSub, error) {
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
	defer cancel()
	sub := c.rdb.Subscribe(c.ctx, c.channel(c.id))
	if _, err := sub.Receive(ctx); err != nil {
		sub.Close()
		return nil, err
	}
	if err := c.rdb.Set(ctx, c.nodeKey(c.id), "1", c.ttl).Err(); err != nil {
		sub.Close()
		return nil, err
	}
	return sub, nil
}

func (c *roomCluster) reserve(kind, code string) (roomBinding, error) {
	b := roomBinding{Kind: kind, Code: code, Epoch: c.id + "." + studioSecret()}
	if !c.ready.Load() || !validRoomBinding(b) {
		return b, errClusterUnavailable
	}
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	n, err := c.rdb.Eval(ctx, `if redis.call('exists',KEYS[1])==1 or redis.call('exists',KEYS[2])==1 then return 0 end redis.call('set',KEYS[1],ARGV[1],'PX',ARGV[2]);return 1`, []string{c.ownerKey(b), c.stateKey(b)}, b.Epoch, c.ttl.Milliseconds()).Int()
	if err != nil {
		return b, errClusterUnavailable
	}
	if n != 1 {
		return b, errRoomOwner
	}
	c.mu.Lock()
	c.owned[c.key(b)] = &clusterOwned{binding: b}
	c.mu.Unlock()
	return b, nil
}

func (c *roomCluster) resolve(kind, code string) (roomBinding, error) {
	b := roomBinding{Kind: kind, Code: strings.ToUpper(strings.TrimSpace(code))}
	if !validRoomBinding(b) {
		return b, errRoomMissing
	}
	if !c.ready.Load() {
		return b, errClusterUnavailable
	}
	ctx, cancel := context.WithTimeout(c.ctx, 2*time.Second)
	defer cancel()
	for attempt := 0; attempt < 4; attempt++ {
		epoch, err := c.rdb.Get(ctx, c.ownerKey(b)).Result()
		if err == nil {
			b.Epoch = epoch
			if ownerNode(epoch) != c.id {
				return b, nil
			}
			c.mu.Lock()
			owned := c.owned[c.key(b)]
			var loading chan struct{}
			if owned != nil && owned.binding.Epoch == epoch {
				loading = owned.loading
			}
			c.mu.Unlock()
			if owned == nil || owned.binding.Epoch != epoch {
				return b, errClusterUnavailable
			}
			if loading != nil {
				select {
				case <-loading:
				case <-ctx.Done():
					return b, errClusterUnavailable
				}
				continue
			}
			return b, nil
		}
		if err != redis.Nil {
			return b, errClusterUnavailable
		}
		b.Epoch = c.id + "." + studioSecret()
		won, err := c.rdb.Eval(ctx, `if redis.call('exists',KEYS[2])==0 then return -1 end if redis.call('set',KEYS[1],ARGV[1],'NX','PX',ARGV[2]) then return 1 end return 0`, []string{c.ownerKey(b), c.stateKey(b)}, b.Epoch, c.ttl.Milliseconds()).Int()
		if err != nil {
			return b, errClusterUnavailable
		}
		if won < 0 {
			return b, errRoomMissing
		}
		if won == 0 {
			continue
		}
		loading := make(chan struct{})
		owned := &clusterOwned{binding: b, loading: loading}
		c.mu.Lock()
		c.owned[c.key(b)] = owned
		c.mu.Unlock()
		values, err := c.rdb.HMGet(ctx, c.stateKey(b), "body", "sequence").Result()
		if err == nil && len(values) == 2 && values[0] != nil {
			sequence, _ := strconv.ParseUint(fmt.Sprint(values[1]), 10, 64)
			c.mu.Lock()
			owned.sequence = sequence
			c.mu.Unlock()
			err = c.hooks.restore(b, []byte(fmt.Sprint(values[0])))
		} else {
			err = errRoomMissing
		}
		c.mu.Lock()
		owned.loading = nil
		close(loading)
		c.mu.Unlock()
		if err != nil {
			c.release(b)
			return b, err
		}
		return b, nil
	}
	return b, errClusterUnavailable
}

func (c *roomCluster) owns(b roomBinding) bool {
	if !c.ready.Load() {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	owned := c.owned[c.key(b)]
	return owned != nil && owned.binding == b
}

func (c *roomCluster) commit(b roomBinding, body []byte, ttl time.Duration) error {
	if !c.ready.Load() || len(body) > 2<<20 {
		return errClusterUnavailable
	}
	c.mu.Lock()
	owned := c.owned[c.key(b)]
	if owned == nil || owned.binding != b {
		c.mu.Unlock()
		return errRoomOwner
	}
	owned.sequence++
	sequence := owned.sequence
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	n, err := c.rdb.Eval(ctx, `if redis.call('get',KEYS[1])~=ARGV[1] then return -1 end local n=tonumber(redis.call('hget',KEYS[2],'sequence') or '0');if n>=tonumber(ARGV[3]) then return -2 end redis.call('hset',KEYS[2],'body',ARGV[2],'sequence',ARGV[3]);redis.call('pexpire',KEYS[2],ARGV[4]);return 1`, []string{c.ownerKey(b), c.stateKey(b)}, b.Epoch, body, sequence, max(ttl.Milliseconds(), int64(60000))).Int()
	if err != nil {
		return errClusterUnavailable
	}
	if n != 1 {
		return errRoomOwner
	}
	return nil
}

func (c *roomCluster) importSnapshot(kind, code string, body []byte, ttl time.Duration) error {
	b := roomBinding{Kind: kind, Code: code}
	if !validRoomBinding(b) || len(body) > 2<<20 {
		return errRoomMissing
	}
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	return c.rdb.Eval(ctx, `if redis.call('exists',KEYS[1])==0 and redis.call('exists',KEYS[2])==0 then redis.call('hset',KEYS[2],'body',ARGV[1],'sequence','0');redis.call('pexpire',KEYS[2],ARGV[2]);end return 1`, []string{c.ownerKey(b), c.stateKey(b)}, body, ttl.Milliseconds()).Err()
}

func (c *roomCluster) release(b roomBinding) {
	c.mu.Lock()
	if owned := c.owned[c.key(b)]; owned != nil && owned.binding == b {
		delete(c.owned, c.key(b))
	}
	c.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_ = c.rdb.Eval(ctx, `if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0`, []string{c.ownerKey(b)}, b.Epoch).Err()
}

func (c *roomCluster) publish(node string, p relayPacket, fenced bool) error {
	p.From = c.id
	body, err := json.Marshal(p)
	if err != nil || len(body) > 800<<10 {
		return errClusterUnavailable
	}
	ctx, cancel := context.WithTimeout(c.ctx, time.Second)
	defer cancel()
	var n int64
	if fenced && p.Binding.Epoch != "" {
		n, err = c.rdb.Eval(ctx, `if redis.call('get',KEYS[1])~=ARGV[1] then return -1 end return redis.call('publish',ARGV[2],ARGV[3])`, []string{c.ownerKey(p.Binding)}, p.Binding.Epoch, c.channel(node), body).Int64()
	} else {
		n, err = c.rdb.Publish(ctx, c.channel(node), body).Result()
	}
	if err != nil || n <= 0 {
		return errClusterUnavailable
	}
	return nil
}

func (c *roomCluster) listen(sub *redis.PubSub) {
	for c.ctx.Err() == nil {
		msg, err := sub.ReceiveMessage(c.ctx)
		if err == nil {
			var p relayPacket
			if len(msg.Payload) <= 800<<10 && json.Unmarshal([]byte(msg.Payload), &p) == nil {
				c.receive(p)
			}
			continue
		}
		if c.ctx.Err() != nil {
			return
		}
		c.degrade()
		sub.Close()
		for c.ctx.Err() == nil {
			select {
			case <-c.ctx.Done():
				return
			case <-time.After(500 * time.Millisecond):
			}
			next, e := c.subscribe()
			if e != nil {
				continue
			}
			sub = next
			c.mu.Lock()
			if c.ctx.Err() != nil {
				c.mu.Unlock()
				next.Close()
				return
			}
			c.sub = next
			c.ready.Store(true)
			c.mu.Unlock()
			break
		}
	}
}

func (c *roomCluster) heartbeat() {
	tick := time.NewTicker(max(100*time.Millisecond, c.ttl/3))
	defer tick.Stop()
	for {
		select {
		case <-c.ctx.Done():
			return
		case <-tick.C:
		}
		if !c.ready.Load() {
			continue
		}
		ctx, cancel := context.WithTimeout(c.ctx, time.Second)
		c.mu.Lock()
		owned := make([]roomBinding, 0, len(c.owned))
		for _, o := range c.owned {
			owned = append(owned, o.binding)
		}
		peers := make([]*clusterPeer, 0, len(c.peers))
		for _, p := range c.peers {
			peers = append(peers, p)
		}
		remote := make([]*clusterRemote, 0, len(c.remote))
		for _, r := range c.remote {
			remote = append(remote, r)
		}
		c.mu.Unlock()
		// One round trip per heartbeat, independent of the number of players.
		pipe := c.rdb.Pipeline()
		pipe.Set(ctx, c.nodeKey(c.id), "1", c.ttl)
		renewals := make(map[roomBinding]*redis.Cmd, len(owned))
		for _, b := range owned {
			renewals[b] = pipe.Eval(ctx, `if redis.call('get',KEYS[1])~=ARGV[1] then return 0 end return redis.call('pexpire',KEYS[1],ARGV[2])`, []string{c.ownerKey(b)}, b.Epoch, c.ttl.Milliseconds())
		}
		owners := map[string]*redis.StringCmd{}
		for _, p := range peers {
			b := p.route()
			if b.Epoch != "" && owners[c.ownerKey(b)] == nil {
				owners[c.ownerKey(b)] = pipe.Get(ctx, c.ownerKey(b))
			}
		}
		nodes := map[string]*redis.IntCmd{}
		for _, r := range remote {
			if nodes[r.from] == nil {
				nodes[r.from] = pipe.Exists(ctx, c.nodeKey(r.from))
			}
		}
		_, err := pipe.Exec(ctx)
		cancel()
		if err == redis.Nil {
			err = nil
		}
		if err == nil {
			for b, cmd := range renewals {
				if n, e := cmd.Int(); e != nil {
					err = e
					break
				} else if n == 0 {
					c.lose(b)
				}
			}
			for _, p := range peers {
				b := p.route()
				if cmd := owners[c.ownerKey(b)]; cmd != nil {
					value, e := cmd.Result()
					if e == redis.Nil || e == nil && value != b.Epoch {
						p.close()
					} else if e != nil {
						err = e
					}
				}
			}
			for _, r := range remote {
				if n, e := nodes[r.from].Result(); e != nil {
					err = e
				} else if n == 0 {
					r.socket.Close()
				}
			}
		}
		if err != nil {
			c.degrade()
			c.mu.Lock()
			sub := c.sub
			c.mu.Unlock()
			if sub != nil {
				sub.Close()
			}
		}
	}
}

func (c *roomCluster) lose(b roomBinding) {
	c.mu.Lock()
	owned := c.owned[c.key(b)]
	if owned == nil || owned.binding != b {
		c.mu.Unlock()
		return
	}
	delete(c.owned, c.key(b))
	c.mu.Unlock()
	c.hooks.suspend(b)
}
func (c *roomCluster) degrade() {
	if !c.ready.Swap(false) {
		return
	}
	c.mu.Lock()
	owned := c.owned
	peers := c.peers
	remote := c.remote
	c.owned = map[string]*clusterOwned{}
	c.peers = map[string]*clusterPeer{}
	c.remote = map[string]*clusterRemote{}
	c.mu.Unlock()
	for _, p := range peers {
		p.close()
	}
	for _, r := range remote {
		r.socket.Close()
	}
	for _, o := range owned {
		c.hooks.suspend(o.binding)
	}
}
func (c *roomCluster) close() {
	c.closed.Do(func() {
		c.cancel()
		c.mu.Lock()
		owned := make([]roomBinding, 0, len(c.owned))
		for _, o := range c.owned {
			owned = append(owned, o.binding)
		}
		c.mu.Unlock()
		c.degrade()
		for _, b := range owned {
			c.release(b)
		}
		c.mu.Lock()
		sub := c.sub
		c.mu.Unlock()
		if sub != nil {
			sub.Close()
		}
		c.rdb.Close()
	})
}
