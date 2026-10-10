package geo

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"

	"github.com/7893/database-keepalive/internal/config"
)

type Geo struct {
	Colo    string `json:"colo"`
	Country string `json:"country"`
	City    string `json:"city"`
	Region  string `json:"region"`
	IP      string `json:"ip"`
}
type Pop struct {
	Colo    string   `json:"colo"`
	Country string   `json:"country"`
	City    string   `json:"city"`
	Region  string   `json:"region"`
	Subnets []string `json:"subnets"`
}

//go:embed locations.json
var locations []byte
var Pops = func() []Pop {
	var p []Pop
	if json.Unmarshal(locations, &p) != nil {
		panic("invalid locations")
	}
	return p
}()

func Distinct(count int, integer Integer) []Geo {
	if count < 0 {
		panic("invalid geographic count")
	}
	if count > len(Pops) {
		return append(Distinct(len(Pops), integer), Distinct(count-len(Pops), integer)...)
	}
	pool := append([]Pop(nil), Pops...)
	for i := len(pool) - 1; i > 0; i-- {
		j := integer(0, i)
		pool[i], pool[j] = pool[j], pool[i]
	}
	result := make([]Geo, count)
	for i, p := range pool[:count] {
		ip := ""
		if len(p.Subnets) > 0 {
			ip = fmt.Sprintf("%s.%d", p.Subnets[integer(0, len(p.Subnets)-1)], integer(2, 253))
		} else {
			ip = fmt.Sprintf("104.28.%d.%d", integer(2, 252), integer(2, 252))
		}
		result[i] = Geo{p.Colo, p.Country, p.City, p.Region, ip}
	}
	return result
}
func Metadata(execution, service string, selection ...[]config.Service) (Geo, string) {
	services := config.Services
	if len(selection) > 0 {
		services = selection[0]
	}
	for i, s := range services {
		if s.ID == service {
			return Distinct(len(services), Seeded(execution))[i], RequestID(execution, service)
		}
	}
	panic("invalid service")
}
func Real(ctx context.Context, client *http.Client) (Geo, error) {
	fail := errors.New("real_geo_unavailable")
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://1.1.1.1/cdn-cgi/trace", nil)
	res, e := client.Do(req)
	if e != nil {
		return Geo{}, fail
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return Geo{}, fail
	}
	b, e := io.ReadAll(io.LimitReader(res.Body, 4096))
	if e != nil {
		return Geo{}, fail
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if ok {
			values[k] = strings.TrimSpace(v)
		}
	}
	if net.ParseIP(values["ip"]) == nil || values["ip"] == "127.0.0.1" || !regexp.MustCompile(`^[A-Z0-9]{3}$`).MatchString(values["colo"]) || !regexp.MustCompile(`^[A-Z]{2}$`).MatchString(values["loc"]) {
		return Geo{}, fail
	}
	g := Geo{values["colo"], values["loc"], values["colo"], values["loc"], values["ip"]}
	for _, p := range Pops {
		if p.Colo == g.Colo {
			g.Country = p.Country
			g.City = p.City
			g.Region = p.Region
			break
		}
	}
	if g.Colo == "CFE" {
		g.City = "Edge"
	}
	return g, nil
}

// Client geography requires trusted runtime metadata, never arbitrary headers.
type clientKey struct{}

func WithClient(ctx context.Context, g Geo) context.Context {
	return context.WithValue(ctx, clientKey{}, g)
}
func Client(ctx context.Context) (Geo, error) {
	g, ok := ctx.Value(clientKey{}).(Geo)
	if !ok || g.Colo == "" || net.ParseIP(g.IP) == nil || !regexp.MustCompile(`^[A-Z]{2}$`).MatchString(g.Country) {
		return Geo{}, errors.New("client_geo_unavailable")
	}
	return g, nil
}
