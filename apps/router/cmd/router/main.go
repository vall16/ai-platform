package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/ai-platform/router/internal/api"
	"github.com/ai-platform/router/internal/obs"
	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/quota"
	"github.com/ai-platform/router/internal/redis"
	"github.com/ai-platform/router/internal/resilience"
	"github.com/ai-platform/router/internal/scoring"
)

func main() {
	// Build provider registry with mock providers.
	registry := provider.NewRegistry()
	registry.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID:          "mock-llm-1",
		Name:        "mock-llm-fast",
		Type:        provider.TypeLLM,
		CostPerUnit: 50_000, // $0.05 per unit
		LatencyMs:   200,
		SuccessRate: 0.995,
	}))
	registry.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID:          "mock-llm-2",
		Name:        "mock-llm-cheap",
		Type:        provider.TypeLLM,
		CostPerUnit: 20_000, // $0.02 per unit
		LatencyMs:   500,
		SuccessRate: 0.97,
	}))
	registry.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID:          "mock-avatar-1",
		Name:        "mock-avatar-heygen",
		Type:        provider.TypeAvatar,
		CostPerUnit: 200_000, // $0.20 per unit
		LatencyMs:   800,
		SuccessRate: 0.98,
	}))
	registry.Register(provider.NewMockProvider(provider.MockProviderConfig{
		ID:          "mock-stt-1",
		Name:        "mock-stt-deepgram",
		Type:        provider.TypeSTT,
		CostPerUnit: 30_000, // $0.03 per unit
		LatencyMs:   150,
		SuccessRate: 0.99,
	}))

	// Structured JSON logger (carries trace_id per request).
	logger := obs.New(os.Stdout, "router")

	// Build resilience + capacity dependencies and the scoring engine. When
	// REDIS_URL is set, quota and circuit-breaker state are coordinated through
	// a shared Redis instance so the router can run as stateless, horizontally
	// scaled replicas: a provider's MaxConcurrentSessions is enforced fleet-wide
	// and a breaker trip on one replica is honored by all. Otherwise it falls
	// back to per-instance in-memory state.
	ctx := context.Background()
	var breakers resilience.Store
	var tracker quota.Store
	if url := os.Getenv("REDIS_URL"); url != "" {
		addr := redisAddr(url)
		client, err := redis.Dial(ctx, addr)
		if err != nil {
			logger.Error("redis dial failed; using in-memory stores", "addr", addr, "err", err.Error())
		} else {
			defer client.Close()
			breakers = resilience.NewRedisStore(client, resilience.DefaultConfig(), "", 0)
			tracker = quota.NewRedisStore(client, "", 0)
			logger.Info("using shared redis stores", "addr", addr)
		}
	}
	if breakers == nil {
		breakers = resilience.NewManager(resilience.DefaultConfig())
	}
	if tracker == nil {
		tracker = quota.NewTracker()
	}
	engine := scoring.NewEngine(registry, breakers, tracker)

	// Build HTTP server.
	server := api.NewServer(engine, registry, logger)
	mux := http.NewServeMux()
	server.Routes(mux)

	addr := ":8080"
	if port := os.Getenv("ROUTER_PORT"); port != "" {
		addr = ":" + port
	}

	httpServer := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		logger.Info("router listening", "addr", addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server error", "err", err.Error())
			os.Exit(1)
		}
	}()

	// Graceful shutdown.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	logger.Info("shutting down")
	httpServer.Close()
}

// redisAddr reduces a REDIS_URL (e.g. "redis://host:6379" or
// "redis://:pass@host:6379") to the host:port the minimal stdlib client dials.
// The client does not implement AUTH, so any credentials are ignored.
func redisAddr(url string) string {
	s := url
	if i := strings.Index(s, "://"); i >= 0 {
		s = s[i+3:]
	}
	if i := strings.LastIndex(s, "@"); i >= 0 {
		s = s[i+1:]
	}
	return s
}
