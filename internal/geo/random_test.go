package geo

import (
	"context"
	"testing"
)

func TestRejectionSampling(t *testing.T) {
	calls := 0
	word := func() uint32 {
		calls++
		if calls == 1 {
			return ^uint32(0)
		}
		return 7
	}
	if n := Uniform(word, 1, 3); n != 2 || calls != 2 {
		t.Fatalf("modulo bias: result %d, calls %d", n, calls)
	}
	if n := Uniform(func() uint32 { return ^uint32(0) }, 0, 1); n != 1 {
		t.Fatal("inclusive bound lost")
	}
}
func TestDistinctAndSeededGeography(t *testing.T) {
	a, b := Distinct(5, Seeded("retry")), Distinct(5, Seeded("retry"))
	seen := map[string]bool{}
	for i, g := range a {
		if seen[g.Colo] || g != b[i] {
			t.Fatal("geography is repeated or unstable")
		}
		seen[g.Colo] = true
	}
}
func TestClientGeoRequiresTrustedContext(t *testing.T) {
	if _, e := Client(context.Background()); e == nil {
		t.Fatal("untrusted metadata accepted")
	}
	g := Geo{Colo: "NRT", Country: "JP", City: "Tokyo", IP: "203.0.113.2"}
	if got, e := Client(WithClient(context.Background(), g)); e != nil || got != g {
		t.Fatal("trusted metadata lost")
	}
}
