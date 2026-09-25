package redis

import (
	"bufio"
	"bytes"
	"context"
	"io"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWriteCommandEncodesRESP(t *testing.T) {
	buf := &bytes.Buffer{}
	c := &Client{rw: bufio.NewReadWriter(bufio.NewReader(buf), bufio.NewWriter(buf))}
	if err := c.writeCommand([]string{"SET", "foo", "bar baz"}); err != nil {
		t.Fatal(err)
	}
	c.rw.Flush()
	want := "*3\r\n$3\r\nSET\r\n$3\r\nfoo\r\n$7\r\nbar baz\r\n"
	if got := buf.String(); got != want {
		t.Fatalf("encode mismatch:\n got %q\nwant %q", got, want)
	}
}

func TestReadReplyParsesRESP(t *testing.T) {
	canned := []byte(":42\r\n$5\r\nhello\r\n+OK\r\n$-1\r\n*2\r\n$5\r\nworld\r\n:7\r\n")
	clientSide, serverSide := net.Pipe()
	go func() {
		_, _ = serverSide.Write(canned)
		serverSide.Close()
	}()
	c := &Client{conn: clientSide, rw: bufio.NewReadWriter(bufio.NewReader(clientSide), bufio.NewWriter(clientSide))}

	r, err := c.readReply()
	if err != nil || r.Kind != ':' || r.Int != 42 {
		t.Fatalf("integer: got %+v err %v", r, err)
	}
	r, err = c.readReply()
	if err != nil || r.Kind != '$' || r.Bulk != "hello" {
		t.Fatalf("bulk: got %+v err %v", r, err)
	}
	r, err = c.readReply()
	if err != nil || r.Kind != '+' || r.Str != "OK" {
		t.Fatalf("simple: got %+v err %v", r, err)
	}
	r, err = c.readReply()
	if err != nil || r.Kind != '$' || !r.Null {
		t.Fatalf("null bulk: got %+v err %v", r, err)
	}
	r, err = c.readReply()
	if err != nil || r.Kind != '*' || len(r.Arr) != 2 || r.Arr[0].Bulk != "world" || r.Arr[1].Int != 7 {
		t.Fatalf("array: got %+v err %v", r, err)
	}
}

func TestFakeCommands(t *testing.T) {
	f := NewFake()
	ctx := context.Background()

	if r, _ := f.Do(ctx, "PING"); r.Str != "PONG" {
		t.Fatalf("PING: %+v", r)
	}
	if _, err := f.Do(ctx, "SET", "k", "v"); err != nil {
		t.Fatal(err)
	}
	if r, _ := f.Do(ctx, "GET", "k"); r.Bulk != "v" {
		t.Fatalf("GET: %+v", r)
	}
	if r, _ := f.Do(ctx, "GET", "missing"); !r.Null {
		t.Fatalf("GET missing should be null: %+v", r)
	}
	if r, _ := f.Do(ctx, "INCR", "n"); r.Int != 1 {
		t.Fatalf("INCR: %+v", r)
	}
	if r, _ := f.Do(ctx, "INCR", "n"); r.Int != 2 {
		t.Fatalf("INCR2: %+v", r)
	}
	if r, _ := f.Do(ctx, "DECR", "n"); r.Int != 1 {
		t.Fatalf("DECR: %+v", r)
	}
	if r, _ := f.Do(ctx, "ZADD", "z", "10", "a", "20", "b"); r.Int != 2 {
		t.Fatalf("ZADD: %+v", r)
	}
	if r, _ := f.Do(ctx, "ZCARD", "z"); r.Int != 2 {
		t.Fatalf("ZCARD: %+v", r)
	}
	if r, _ := f.Do(ctx, "ZREMRANGEBYSCORE", "z", "0", "15"); r.Int != 1 {
		t.Fatalf("ZREMRANGEBYSCORE: %+v", r)
	}
	if r, _ := f.Do(ctx, "ZCARD", "z"); r.Int != 1 {
		t.Fatalf("ZCARD after prune: %+v", r)
	}
	if r, _ := f.Do(ctx, "DEL", "k", "n", "z"); r.Int != 3 {
		t.Fatalf("DEL: %+v", r)
	}
	if _, err := f.Do(ctx, "BOGUS"); err == nil {
		t.Fatal("unknown command should error")
	}
}

// startFakeServer stands up a real TCP RESP server backed by an in-memory Fake
// and returns its address. It is used to prove the client's wire format end to
// end (client encodes command -> server decodes -> server encodes reply ->
// client decodes).
func startFakeServer(t *testing.T, fake *Fake) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveConn(conn, fake)
		}
	}()
	return ln.Addr().String()
}

func serveConn(conn net.Conn, fake *Fake) {
	defer conn.Close()
	rw := bufio.NewReadWriter(bufio.NewReader(conn), bufio.NewWriter(conn))
	for {
		line, err := rw.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" || line[0] != '*' {
			return
		}
		n, _ := strconv.Atoi(line[1:])
		args := make([]string, 0, n)
		for i := 0; i < n; i++ {
			l, err := rw.ReadString('\n')
			if err != nil {
				return
			}
			l = strings.TrimRight(l, "\r\n")
			if l == "" || l[0] != '$' {
				return
			}
			len, _ := strconv.Atoi(l[1:])
			buf := make([]byte, len+2)
			if _, err := io.ReadFull(rw, buf); err != nil {
				return
			}
			args = append(args, string(buf[:len]))
		}
		reply, err := fake.Do(context.Background(), args...)
		var out []byte
		if err != nil {
			if re, ok := err.(*Error); ok {
				out = EncodeReply(Reply{Kind: '-', Str: re.Msg})
			} else {
				out = EncodeReply(Reply{Kind: '-', Str: err.Error()})
			}
		} else {
			out = EncodeReply(reply)
		}
		if _, err := rw.Write(out); err != nil {
			return
		}
		if err := rw.Flush(); err != nil {
			return
		}
	}
}

func TestClientRoundTripOverTCP(t *testing.T) {
	fake := NewFake()
	addr := startFakeServer(t, fake)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	c, err := Dial(ctx, addr)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	if r, err := c.Do(ctx, "PING"); err != nil || r.Str != "PONG" {
		t.Fatalf("PING: %+v err %v", r, err)
	}
	if _, err := c.Do(ctx, "SET", "k", "hello"); err != nil {
		t.Fatal(err)
	}
	if r, err := c.Do(ctx, "GET", "k"); err != nil || r.Bulk != "hello" {
		t.Fatalf("GET: %+v err %v", r, err)
	}
	if r, err := c.Do(ctx, "GET", "nope"); err != nil || !r.Null {
		t.Fatalf("GET null: %+v err %v", r, err)
	}
	if r, err := c.Do(ctx, "INCR", "n"); err != nil || r.Int != 1 {
		t.Fatalf("INCR: %+v err %v", r, err)
	}
	if r, err := c.Do(ctx, "ZADD", "z", "5", "a"); err != nil || r.Int != 1 {
		t.Fatalf("ZADD: %+v err %v", r, err)
	}
	if r, err := c.Do(ctx, "ZCARD", "z"); err != nil || r.Int != 1 {
		t.Fatalf("ZCARD: %+v err %v", r, err)
	}
	if _, err := c.Do(ctx, "BOGUS"); err == nil {
		t.Fatal("unknown command should return an error")
	}
}
