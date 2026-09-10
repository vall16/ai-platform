package api

import (
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/ai-platform/router/internal/provider"
	"github.com/ai-platform/router/internal/scoring"
)

// Server holds the HTTP server dependencies.
type Server struct {
	engine   *scoring.Engine
	registry *provider.Registry
}

// NewServer creates an API server with the given engine and registry.
func NewServer(engine *scoring.Engine, registry *provider.Registry) *Server {
	return &Server{engine: engine, registry: registry}
}

// Routes registers the API endpoints on the given mux.
func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/v1/route", s.handleRoute)
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("GET /api/v1/providers", s.handleProviders)
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
	SelectedProviderID string                 `json:"selected_provider_id"`
	Score              float64                `json:"score"`
	Candidates         []scoring.Candidate    `json:"candidates"`
	Reason             string                 `json:"reason"`
	DecidedAt          time.Time              `json:"decided_at"`
}

func (s *Server) handleRoute(w http.ResponseWriter, r *http.Request) {
	var req RouteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return
	}

	if req.TenantID == "" || req.RequestID == "" || req.ResourceType == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "tenant_id, request_id, resource_type are required"})
		return
	}

	result, err := s.engine.Route(r.Context(), provider.ProviderType(req.ResourceType))
	if err != nil {
		log.Printf("route error: %v", err)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, RouteResponse{
		SelectedProviderID: result.SelectedProviderID,
		Score:              result.Score,
		Candidates:         result.Candidates,
		Reason:             result.Reason,
		DecidedAt:          time.Now().UTC(),
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
