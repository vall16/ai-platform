package main

import (
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ai-platform/router/internal/api"
	"github.com/ai-platform/router/internal/provider"
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

	// Build scoring engine.
	engine := scoring.NewEngine(registry)

	// Build HTTP server.
	server := api.NewServer(engine, registry)
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
		log.Printf("router listening on %s", addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	// Graceful shutdown.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig

	log.Println("shutting down...")
	httpServer.Close()
}
