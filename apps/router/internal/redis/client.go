// Package redis provides a minimal Redis client speaking the RESP2 protocol
// over TCP, implemented with the Go standard library only (no external
// dependencies). It supports the subset of commands the router's shared stores
// need: PING, GET, SET, DEL, INCR, DECR, ZADD, ZREMRANGEBYSCORE and ZCARD.
//
// The client is deliberately small: it serializes commands and replies on a
// single connection and exposes a generic Do method. The shared stores build
// their commands on top of it.
package redis

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Conn is the minimal command interface the shared stores depend on. *Client
// satisfies it; tests substitute an in-memory fake (see NewFake).
type Conn interface {
	// Do sends a command (as a RESP array of bulk strings) and returns the
	// parsed reply.
	Do(ctx context.Context, args ...string) (Reply, error)
}

// Reply is a parsed RESP2 value. Exactly one of the fields is meaningful,
// selected by Kind.
type Reply struct {
	Kind byte // '+', '-', ':', '$', '*'
	Str  string
	Int  int64
	Bulk string
	Arr  []Reply
	Null bool
}

// AsInt returns the integer value of an integer reply.
func (r Reply) AsInt() (int64, error) {
	if r.Kind == ':' {
		return r.Int, nil
	}
	return 0, fmt.Errorf("redis: reply is not an integer (kind %q)", r.Kind)
}

// AsString returns the string value of a bulk/simple reply.
func (r Reply) AsString() (string, error) {
	switch r.Kind {
	case '$':
		return r.Bulk, nil
	case '+':
		return r.Str, nil
	case ':':
		return strconv.FormatInt(r.Int, 10), nil
	default:
		return "", fmt.Errorf("redis: reply is not a string (kind %q)", r.Kind)
	}
}

// Error is a Redis error reply (a "-" line).
type Error struct{ Msg string }

func (e *Error) Error() string { return "redis: " + e.Msg }

// Client is a minimal Redis client over a single TCP connection.
type Client struct {
	conn net.Conn
	rw   *bufio.ReadWriter
	mu   sync.Mutex // serializes command/reply on the single connection
}

// Dial connects to a Redis server at addr (host:port).
func Dial(ctx context.Context, addr string) (*Client, error) {
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, err
	}
	return &Client{
		conn: conn,
		rw:   bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn)),
	}, nil
}

// Close closes the underlying connection.
func (c *Client) Close() error { return c.conn.Close() }

// Do sends a command and returns the parsed reply. The context deadline, if
// any, is applied to the connection for the duration of the round trip.
func (c *Client) Do(ctx context.Context, args ...string) (Reply, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if dl, ok := ctx.Deadline(); ok {
		if err := c.conn.SetDeadline(dl); err != nil {
			return Reply{}, err
		}
		defer func() { _ = c.conn.SetDeadline(time.Time{}) }()
	}

	if err := c.writeCommand(args); err != nil {
		return Reply{}, err
	}
	if err := c.rw.Flush(); err != nil {
		return Reply{}, err
	}
	return c.readReply()
}

func (c *Client) writeCommand(args []string) error {
	if _, err := fmt.Fprintf(c.rw, "*%d\r\n", len(args)); err != nil {
		return err
	}
	for _, a := range args {
		if _, err := fmt.Fprintf(c.rw, "$%d\r\n%s\r\n", len(a), a); err != nil {
			return err
		}
	}
	return nil
}

func (c *Client) readReply() (Reply, error) {
	line, err := c.readLine()
	if err != nil {
		return Reply{}, err
	}
	if len(line) == 0 {
		return Reply{}, fmt.Errorf("redis: empty reply line")
	}
	kind, body := line[0], line[1:]
	switch kind {
	case '+':
		return Reply{Kind: '+', Str: body}, nil
	case '-':
		return Reply{}, &Error{Msg: body}
	case ':':
		n, err := strconv.ParseInt(body, 10, 64)
		if err != nil {
			return Reply{}, fmt.Errorf("redis: bad integer %q: %w", body, err)
		}
		return Reply{Kind: ':', Int: n}, nil
	case '$':
		n, err := strconv.ParseInt(body, 10, 64)
		if err != nil {
			return Reply{}, fmt.Errorf("redis: bad bulk length %q: %w", body, err)
		}
		if n == -1 {
			return Reply{Kind: '$', Null: true}, nil
		}
		buf := make([]byte, n+2) // data + trailing CRLF
		if _, err := io.ReadFull(c.rw, buf); err != nil {
			return Reply{}, err
		}
		return Reply{Kind: '$', Bulk: string(buf[:n])}, nil
	case '*':
		n, err := strconv.ParseInt(body, 10, 64)
		if err != nil {
			return Reply{}, fmt.Errorf("redis: bad array length %q: %w", body, err)
		}
		if n == -1 {
			return Reply{Kind: '*', Null: true}, nil
		}
		arr := make([]Reply, 0, n)
		for i := int64(0); i < n; i++ {
			r, err := c.readReply()
			if err != nil {
				return Reply{}, err
			}
			arr = append(arr, r)
		}
		return Reply{Kind: '*', Arr: arr}, nil
	default:
		return Reply{}, fmt.Errorf("redis: unknown reply type %q", kind)
	}
}

func (c *Client) readLine() (string, error) {
	line, err := c.rw.ReadString('\n')
	if err != nil {
		return "", err
	}
	return strings.TrimRight(line, "\r\n"), nil
}

// EncodeReply serializes a Reply into RESP2 wire bytes. It is the inverse of
// the reply parser and is used by tests to stand up a fake RESP server over a
// real socket.
func EncodeReply(r Reply) []byte {
	var b strings.Builder
	encodeReplyTo(&b, r)
	return []byte(b.String())
}

func encodeReplyTo(b *strings.Builder, r Reply) {
	switch r.Kind {
	case '+':
		fmt.Fprintf(b, "+%s\r\n", r.Str)
	case '-':
		fmt.Fprintf(b, "-%s\r\n", r.Str)
	case ':':
		fmt.Fprintf(b, ":%d\r\n", r.Int)
	case '$':
		if r.Null {
			b.WriteString("$-1\r\n")
			return
		}
		fmt.Fprintf(b, "$%d\r\n%s\r\n", len(r.Bulk), r.Bulk)
	case '*':
		if r.Null {
			b.WriteString("*-1\r\n")
			return
		}
		fmt.Fprintf(b, "*%d\r\n", len(r.Arr))
		for _, a := range r.Arr {
			encodeReplyTo(b, a)
		}
	}
}
