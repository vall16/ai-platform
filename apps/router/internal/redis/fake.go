package redis

import (
	"context"
	"strconv"
	"strings"
	"sync"
)

// Fake is an in-memory implementation of Conn used to test the shared stores
// without a real Redis server. It implements the same command subset as
// *Client (PING, GET, SET, DEL, INCR, DECR, ZADD, ZREMRANGEBYSCORE, ZCARD)
// with the same reply semantics, so store logic is exercised end to end.
type Fake struct {
	mu   sync.Mutex
	str  map[string]string
	num  map[string]int64
	zset map[string]map[string]float64 // key -> member -> score
}

// NewFake creates an empty in-memory Redis fake.
func NewFake() *Fake {
	return &Fake{
		str:  make(map[string]string),
		num:  make(map[string]int64),
		zset: make(map[string]map[string]float64),
	}
}

// Do executes a command against the in-memory state.
func (f *Fake) Do(_ context.Context, args ...string) (Reply, error) {
	if len(args) == 0 {
		return Reply{}, &Error{Msg: "ERR empty command"}
	}
	f.mu.Lock()
	defer f.mu.Unlock()

	switch strings.ToUpper(args[0]) {
	case "PING":
		return Reply{Kind: '+', Str: "PONG"}, nil

	case "GET":
		// Real Redis shares one key space: a key written by INCR/DECR is
		// readable by GET, so check both the string and numeric stores.
		if v, ok := f.str[args[1]]; ok {
			return Reply{Kind: '$', Bulk: v}, nil
		}
		if v, ok := f.num[args[1]]; ok {
			return Reply{Kind: '$', Bulk: strconv.FormatInt(v, 10)}, nil
		}
		return Reply{Kind: '$', Null: true}, nil

	case "SET":
		f.str[args[1]] = args[2]
		return Reply{Kind: '+', Str: "OK"}, nil

	case "DEL":
		n := 0
		for _, k := range args[1:] {
			if _, ok := f.str[k]; ok {
				delete(f.str, k)
				n++
			}
			if _, ok := f.num[k]; ok {
				delete(f.num, k)
				n++
			}
			if _, ok := f.zset[k]; ok {
				delete(f.zset, k)
				n++
			}
		}
		return Reply{Kind: ':', Int: int64(n)}, nil

	case "INCR":
		f.num[args[1]]++
		return Reply{Kind: ':', Int: f.num[args[1]]}, nil

	case "DECR":
		f.num[args[1]]--
		return Reply{Kind: ':', Int: f.num[args[1]]}, nil

	case "ZADD":
		// ZADD key score member [score member ...]
		key := args[1]
		m := f.zset[key]
		if m == nil {
			m = make(map[string]float64)
			f.zset[key] = m
		}
		added := 0
		for i := 2; i+1 < len(args); i += 2 {
			score, err := strconv.ParseFloat(args[i], 64)
			if err != nil {
				return Reply{}, &Error{Msg: "ERR value is not a float"}
			}
			member := args[i+1]
			if _, ok := m[member]; !ok {
				added++
			}
			m[member] = score
		}
		return Reply{Kind: ':', Int: int64(added)}, nil

	case "ZREMRANGEBYSCORE":
		// ZREMRANGEBYSCORE key min max
		key := args[1]
		m := f.zset[key]
		if m == nil {
			return Reply{Kind: ':', Int: 0}, nil
		}
		min, err := parseBound(args[2])
		if err != nil {
			return Reply{}, &Error{Msg: "ERR min is not a float"}
		}
		max, err := parseBound(args[3])
		if err != nil {
			return Reply{}, &Error{Msg: "ERR max is not a float"}
		}
		removed := 0
		for member, score := range m {
			if score >= min && score <= max {
				delete(m, member)
				removed++
			}
		}
		return Reply{Kind: ':', Int: int64(removed)}, nil

	case "ZCARD":
		return Reply{Kind: ':', Int: int64(len(f.zset[args[1]]))}, nil

	default:
		return Reply{}, &Error{Msg: "ERR unknown command '" + args[0] + "'"}
	}
}

// parseBound parses a ZREMRANGEBYSCORE bound, accepting -inf / +inf.
func parseBound(s string) (float64, error) {
	switch s {
	case "-inf":
		return -1e308, nil
	case "+inf":
		return 1e308, nil
	}
	return strconv.ParseFloat(s, 64)
}
