package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/ai-platform/router/internal/metrics"
	"github.com/ai-platform/router/internal/obs"
	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/scoring"
	"github.com/ai-platform/router/internal/trace"
)

// Server holds the HTTP server dependencies.
type Server struct {
	engine   *scoring.Engine
	registry *provider.Registry
	log      *obs.Logger

	metrics            *metrics.Registry
	routeRequests      *metrics.Counter
	routeDuration      *metrics.Histogram
	providerOutcomes   *metrics.Counter
}

// NewServer creates an API server with the given engine, registry and logger.
func NewServer(engine *scoring.Engine, registry *provider.Registry, log *obs.Logger) *Server {
	if log == nil {
		log = obs.New(discardWriter{}, "router")
	}
	m := metrics.New()
	return &Server{
		engine:   engine,
		registry: registry,
		log:      log,
		metrics:  m,
		routeRequests:    m.Counter("router_route_requests_total", "Total route decisions made"),
		routeDuration:    m.Histogram("router_route_duration_seconds", "Route decision duration in seconds", []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1}),
		providerOutcomes: m.Counter("router_provider_outcomes_total", "Total provider call outcomes recorded"),
	}
}

// Routes registers the API endpoints on the given mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/route", s.handleRoute)
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("GET /api/v1/providers", s.handleProviders)
	mux.HandleFunc("POST /api/v1/providers/{id}/outcome", s.handleOutcome)
	mux.HandleFunc("POST /api/v1/providers/{id}/release", s.handleRelease)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
}

// RouteRequest is the body for POST /api/v1/route.
type RouteRequest struct {
	TenantID     string `json:"tenant_id"`
	SessionID    string `json:"session_id,omitempty"`
	RequestID    string `json:"request_id"`
	ResourceType string `json:"resource_type"` // "avatar", "llm", "stt", etc.
}

// RouteResponse is the response for POST /api/v1/route.
type RouteResponse struct {
	SelectedProviderID string              `json:"selected_provider_id"`
	Score              float64             `json:"score"`
	Candidates         []scoring.Candidate `json:"candidates"`
	Reason             string              `json:"reason"`
	Failover           bool                `json:"failover"`
	Mode               scoring.Mode        `json:"mode"`
	DegradationLevel   int                 `json:"degradation_level"`
	TraceID            string              `json:"trace_id"`
	DecidedAt          time.Time           `json:"decided_at"`
}

func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request) {
	tc := trace.FromHeaders(r.Header.Get)
	log := s.log.WithTrace(tc.TraceID)
	setTraceHeaders(w, tc)

	start := time.Now()

	var req RouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Warn("route: invalid body", "err", err.Error())
		s.recordRoute("", http.StatusBadRequest, start)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	if req.TenantID == "" || req.RequestID == "" || req.ResourceType == "" {
		log.Warn("route: missing fields", "tenant_id", req.TenantID, "request_id", req.RequestID, "resource_type", req.ResourceType)
		s.recordRoute(req.ResourceType, http.StatusBadRequest, start)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant_id, request_id, resource_type are required"})
		return
	}

	log.Info("route", "tenant_id", req.TenantID, "request_id", req.RequestID, "resource_type", req.ResourceType)

	result, err := s.engine.Route(r.Context(), provider.ProviderType(req.ResourceType))
	if err != nil {
		log.Error("route failed", "err", err.Error(), "resource_type", req.ResourceType)
		s.recordRoute(req.ResourceType, http.StatusServiceUnavailable, start)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}

	log.Info("routed", "provider", result.SelectedProviderID, "score", result.Score, "failover", result.Failover, "reason", result.Reason)
	s.recordRoute(req.ResourceType, http.StatusOK, start)

	writeJSON(w, http.StatusOK, RouteResponse{
		SelectedProviderID: result.SelectedProviderID,
		Score:              result.Score,
		Candidates:         result.Candidates,
		Reason:             result.Reason,
		Failover:           result.Failover,
		Mode:               result.Mode,
		DegradationLevel:   result.DegradationLevel,
		TraceID:            tc.TraceID,
		DecidedAt:          time.Now().UTC(),
	})
}

// recordRoute records a route decision in the metrics registry: a request
// counter (by resource type and HTTP status) and a duration histogram.
func (s *Server) recordRoute(resourceType string, status int, start time.Time) {
	s.routeRequests.Inc(metrics.Labels{"resource_type": resourceType, "status": strconv.Itoa(status)})
	s.routeDuration.Observe(metrics.Labels{"resource_type": resourceType}, time.Since(start).Seconds())
}

// OutcomeRequest is the body for POST /api/v1/providers/{id}/outcome.
type OutcomeRequest struct {
	Success bool `json:"success"`
}

// handleOutcome records a call outcome for a provider, driving its circuit
// breaker. Called by the session manager once a routed call completes.
func (s *Server) handleOutcome(w http.ResponseWriter, r *http.Request) {
	tc := trace.FromHeaders(r.Header.Get)
	log := s.log.WithTrace(tc.TraceID)
	setTraceHeaders(w, tc)

	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provider id is required"})
		return
	}

	var req OutcomeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	s.engine.RecordOutcome(id, req.Success)
	success := "false"
	if req.Success {
		success = "true"
	}
	s.providerOutcomes.Inc(metrics.Labels{"provider": id, "success": success})
	log.Info("outcome", "provider", id, "success", req.Success)
	writeJSON(w, http.StatusOK, map[string]string{"status": "recorded", "provider_id": id})
}

// handleRelease frees a session slot previously reserved for a provider.
func (s *Server) handleRelease(w http.ResponseWriter, r *http.Request) {
	tc := trace.FromHeaders(r.Header.Get)
	log := s.log.WithTrace(tc.TraceID)
	setTraceHeaders(w, tc)

	id := r.PathValue("id")
	if id == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "provider id is required"})
		return
	}

	s.engine.Release(id)
	log.Info("release", "provider", id)
	writeJSON(w, http.StatusOK, map[string]string{"status": "released", "provider_id": id})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleMetrics renders the registry in Prometheus text exposition format.
// No auth, matching the backend's /metrics endpoint.
func (s *Server) handleMetrics(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(s.metrics.Render()))
}

func (s *Server) handleProviders(w http.ResponseWriter, _ *http.Request) {
	providers := s.registry.All()
	type providerInfo struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Type string `json:"type"`
	}
	info := make([]providerInfo, 0, len(providers))
	for _, p := range providers {
		info = append(info, providerInfo{ID: p.ID(), Name: p.Name(), Type: string(p.Type())})
	}
	writeJSON(w, http.StatusOK, info)
}

// setTraceHeaders echoes the trace context back on the response so the caller
// can correlate: X-Trace-Id (the bare trace id) and traceparent (W3C).
func setTraceHeaders(w http.ResponseWriter, tc trace.Context) {
	w.Header().Set("X-Trace-Id", tc.TraceID)
	w.Header().Set("traceparent", trace.BuildTraceparent(tc))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// discardWriter is an io.Writer that drops everything; used when no logger is
// supplied so the server can still run without logging.
type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }
